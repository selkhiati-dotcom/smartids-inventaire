/* SmartIDS Inventaire - couche interface + persistance FICHIER (Capacitor Filesystem).
   Le moteur pur est dans inv_core.js (identique a la version testee).

   Persistance "infaillible" (session d'inventaire = plusieurs jours) :
   1. JOURNAL : chaque action (scan, +/-, undo, emplacement) est ajoutee IMMEDIATEMENT
      en fin de journal.jsonl (append). Zero fenetre de perte, meme si l'app est tuee.
   2. ETAT COMPLET : ecrit (debounce 350ms) de facon ATOMIQUE : inventaire_new.json
      puis renommages (jamais d'ecrasement direct) + inventaire.bak.json conserve.
   3. COPIE VISIBLE : Documents/SmartIDS/inventaire.json a chaque sauvegarde.
   4. INSTANTANES : Documents/SmartIDS/backups/inv_<date>.json toutes les 10 min.
   Au demarrage : lecture principal -> new -> bak -> copie Documents, puis REJEU du
   journal (actions plus recentes que la derniere sauvegarde). */
(function(){
'use strict';
var APP_VERSION = '1.2.1';
var IC = window.InvCore;
var $ = function(id){ return document.getElementById(id); };
/* Compat vieux WebView (PDA) : NodeList n'a pas de .forEach avant Chrome 51 */
function each(list, fn){ Array.prototype.forEach.call(list, fn); }
/* Toute erreur JS est AFFICHEE a l'ecran : sur un PDA il n'y a pas de console,
   et une erreur silencieuse = "plus rien ne marche" sans explication. */
window.onerror = function(msg, src, line){
  try{
    var el=document.getElementById('err');
    el.textContent='⚠ Erreur v'+APP_VERSION+' : '+msg+' ('+String(src||'').split('/').pop()+':'+line+')';
    el.classList.remove('hide');
  }catch(e){}
};

/* ---------- Acces Capacitor ---------- */
var CAP = window.Capacitor || {};
var PL = CAP.Plugins || {};
var FS = PL.Filesystem, ShareP = PL.Share, AppP = PL.App;
var DIR_DATA = 'DATA', DIR_DOCS = 'DOCUMENTS', ENC = 'utf8';
var DATA_FILE = 'inventaire.json';
var NEW_FILE  = 'inventaire_new.json';
var BAK_FILE  = 'inventaire.bak.json';
var JOURNAL_FILE = 'journal.jsonl';
var SETTINGS_FILE = 'settings.json';
var DOCS_SUB = 'SmartIDS';
var SNAP_SUB = 'SmartIDS/backups';
var SNAP_EVERY_MS = 10*60*1000;

/* ---------- Reglages (persistes, independants de l'inventaire) ---------- */
/* scanMode : 'field' = lecteur qui INSERE le texte dans le champ focalise (defaut,
   cas des PDA en wedge standard) ; 'keys' = lecteur configure pour emettre de vraies
   touches ("Wedge as keys" Honeywell / DataWedge Zebra) — aucun champ focalise requis,
   c'est le mode le plus fiable. */
var SET = { locEnabled:true, autoAdd:true, lastOp:'', scanMode:'field' };
function settingsLoad(){
  function apply(o){ if(o && typeof o==='object'){
    if(typeof o.locEnabled==='boolean') SET.locEnabled=o.locEnabled;
    if(typeof o.autoAdd==='boolean') SET.autoAdd=o.autoAdd;
    if(typeof o.lastOp==='string') SET.lastOp=o.lastOp;
    if(o.scanMode==='keys'||o.scanMode==='field') SET.scanMode=o.scanMode; } }
  if(FS){
    return FS.readFile({ path:SETTINGS_FILE, directory:DIR_DATA, encoding:ENC })
      .then(function(r){ try{ apply(JSON.parse(typeof r.data==='string'?r.data:'')); }catch(e){} })
      .catch(function(){});
  }
  try{ apply(JSON.parse(localStorage.getItem('smartids_set')||'null')); }catch(e){}
  return Promise.resolve();
}
function settingsSave(){
  var json=JSON.stringify(SET);
  if(FS) return FS.writeFile({ path:SETTINGS_FILE, data:json, directory:DIR_DATA, encoding:ENC }).catch(function(){});
  try{ localStorage.setItem('smartids_set', json); }catch(e){}
  return Promise.resolve();
}

/* ---------- Journal (append immediat, rejoue au boot) ---------- */
var jReady=false, jBuffer=[];
function jWrite(data){
  if(FS){ FS.appendFile({ path:JOURNAL_FILE, data:data, directory:DIR_DATA, encoding:ENC }).catch(function(){}); return; }
  try{
    var arr=JSON.parse(localStorage.getItem('smartids_jrn')||'[]');
    data.split('\n').forEach(function(l){ l=l.trim(); if(l) arr.push(JSON.parse(l)); });
    if(arr.length>8000) arr=arr.slice(-8000);
    localStorage.setItem('smartids_jrn', JSON.stringify(arr));
  }catch(e){}
}
function jlog(e){
  e.t=Date.now();
  if(!jReady){ jBuffer.push(e); return; }
  jWrite(JSON.stringify(e)+'\n');
}
function journalRead(){
  if(FS){
    return FS.readFile({ path:JOURNAL_FILE, directory:DIR_DATA, encoding:ENC })
      .then(function(r){ var out=[]; String(typeof r.data==='string'?r.data:'').split('\n').forEach(function(l){
          l=l.trim(); if(!l) return; try{ out.push(JSON.parse(l)); }catch(e){} }); return out; })
      .catch(function(){ return []; });
  }
  try{ return Promise.resolve(JSON.parse(localStorage.getItem('smartids_jrn')||'[]')); }catch(e){ return Promise.resolve([]); }
}
function journalClear(){
  if(FS) return FS.writeFile({ path:JOURNAL_FILE, data:'', directory:DIR_DATA, encoding:ENC }).catch(function(){});
  try{ localStorage.setItem('smartids_jrn','[]'); }catch(e){}
  return Promise.resolve();
}
function jFlushBuffer(){
  jReady=true;
  if(jBuffer.length){
    var data=jBuffer.map(function(x){return JSON.stringify(x);}).join('\n')+'\n';
    jBuffer=[]; jWrite(data);
  }
}
/* Rejeu des actions plus recentes que la derniere sauvegarde complete. */
function applyJournal(entries, after){
  var n=0;
  entries.forEach(function(e){
    if(!e || !(e.t>after)) return;
    if(e.k==='add'){ var c=IC.normBarcode(e.c); if(c && !S.index.has(c)) IC.addUnknown(S,c,''); n++; }
    else if(e.k==='scan'){ var r=IC.applyScan(S,e.c,1); if(r.status==='ok'){ if(e.l) IC.setProductLocation(S,r.row,e.l); n++; } }
    else if(e.k==='cnt'){ if(e.r>=0 && e.r<S.counts.length){ S.counts[e.r]=Math.max(0,+e.q||0); n++; } }
    else if(e.k==='loc'){ if(e.r>=0 && e.r<S.rows.length){ IC.setProductLocation(S,e.r,e.l||''); n++; } }
    else if(e.k==='curloc'){ S.curLoc=e.l||''; n++; }
    else if(e.k==='op'){ S.operator=e.l||''; n++; }
  });
  return n;
}

/* ---------- Persistance FICHIER (ecriture atomique + fallbacks de lecture) ---------- */
var docsWriteLast=0;
function persistWrite(json, forceDocs){
  if(FS){
    return FS.writeFile({ path:NEW_FILE, data:json, directory:DIR_DATA, encoding:ENC })
      .then(function(){ return FS.deleteFile({ path:BAK_FILE, directory:DIR_DATA }).catch(function(){}); })
      .then(function(){ return FS.rename({ from:DATA_FILE, to:BAK_FILE, directory:DIR_DATA, toDirectory:DIR_DATA }).catch(function(){}); })
      .then(function(){ return FS.rename({ from:NEW_FILE, to:DATA_FILE, directory:DIR_DATA, toDirectory:DIR_DATA }); })
      .then(function(){
        /* Copie Documents : 1 fois / 30 s max (menage le CPU des vieux PDA pendant les
           rafales de scans ; le journal + le fichier principal protegent chaque scan).
           Forcee quand l'app passe en arriere-plan. */
        var now=Date.now();
        if(!forceDocs && now-docsWriteLast<30000) return;
        docsWriteLast=now;
        return FS.mkdir({ path:DOCS_SUB, directory:DIR_DOCS, recursive:true }).catch(function(){})
          .then(function(){ return FS.writeFile({ path:DOCS_SUB+'/'+DATA_FILE, data:json, directory:DIR_DOCS, encoding:ENC }); })
          .catch(function(){});
      })
      .catch(function(e){ try{ localStorage.setItem('smartids_inv_v1', json); }catch(_){} });
  }
  try{ localStorage.setItem('smartids_inv_v1', json); }catch(e){}
  return Promise.resolve();
}
function tryRead(path, dir){
  return FS.readFile({ path:path, directory:dir, encoding:ENC })
    .then(function(r){ try{ var o=JSON.parse(typeof r.data==='string'?r.data:''); return (o && o.rows) ? o : null; }catch(e){ return null; } })
    .catch(function(){ return null; });
}
function persistRead(){
  if(FS){
    return tryRead(DATA_FILE, DIR_DATA).then(function(o){ if(o) return { sv:o, src:'' };
      return tryRead(NEW_FILE, DIR_DATA).then(function(o2){ if(o2) return { sv:o2, src:'ecriture interrompue recuperee' };
        return tryRead(BAK_FILE, DIR_DATA).then(function(o3){ if(o3) return { sv:o3, src:'fichier de secours (.bak)' };
          return tryRead(DOCS_SUB+'/'+DATA_FILE, DIR_DOCS).then(function(o4){ return o4 ? { sv:o4, src:'copie Documents' } : { sv:null }; });
        });
      });
    });
  }
  try{ var s=localStorage.getItem('smartids_inv_v1'); return Promise.resolve({ sv: s?JSON.parse(s):null }); }catch(e){ return Promise.resolve({ sv:null }); }
}
function persistClear(){
  if(FS){
    return Promise.all([
      FS.deleteFile({ path:DATA_FILE, directory:DIR_DATA }).catch(function(){}),
      FS.deleteFile({ path:NEW_FILE, directory:DIR_DATA }).catch(function(){}),
      FS.deleteFile({ path:BAK_FILE, directory:DIR_DATA }).catch(function(){}),
      journalClear(),
      FS.deleteFile({ path:DOCS_SUB+'/'+DATA_FILE, directory:DIR_DOCS }).catch(function(){})
    ]);
  }
  try{ localStorage.removeItem('smartids_inv_v1'); localStorage.setItem('smartids_jrn','[]'); }catch(e){}
  return Promise.resolve();
}
/* Instantane horodate visible par l'utilisateur (filet supplementaire). */
var lastSnap=0;
function snapshotMaybe(json){
  if(!FS) return;
  var now=Date.now();
  if(now-lastSnap < SNAP_EVERY_MS) return;
  lastSnap=now;
  FS.mkdir({ path:SNAP_SUB, directory:DIR_DOCS, recursive:true }).catch(function(){})
    .then(function(){ return FS.writeFile({ path:SNAP_SUB+'/inv_'+todayTag()+'.json', data:json, directory:DIR_DOCS, encoding:ENC }); })
    .catch(function(){});
}

/* ---------- Etat ---------- */
var S = null, undoStack = [], lastScan = {code:'', t:0};

function stateForSave(){
  return { ver:APP_VERSION, fileName:S.fileName, headers:S.headers, rows:S.rows, counts:S.counts,
    locations:S.locations, theo:S.theo||null, curLoc:S.curLoc, locationKey:S.locationKey,
    barcodeKey:S.barcodeKey, designationKey:S.designationKey, refKey:S.refKey,
    location:S.location, produitSource:S.produitSource, freeMode:!!S.freeMode,
    operator:S.operator||'', savedAt:Date.now() };
}
var saveT=null, saving=false, again=false;
function saveSoon(){ clearTimeout(saveT); saveT=setTimeout(saveNow, 350); }
function saveNow(forceDocs){
  if(!S) return Promise.resolve();
  if(saving){ again=true; return Promise.resolve(); }
  saving=true;
  var json=JSON.stringify(stateForSave());
  return persistWrite(json, forceDocs).then(function(){
    saving=false; snapshotMaybe(json);
    if(again){ again=false; return saveNow(forceDocs); }
  });
}
function flushSave(){ clearTimeout(saveT); return saveNow(true); }

/* ---------- Sons / retour ---------- */
var actx=null;
function beep(kind){ try{ actx=actx||new (window.AudioContext||window.webkitAudioContext)();
  var o=actx.createOscillator(),g=actx.createGain(); o.connect(g); g.connect(actx.destination);
  o.frequency.value = kind==='err'?320:(kind==='loc'?880:1320); o.type = kind==='err'?'square':'sine';
  g.gain.value=.12; o.start(); o.stop(actx.currentTime+(kind==='err'?.22:.08)); }catch(e){} }
function vibrate(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }
var toastT=null;
function toast(msg){ var t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(function(){t.classList.remove('show');},1600); }
function todayTag(){ var d=new Date(); function p(n){return(n<10?'0':'')+n;} return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes()); }

/* ---------- Lecture fichier produits ----------
   FileReader obligatoire : file.text()/arrayBuffer() n'existent qu'a partir de
   Chrome 76 — un vieux WebView de PDA planterait a l'import. */
function readAsText(file){ return new Promise(function(res,rej){ var r=new FileReader();
  r.onload=function(){ res(String(r.result||'')); }; r.onerror=function(){ rej(new Error('Lecture du fichier impossible.')); };
  r.readAsText(file,'utf-8'); }); }
function readAsBuffer(file){ return new Promise(function(res,rej){ var r=new FileReader();
  r.onload=function(){ res(r.result); }; r.onerror=function(){ rej(new Error('Lecture du fichier impossible.')); };
  r.readAsArrayBuffer(file); }); }
function readFile(file){ var name=(file.name||'').toLowerCase();
  if(/\.xlsx?$/.test(name)){ return readXlsx(file); }
  return readAsText(file).then(function(txt){ return IC.parseDelimited(txt); }); }
function ensureSheetJS(){ if(window.XLSX) return Promise.resolve(true);
  return new Promise(function(res){ var s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload=function(){res(!!window.XLSX);}; s.onerror=function(){res(false);}; document.head.appendChild(s); }); }
function readXlsx(file){ return ensureSheetJS().then(function(okk){
    if(!okk) throw new Error('Excel indisponible hors-ligne - exporte en CSV (separateur ;) et recharge.');
    return readAsBuffer(file); }).then(function(buf){
    var wb=XLSX.read(buf,{type:'array'}); var ws=wb.Sheets[wb.SheetNames[0]];
    var aoa=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''});
    aoa=aoa.filter(function(r){return r.some(function(v){return String(v).trim()!=='';});});
    var headers=(aoa[0]||[]).map(function(h){return String(h).trim();});
    var rows=[]; for(var i=1;i<aoa.length;i++){ var o={}; headers.forEach(function(h,j){o[h]=aoa[i][j]!=null?String(aoa[i][j]):'';}); rows.push(o); }
    return {headers:headers, rows:rows}; }); }

/* ---------- Mapping colonnes ---------- */
var parsed=null;
function fillSelect(sel,headers,val){ sel.innerHTML=''; headers.forEach(function(h){ var o=document.createElement('option'); o.value=h; o.textContent=h; if(h===val)o.selected=true; sel.appendChild(o); }); }
function fillSelectOpt(sel,headers,val){ sel.innerHTML=''; [''].concat(headers).forEach(function(h){ var o=document.createElement('option'); o.value=h; o.textContent=h||'-- aucune --'; if(h===val)o.selected=true; sel.appendChild(o); }); }
function refreshMapInfo(){ if(!parsed) return; var bk=$('mBarcode').value, empty=0, sci=0, seen={}, dup=0;
  for(var i=0;i<parsed.rows.length;i++){ var raw=String(parsed.rows[i][bk]==null?'':parsed.rows[i][bk]).trim();
    if(!raw){ empty++; continue; } if(/^\d+(\.\d+)?[eE]\+?\d+$/.test(raw)) sci++;
    var c=IC.normBarcode(raw); if(seen[c]) dup++; else seen[c]=1; }
  var msg=parsed.rows.length+' produits detectes.';
  if(sci) msg+=' / '+sci+' code(s) en notation scientifique (corriges).';
  if(empty) msg+=' / '+empty+' sans code-barres.'; if(dup) msg+=' / '+dup+' code(s) en double.';
  $('mapInfo').textContent=msg; }
function onParsed(p){ parsed=p;
  if(!p.headers.length || !p.rows.length){ alert('Fichier vide ou illisible.'); return; }
  var c=IC.detectColumns(p.headers);
  fillSelect($('mBarcode'),p.headers,c.barcode); fillSelect($('mDesig'),p.headers,c.designation);
  fillSelectOpt($('mRef'),p.headers,c.ref); fillSelectOpt($('mLocCol'),p.headers,c.location);
  fillSelectOpt($('mTheo'),p.headers,c.theo); fillSelectOpt($('mQty'),p.headers,c.qty);
  refreshMapInfo(); $('mBarcode').onchange=refreshMapInfo; $('mapCard').classList.remove('hide'); }

function getOperator(){
  var op=$('mOp').value.trim();
  if(!op){ alert('Indique l operateur (la personne responsable du comptage).'); return null; }
  SET.lastOp=op;
  SET.locEnabled=$('mLocEnabled').checked;   /* choix emplacements fait au demarrage */
  settingsSave();
  recents=[];
  return op;
}
function startFromParsed(){
  var bk=$('mBarcode').value, dk=$('mDesig').value, rk=$('mRef').value, lk=$('mLocCol').value, qk=$('mQty').value, tk=$('mTheo').value;
  if(!bk){ alert('Choisis la colonne code-barres.'); return; }
  var op=getOperator(); if(op==null) return;
  var rows=parsed.rows.slice();
  var locs=rows.map(function(r){ return lk ? IC.normLoc(r[lk]) : ''; });
  function seedQty(r){ if(!qk) return 0; var v=parseInt(String(r[qk]==null?'':r[qk]).replace(/[^0-9-]/g,''),10); return (isFinite(v)&&v>0)?v:0; }
  function seedTheo(r){ if(!tk) return 0; var v=parseFloat(String(r[tk]==null?'':r[tk]).replace(',','.').replace(/[^0-9.\-]/g,'')); return isFinite(v)?v:0; }
  var counts=rows.map(seedQty);
  S={ fileName:(parsed._name||'inventaire'), headers:parsed.headers.slice(), rows:rows,
      counts:counts, locations:locs, theo:(tk?rows.map(seedTheo):null), curLoc:'',
      barcodeKey:bk, designationKey:dk, refKey:rk, locationKey:lk,
      location:$('mLoc').value.trim()||'WH/Stock', produitSource:$('mProdRef').checked?'ref':'barcode',
      operator:op };
  S.index=IC.buildIndex(S.rows,S.barcodeKey).idx; undoStack=[]; saveNow(); goScan();
  var seeded=counts.reduce(function(a,b){return a+b;},0);
  if(seeded>0) toast('Reprise : '+seeded+' unite(s) rechargee(s)');
}
function startFreeCount(){
  var op=getOperator(); if(op==null) return;
  if(!confirm('Comptage libre : pas de fichier de reference, chaque code scanne est ajoute et compte. Continuer ?')) return;
  S={ fileName:'comptage_libre', headers:['Code-barres','Désignation'], rows:[], counts:[], locations:[], theo:null, curLoc:'',
      barcodeKey:'Code-barres', designationKey:'Désignation', refKey:'', locationKey:'',
      location:'WH/Stock', produitSource:'barcode', freeMode:true, operator:op };
  S.index=IC.buildIndex(S.rows,S.barcodeKey).idx; undoStack=[]; saveNow(); goScan();
  toast('Comptage libre demarre');
}
function startFromSaved(sv){
  S={ fileName:sv.fileName, headers:sv.headers, rows:sv.rows, counts:sv.counts,
      locations:sv.locations||sv.rows.map(function(){return '';}), theo:sv.theo||null, curLoc:sv.curLoc||'',
      barcodeKey:sv.barcodeKey, designationKey:sv.designationKey, refKey:sv.refKey, locationKey:sv.locationKey||'',
      location:sv.location, produitSource:sv.produitSource, freeMode:!!sv.freeMode, operator:sv.operator||'' };
  S.index=IC.buildIndex(S.rows,S.barcodeKey).idx; undoStack=[]; recents=[]; goScan();
}
function goScan(){ $('screenImport').classList.add('hide'); $('screenScan').classList.remove('hide');
  if((window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.BarcodeScanner) || 'BarcodeDetector' in window) $('btnCam').classList.remove('hide');
  applySettingsUI(); updateOpUI(); updateLocBar(); render(); focusScan(); }
function updateOpUI(){ var el=$('sOp'); if(el) el.textContent=(S&&S.operator)?S.operator:'—'; }

/* ---------- Clavier / scanner ----------
   Trois chemins de scan, pour couvrir tous les PDA :
   1. wedgeCapture (document, phase capture) : lecteurs qui envoient de VRAIS evenements
      clavier — aucun champ n'a besoin d'etre focalise (WebView recents).
   2. Champ #scan focalise : lecteurs qui INSERENT le texte comme un IME sans evenements
      de touche (vieux WebView Honeywell/Zebra) — traite sur Entree, sur 'change', ou
      apres 150 ms d'inactivite du champ.
   3. Bouton « ⌨ Saisie » : clavier virtuel pour taper un code a la main.
   Clavier virtuel : masque NATIVEMENT des qu'il apparait (plugin Capacitor Keyboard,
   fiable meme sur vieux Android), sauf en saisie manuelle. inputmode=none en plus
   pour les WebView recents. Le champ n'est PAS readonly (ca bloquerait l'insertion IME). */
var kbManual=false;
var KBP = PL.Keyboard;
/* ANTI-TEMPETE : ne jamais boucler show->hide->show (ca sature le thread natif et fige
   le tactile — constate sur PDA Honeywell). On ferme le clavier UNE fois ; s'il revient
   dans les 2,5 s, on le laisse visible plutot que de geler l'ecran. */
var kbHideLast=0;
if(KBP && KBP.addListener){
  KBP.addListener('keyboardDidShow', function(){
    if(kbManual || !KBP.hide) return;
    if(SET.scanMode!=='field') return;
    if(!S || $('screenScan').classList.contains('hide')) return;
    if(!$('diag').classList.contains('hide')) return;
    var ae=document.activeElement||{}, tag=(ae.tagName||'').toLowerCase();
    if((tag==='input'||tag==='textarea'||tag==='select') && ae.id!=='scan') return;
    var now=Date.now();
    if(now-kbHideLast<2500) return;
    kbHideLast=now;
    KBP.hide()['catch'](function(){});
  });
}
function setKbMode(manual){
  kbManual=manual;
  var el=$('scan');
  el.setAttribute('inputmode', manual?'text':'none');
  $('btnKb').classList.toggle('on', manual);
  if(manual){ try{ el.blur(); }catch(e){} setTimeout(function(){ try{ el.focus(); }catch(e){} }, 50); }
  else { if(KBP && KBP.hide){ KBP.hide()['catch'](function(){}); } focusScan(); }
}
var scanBuf='', scanBufT=null;
function bufReset(){ scanBuf=''; clearTimeout(scanBufT); }
function wedgeCapture(e){
  if(!S || kbManual) return;
  if($('screenScan').classList.contains('hide')) return;
  if(!$('camWrap').classList.contains('hide')) return;
  if(!$('menu').classList.contains('hide') || !$('settings').classList.contains('hide')) return;
  var t=e.target||{}, tag=(t.tagName||'').toLowerCase();
  if(t.id==='search') return;
  if((tag==='input'||tag==='select'||tag==='textarea') && t.id!=='scan') return;
  if(!$('diag').classList.contains('hide')) return;
  if(e.key==='Enter'||e.key==='Tab'){
    if(scanBuf){ e.preventDefault(); e.stopPropagation(); var v=scanBuf; bufReset(); $('scan').value=''; processScan(v); }
    return;
  }
  if(e.key && e.key.length===1 && !e.ctrlKey && !e.altKey && !e.metaKey){
    e.preventDefault(); scanBuf+=e.key; $('scan').value=scanBuf;
    clearTimeout(scanBufT); scanBufT=setTimeout(function(){ bufReset(); $('scan').value=''; }, 3000);
  }
}
document.addEventListener('keydown', wedgeCapture, true);
/* Focus du champ scan : uniquement en mode 'field' (insertion IME). En mode 'keys',
   AUCUN focus — la capture globale suffit et on ne reveille jamais le clavier. */
function focusScan(){ if(kbManual || SET.scanMode!=='field') return; var el=$('scan');
  if(el && !$('screenScan').classList.contains('hide') && $('camWrap').classList.contains('hide')
     && document.activeElement!==el){ try{ el.focus(); }catch(e){} } }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function setFB(kind,big,sub){ var f=$('fb'); f.className=''; if(kind)f.classList.add(kind); f.innerHTML='<div class="big">'+big+'</div><div class="sub">'+(sub||'')+'</div>'; }
function updateLocBar(){ var el=$('curLoc'); if(el){ el.textContent=S.curLoc?S.curLoc:'— aucun —'; el.style.color=S.curLoc?'var(--loc)':'var(--mut)'; } }
function setCurrentLocation(code){ code=IC.normLoc(code); S.curLoc=code; updateLocBar();
  jlog({k:'curloc',l:code});
  setFB('loc','Emplacement : '+esc(code),'Les prochains scans seront rattaches a cet emplacement.');
  beep('loc'); vibrate(30); saveSoon(); toast('Emplacement courant : '+code); }

/* ---------- Scan ---------- */
function addUnknownScanned(code){
  var i=IC.addUnknown(S,code,''); IC.applyScan(S,code,1);
  jlog({k:'add',c:code}); jlog({k:'scan',c:code,l:(SET.locEnabled&&S.curLoc)?S.curLoc:''});
  var u={row:i,delta:1};
  if(SET.locEnabled && S.curLoc){ u.locPrev=''; u.locSet=S.curLoc; IC.setProductLocation(S,i,S.curLoc); }
  undoStack.push(u);
  setFB('warn','Hors fichier : '+esc(code),'Compte <b>1</b>'+((SET.locEnabled&&S.curLoc)?' - <b>'+esc(S.curLoc)+'</b>':'')+' — code absent du fichier initial, il sera dans l export');
  beep('ok'); vibrate(40); touchRecent(i); render(); saveSoon();
}
function processScan(raw){
  var lc=IC.parseLocationCode(raw);
  if(lc){
    if(!SET.locEnabled){ setFB('err','Emplacements desactives','Active la gestion des emplacements dans ⋯ → Reglages.'); beep('err'); return; }
    setCurrentLocation(lc); return;
  }
  var res=IC.applyScan(S,raw,1); if(res.status==='empty') return;
  if(res.status==='ok'){
    var u={row:res.row, delta:1};
    if(SET.locEnabled && S.curLoc){ u.locPrev=IC.getProductLocation(S,res.row); u.locSet=S.curLoc; IC.setProductLocation(S,res.row,S.curLoc); }
    undoStack.push(u);
    jlog({k:'scan',c:res.code,l:(SET.locEnabled&&S.curLoc)?S.curLoc:''});
    var name=S.designationKey?(S.rows[res.row][S.designationKey]||''):'';
    var locTxt=IC.getProductLocation(S,res.row);
    setFB('ok','OK '+esc(name||res.code),'Quantite : <b>'+res.count+'</b>'+(locTxt?' - <b>'+esc(locTxt)+'</b>':'')+' - code '+esc(res.code));
    beep('ok'); vibrate(40); touchRecent(res.row); render(); saveSoon();
  } else {
    if(SET.autoAdd || S.freeMode){ addUnknownScanned(res.code); return; }
    setFB('err','Code inconnu','<div>'+esc(res.code)+'</div><button class="btn ghost" id="addUnk" style="margin-top:8px">+ Ajouter ce code a la liste</button>');
    beep('err'); vibrate([60,40,60]);
    var b=$('addUnk'); if(b) b.onclick=function(){ addUnknownScanned(res.code); focusScan(); };
  }
}
function doUndo(){ if(!undoStack.length){ toast('Rien a annuler'); return; }
  var u=undoStack.pop(); S.counts[u.row]=(S.counts[u.row]||0)-u.delta; if(S.counts[u.row]<0)S.counts[u.row]=0;
  if(u.hasOwnProperty('locPrev')) IC.setProductLocation(S,u.row,u.locPrev);
  jlog({k:'cnt',r:u.row,q:S.counts[u.row]});
  if(u.hasOwnProperty('locPrev')) jlog({k:'loc',r:u.row,l:u.locPrev||''});
  var name=S.designationKey?(S.rows[u.row][S.designationKey]||''):'';
  setFB('','Annule',esc(name)+' - qte '+S.counts[u.row]); touchRecent(u.row); render(); saveSoon(); toast('Derniere action annulee'); vibrate(30); }
function manual(row,delta){ var before=S.counts[row]||0, after=before+delta; if(after<0)after=0;
  if(after!==before){ undoStack.push({row:row, delta:after-before}); jlog({k:'cnt',r:row,q:after}); }
  S.counts[row]=after; updateRow(row); refreshStats(); saveSoon(); }

/* ---------- Rendu liste ----------
   PERFORMANCE PDA : on n'affiche JAMAIS la liste complete (1400 lignes de DOM
   redessinees a chaque scan figeaient le tactile des vieux WebView). Par defaut :
   les 5 derniers scans. La recherche n'affiche des resultats (20 max) que si
   l'utilisateur tape au moins 2 caracteres. */
function refreshStats(){ var t=IC.totals(S), ls=IC.locationStats(S); $('sUnits').textContent=t.units; $('sDist').textContent=t.distinct; $('sLoc').textContent=ls.withLocation; $('sZero').textContent=t.zero; }
var filterTimer=null, recents=[];
function touchRecent(row){ var i=recents.indexOf(row); if(i!==-1) recents.splice(i,1); recents.unshift(row); if(recents.length>5) recents.pop(); }
function render(){ refreshStats(); var q=IC.stripAccentsLower($('search').value); var html='', shown=0;
  if(q.length>=2){
    var LIM=20;
    for(var i=0;i<S.rows.length && shown<LIM;i++){
      var hay=IC.stripAccentsLower((S.designationKey?S.rows[i][S.designationKey]:'')+' '+(S.refKey?S.rows[i][S.refKey]:'')+' '+S.rows[i][S.barcodeKey]+' '+IC.getProductLocation(S,i));
      if(hay.indexOf(q)===-1) continue;
      html+=itemHTML(i); shown++;
    }
    $('listCount').textContent=shown+(shown>=LIM?'+':'')+' resultat(s)';
    $('list').innerHTML=html || '<p class="muted">Aucun resultat.</p>';
  } else {
    for(var r=0;r<recents.length;r++){ html+=itemHTML(recents[r]); shown++; }
    $('listCount').textContent=shown?'derniers scans':'';
    $('list').innerHTML=html || '<p class="muted">Les produits scannes s afficheront ici (les 5 derniers).</p>';
  }
  bindItems(); }
function smallHTML(i){ var ref=S.refKey?(S.rows[i][S.refKey]||''):''; var bc=S.rows[i][S.barcodeKey]||''; var loc=IC.getProductLocation(S,i);
  return esc(ref)+(ref?' . ':'')+esc(bc)+((loc&&SET.locEnabled)?'<span class="badge-loc">'+esc(loc)+'</span>':''); }
function itemHTML(i){ var name=S.designationKey?(S.rows[i][S.designationKey]||''):''; var bc=S.rows[i][S.barcodeKey]||''; var q=S.counts[i]||0;
  return '<div class="item'+(q>0?' has':'')+'" data-i="'+i+'"><div class="d"><b>'+esc(name||bc)+'</b><small id="s'+i+'">'+smallHTML(i)+'</small></div>'+
    '<button data-act="m" data-i="'+i+'">-</button><div class="q" id="q'+i+'">'+q+'</div><button data-act="p" data-i="'+i+'">+</button></div>'; }
function bindItems(){ each($('list').querySelectorAll('button[data-act]'), function(b){ b.onclick=function(){ var i=+b.getAttribute('data-i'); manual(i, b.getAttribute('data-act')==='p'?1:-1); }; }); }
function updateRow(i){ var qel=$('q'+i); if(qel){ qel.textContent=S.counts[i]||0; var it=qel.closest('.item'); if(it){ if(S.counts[i]>0)it.classList.add('has'); else it.classList.remove('has'); } }
  var sel=$('s'+i); if(sel) sel.innerHTML=smallHTML(i); }

/* ---------- Reglages : application a l'interface ---------- */
function applySettingsUI(){
  var on=SET.locEnabled;
  each(['locbarWrap','sLocWrap','detLocRow','btnExpLoc'],function(id){ var el=$(id); if(el) el.classList.toggle('hide',!on); });
  var sl=$('setLoc'); if(sl) sl.checked=on;
  var sa=$('setAuto'); if(sa) sa.checked=SET.autoAdd;
  var sm=$('setScanMode'); if(sm) sm.value=SET.scanMode;
}

/* ---------- Exports (ecriture FICHIER + partage) ---------- */
/* Tracabilite : l'operateur est inscrit dans le nom des fichiers exportes, et en
   colonne dans les rapports (sauf l'export Odoo, garde au format d'import pur). */
function fileTag(){ var op=(S&&S.operator)?'_'+S.operator.replace(/[^A-Za-z0-9_-]+/g,'_'):''; return todayTag()+op; }
function withOperator(rows){ var op=(S&&S.operator)||''; rows.forEach(function(r){ r['Opérateur']=op; }); return rows; }
function saveCsv(name, csv){
  if(FS){
    return FS.mkdir({ path:DOCS_SUB, directory:DIR_DOCS, recursive:true }).catch(function(){})
      .then(function(){ return FS.writeFile({ path:DOCS_SUB+'/'+name, data:csv, directory:DIR_DOCS, encoding:ENC }); })
      .then(function(){ return FS.getUri({ path:DOCS_SUB+'/'+name, directory:DIR_DOCS }).catch(function(){ return null; }); })
      .then(function(u){ toast('Enregistre : Documents/'+DOCS_SUB+'/'+name);
        if(ShareP && u && u.uri){ ShareP.share({ title:name, text:'Inventaire SmartIDS', url:u.uri }).catch(function(){}); } });
  }
  var blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); setTimeout(function(){URL.revokeObjectURL(a.href); a.remove();},800); return Promise.resolve();
}
function exportOdoo(){ var rows=IC.buildOdooRows(S,{location:S.location, includeZero:$('incZero').checked, produitSource:S.produitSource, detailed:SET.locEnabled&&$('detLoc').checked});
  if(!rows.length){ alert('Aucune ligne a exporter (coche "inclure les lignes a 0" pour un inventaire complet).'); return; }
  var unk=rows.filter(function(r){return /INCONNU/.test(String(r['Désignation']));}).length;
  if(unk && !confirm(unk+' code(s) inconnu(s) inclus. Ils devront exister dans Odoo avant import. Continuer ?')) return;
  saveCsv('Inventaire_Odoo_'+fileTag()+'.csv', IC.toCSV(rows,['Produit','Désignation','Emplacement','Quantité comptée'],';')); }
function exportLocations(){ var rows=IC.buildLocationRows(S,{onlyWithLocation:true, produitSource:S.produitSource});
  if(!rows.length){ alert('Aucun produit n a d emplacement affecte. Scanne d abord une etiquette d emplacement, puis les produits.'); return; }
  saveCsv('Emplacements_produits_'+fileTag()+'.csv', IC.toCSV(withOperator(rows),['Produit','Code-barres','Désignation','Emplacement','Quantité comptée','Opérateur'],';')); }
function exportFull(){ var rows=IC.buildFullRows(S,$('incZero').checked); if(!rows.length){ alert('Aucune ligne a exporter.'); return; }
  var headers=S.headers.concat(['Quantité comptée','Emplacement affecté','Opérateur']); saveCsv('Inventaire_complet_'+fileTag()+'.csv', IC.toCSV(withOperator(rows),headers,';')); }
function exportGaps(){
  var hasTheo = !!(S.theo && S.theo.some(function(v){ return v; }));
  if(!hasTheo && !confirm('Aucune quantite theorique importee (colonne stock au chargement du fichier). L ecart sera calcule par rapport a 0. Continuer ?')) return;
  var rows=IC.buildGapRows(S,{produitSource:S.produitSource});
  if(!rows.length){ alert('Aucun ecart constate entre le fichier et le comptage.'); return; }
  var gs=IC.gapStats(S);
  saveCsv('Rapport_ecarts_'+fileTag()+'.csv', IC.toCSV(withOperator(rows),['Produit','Code-barres','Désignation','Qté théorique','Qté comptée','Écart','Emplacement affecté','Opérateur'],';'))
    .then(function(){ toast(gs.withGap+' ecart(s) : '+gs.plus+' en exces, '+gs.minus+' en manque'); });
}
/* Sauvegarde complete via la feuille de partage Android (Drive, mail, WhatsApp...).
   Optionnel et jamais bloquant : aucune liaison de compte necessaire. */
function shareBackup(){
  flushSave().then(function(){
    if(FS && ShareP){
      return FS.getUri({ path:DOCS_SUB+'/'+DATA_FILE, directory:DIR_DOCS })
        .then(function(u){ if(u&&u.uri) return ShareP.share({ title:'Sauvegarde SmartIDS', text:'Sauvegarde inventaire SmartIDS '+fileTag(), url:u.uri }); })
        .catch(function(){ toast('Partage indisponible'); });
    }
    var blob=new Blob([JSON.stringify(stateForSave())],{type:'application/json'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='smartids_sauvegarde_'+todayTag()+'.json';
    document.body.appendChild(a); a.click(); setTimeout(function(){URL.revokeObjectURL(a.href); a.remove();},800);
  });
}

/* ---------- Camera ----------
   Telephone : scanner NATIF Google ML Kit (plugin @capacitor-mlkit/barcode-scanning,
   methode scan() = Google code scanner : aucune permission camera a gerer, UI plein
   ecran fournie par Play Services, tres fiable). Relance automatique apres chaque code
   (scan en continu) jusqu'a annulation par l'utilisateur.
   Secours web (BarcodeDetector + getUserMedia) pour les appareils sans Play Services. */
var MLScan = PL.BarcodeScanner;
function isNative(){ try{ return typeof CAP.isNativePlatform==='function' ? CAP.isNativePlatform() : !!CAP.isNative; }catch(e){ return false; } }
var mlLoop=false;
function mlScanLoop(){
  MLScan.scan().then(function(r){
    var codes=(r && r.barcodes) || [];
    if(codes.length){
      var v=codes[0].rawValue || codes[0].displayValue || '';
      if(v) processScan(String(v));
      if(mlLoop) setTimeout(mlScanLoop, 300);   /* scan suivant */
    } else { mlLoop=false; }
  })['catch'](function(err){
    mlLoop=false;
    var msg=String((err && err.message) || err || '');
    if(/module/i.test(msg) && MLScan.installGoogleBarcodeScannerModule){
      toast('Installation du module de scan Google… reessaie dans quelques secondes');
      MLScan.installGoogleBarcodeScannerModule()['catch'](function(){});
    } else if(!/cancel/i.test(msg)){ toast('Scanner indisponible : '+msg.slice(0,60)); }
  });
}
function camStart(){
  if(MLScan && isNative()){ if(mlLoop) return; mlLoop=true; mlScanLoop(); return; }
  camStartWeb();
}
var camStream=null, camRun=false, det=null;
function camStartWeb(){ if(!('BarcodeDetector' in window)) return;
  det=new window.BarcodeDetector({formats:['ean_13','ean_8','code_128','code_39','upc_a','upc_e','itf','codabar']});
  $('camWrap').classList.remove('hide');
  navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}}).then(function(st){ camStream=st; var v=$('cam'); v.srcObject=st; v.play(); camRun=true; loop(); })
    .catch(function(){ toast('Camera refusee'); $('camWrap').classList.add('hide'); });
  function loop(){ if(!camRun) return; det.detect($('cam')).then(function(codes){ if(codes&&codes.length){ var c=codes[0].rawValue, now=Date.now(); if(!(c===lastScan.code && now-lastScan.t<1200)){ lastScan={code:c,t:now}; processScan(c); } } }).catch(function(){}).then(function(){ if(camRun) requestAnimationFrame(loop); }); } }
function camStop(){ mlLoop=false; camRun=false; if(camStream){ each(camStream.getTracks(),function(t){t.stop();}); camStream=null;} $('camWrap').classList.add('hide'); focusScan(); }

/* ---------- Menu / reglages ---------- */
function openMenu(){ $('mnuVer').textContent='SmartIDS Inventaire v'+APP_VERSION; $('menu').classList.remove('hide'); }
function closeMenu(){ $('menu').classList.add('hide'); focusScan(); }
function openSettings(){ applySettingsUI(); $('setOp').value = S ? (S.operator||'') : (SET.lastOp||''); $('settings').classList.remove('hide'); }
function closeSettings(){ $('settings').classList.add('hide'); focusScan(); }

/* ---------- Nouvel inventaire ---------- */
function newInventory(){ if(!confirm('Demarrer un NOUVEL inventaire ? L inventaire en cours doit avoir ete exporte, il sera efface.')) return;
  persistClear().then(function(){ S=null; undoStack=[]; $('screenScan').classList.add('hide'); $('screenImport').classList.remove('hide'); $('mapCard').classList.add('hide'); $('file').value=''; closeMenu(); toast('Pret pour un nouvel inventaire'); }); }

/* ---------- Evenements ---------- */
$('file').addEventListener('change',function(e){ var f=e.target.files[0]; if(!f) return;
  readFile(f).then(function(p){ p._name=f.name.replace(/\.[^.]+$/,''); onParsed(p); }).catch(function(err){ alert('Erreur de lecture : '+err.message); }); });
$('btnStart').addEventListener('click',startFromParsed);
$('btnFree').addEventListener('click',startFreeCount);
/* Entree/Tab et 'change' : lecteurs a evenements clavier (via le champ) + saisie manuelle. */
var suppressChange=false, inputT=null;
$('scan').addEventListener('keydown',function(e){
  if(e.key==='Enter'||e.key==='Tab'){ e.preventDefault(); clearTimeout(inputT);
    var v=this.value; this.value=''; suppressChange=true; setTimeout(function(){suppressChange=false;},0);
    if(v.trim()) processScan(v); if(kbManual) setKbMode(false); } });
$('scan').addEventListener('change',function(){
  if(suppressChange){ suppressChange=false; this.value=''; return; }
  clearTimeout(inputT);
  if(this.value.trim()){ var v=this.value; this.value=''; processScan(v); if(kbManual) setKbMode(false); } });
/* Lecteurs qui INSERENT le texte sans evenements de touche (IME des vieux PDA) :
   traitement des qu'un saut de ligne apparait, ou apres 150 ms sans nouvelle insertion.
   Jamais en saisie manuelle (un humain tape lentement). */
$('scan').addEventListener('input',function(){
  if(kbManual) return;
  var el=this, v=el.value;
  if(!v || v===scanBuf) return;
  if(/[\r\n]/.test(v)){ clearTimeout(inputT); el.value=''; v=v.replace(/[\r\n]/g,' ').trim(); if(v) processScan(v.split(' ')[0]); return; }
  clearTimeout(inputT);
  inputT=setTimeout(function(){ var vv=el.value; el.value=''; if(vv.trim()) processScan(vv.trim()); }, 150);
});
$('undo').addEventListener('click',doUndo);
$('btnKb').addEventListener('click',function(){ setKbMode(!kbManual); });
$('btnSetLoc').addEventListener('click',function(){ var c=prompt('Emplacement courant (ex : A-03-B). Astuce : scanne plutot l etiquette.', S.curLoc||''); if(c==null) return; c=IC.normLoc(c); if(c) setCurrentLocation(c); else { S.curLoc=''; jlog({k:'curloc',l:''}); updateLocBar(); saveSoon(); } focusScan(); });
$('btnClrLoc').addEventListener('click',function(){ S.curLoc=''; jlog({k:'curloc',l:''}); updateLocBar(); saveSoon(); toast('Emplacement courant efface'); focusScan(); });
$('search').addEventListener('input',function(){ clearTimeout(filterTimer); filterTimer=setTimeout(render,150); });
$('btnExp').addEventListener('click',function(){ closeMenu(); exportOdoo(); });
$('btnGap').addEventListener('click',function(){ closeMenu(); exportGaps(); });
$('btnExpLoc').addEventListener('click',function(){ closeMenu(); exportLocations(); });
$('btnExpFull').addEventListener('click',function(){ closeMenu(); exportFull(); });
$('btnCam').addEventListener('click',camStart);
$('btnCamStop').addEventListener('click',camStop);
$('btnMenu').addEventListener('click',function(){ if(!S){ openSettings(); return; } openMenu(); });
$('mnuBackup').addEventListener('click',function(){ closeMenu(); shareBackup(); });
$('mnuSettings').addEventListener('click',function(){ closeMenu(); openSettings(); });
$('mnuNew').addEventListener('click',newInventory);
$('mnuClose').addEventListener('click',closeMenu);
$('menu').addEventListener('click',function(e){ if(e.target===this) closeMenu(); });
$('setClose').addEventListener('click',closeSettings);
$('settings').addEventListener('click',function(e){ if(e.target===this) closeSettings(); });
$('setLoc').addEventListener('change',function(){ SET.locEnabled=this.checked; settingsSave(); applySettingsUI(); if(S){ render(); } });
$('setAuto').addEventListener('change',function(){ SET.autoAdd=this.checked; settingsSave(); });
$('setOp').addEventListener('change',function(){ var op=this.value.trim(); if(!op) return;
  SET.lastOp=op; settingsSave();
  if(S && op!==S.operator){ S.operator=op; jlog({k:'op',l:op}); updateOpUI(); saveSoon(); toast('Operateur : '+op); } });
$('setScanMode').addEventListener('change',function(){ SET.scanMode=this.value; settingsSave();
  if(SET.scanMode==='keys'){ try{ $('scan').blur(); }catch(e){} } else { focusScan(); }
  toast(SET.scanMode==='keys'?'Mode touches clavier (Wedge as keys)':'Mode champ focalise'); });
$('btnDiag').addEventListener('click',openDiag);
$('diagClose').addEventListener('click',closeDiag);
$('diagClear').addEventListener('click',function(){ $('diagLog').innerHTML=''; });
/* Re-focus doux du champ scan (chemin IME, mode 'field' seulement) : sur tap d'une
   zone NON interactive, throttle 800 ms, jamais de boucle blur->focus. */
var refocusLast=0;
document.addEventListener('click',function(e){ if(!S || kbManual || SET.scanMode!=='field') return;
  if($('screenScan').classList.contains('hide')) return;
  if(!$('camWrap').classList.contains('hide')) return;
  if(!$('menu').classList.contains('hide') || !$('settings').classList.contains('hide') || !$('diag').classList.contains('hide')) return;
  var tag=(e.target.tagName||'').toLowerCase();
  if(tag==='input'||tag==='button'||tag==='select'||tag==='a'||tag==='video'||tag==='label') return;
  var now=Date.now(); if(now-refocusLast<800) return; refocusLast=now;
  setTimeout(focusScan,0); });
$('scan').addEventListener('blur',function(){ if(kbManual) setKbMode(false); });

/* ---------- Diagnostic scan (Reglages -> 🔧) : journal en direct de TOUT ce que le
   lecteur emet (touches, insertions, focus, clavier) pour diagnostiquer un PDA. ---------- */
var diagOn=false;
function dlog(s){ if(!diagOn) return; var el=$('diagLog'); if(!el) return;
  var d=new Date(); function p(n){return(n<10?'0':'')+n;}
  el.innerHTML+=p(d.getMinutes())+':'+p(d.getSeconds())+'.'+Math.floor(d.getMilliseconds()/100)+' '+esc(s)+'<br>';
  el.scrollTop=el.scrollHeight; }
each(['keydown','keyup'],function(t){ document.addEventListener(t,function(e){
  dlog(t+' key='+(e.key===undefined?'(indefini)':e.key)+' code='+e.keyCode); },true); });
document.addEventListener('keypress',function(e){ dlog('keypress code='+e.keyCode); },true);
document.addEventListener('input',function(e){ var t=e.target||{};
  dlog('input #'+(t.id||t.tagName)+' = "'+String(t.value||'').slice(-30)+'"'); },true);
document.addEventListener('focusin',function(e){ dlog('focus -> #'+((e.target||{}).id||(e.target||{}).tagName)); },true);
document.addEventListener('focusout',function(e){ dlog('blur  <- #'+((e.target||{}).id||(e.target||{}).tagName)); },true);
if(KBP && KBP.addListener){ each(['keyboardWillShow','keyboardDidShow','keyboardWillHide','keyboardDidHide'],function(ev){
  KBP.addListener(ev,function(){ dlog('[clavier] '+ev); }); }); }
function openDiag(){ $('settings').classList.add('hide'); diagOn=true; $('diagLog').innerHTML='';
  $('diag').classList.remove('hide'); dlog('diagnostic demarre v'+APP_VERSION+' — scanne dans le champ ci-dessus');
  setTimeout(function(){ try{ $('diagIn').value=''; $('diagIn').focus(); }catch(e){} },100); }
function closeDiag(){ diagOn=false; $('diag').classList.add('hide'); }

/* Filets de securite: sauvegarde immediate quand l'app passe en arriere-plan / se ferme */
window.addEventListener('pagehide', function(){ flushSave(); });
document.addEventListener('visibilitychange', function(){ if(document.hidden) flushSave(); });
if(AppP && AppP.addListener){ AppP.addListener('pause', function(){ flushSave(); }); AppP.addListener('appStateChange', function(st){ if(st && st.isActive===false) flushSave(); }); }

/* ---------- Demarrage : reglages + auto-reprise (fichier -> fallbacks -> rejeu journal) ---------- */
(function boot(){
  each(document.querySelectorAll('.ver'), function(el){ el.textContent='v'+APP_VERSION; });
  settingsLoad().then(function(){
    applySettingsUI();
    if(SET.lastOp) $('mOp').value=SET.lastOp;
    $('mLocEnabled').checked=SET.locEnabled;
    return persistRead();
  }).then(function(res){
    var sv=res && res.sv;
    if(sv && sv.rows && sv.rows.length){
      startFromSaved(sv);
      return journalRead().then(function(entries){
        var replayed=applyJournal(entries, sv.savedAt||0);
        return saveNow().then(function(){ return journalClear(); }).then(function(){
          jFlushBuffer();
          updateLocBar(); render();
          var n=S.counts.reduce(function(a,b){return a+(b||0);},0);
          var msg='Inventaire repris ('+n+' u.)';
          if(replayed) msg+=' — '+replayed+' action(s) recuperee(s) du journal';
          if(res.src) msg+=' — source : '+res.src;
          toast(msg);
        });
      });
    }
    return journalClear().then(function(){ jFlushBuffer(); var r=$('resume'); if(r) r.classList.add('hide'); });
  });
})();
})();
