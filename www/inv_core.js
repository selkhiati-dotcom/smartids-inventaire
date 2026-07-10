/* inv_core.js -- logique pure de l'inventaire scan (integree telle quelle dans l'appli HTML). */
(function (root) {
  'use strict';

  function detectDelimiter(text) {
    var firstLine = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
    var counts = { ';': 0, ',': 0, '\t': 0 };
    var inQ = false;
    for (var i = 0; i < firstLine.length; i++) {
      var c = firstLine[i];
      if (c === '"') inQ = !inQ;
      else if (!inQ && counts.hasOwnProperty(c)) counts[c]++;
    }
    var best = ';', bestN = -1;
    for (var d in counts) if (counts[d] > bestN) { bestN = counts[d]; best = d; }
    return bestN <= 0 ? ';' : best;
  }

  function parseDelimited(text, delim) {
    text = String(text).replace(/^\uFEFF/, '');
    delim = delim || detectDelimiter(text);
    var rows = [], field = '', row = [], inQ = false, i = 0, n = text.length;
    while (i < n) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === delim) { row.push(field); field = ''; i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      field += c; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); });
    if (!rows.length) return { headers: [], rows: [] };
    var headers = rows[0].map(function (h) { return String(h).trim(); });
    var out = [];
    for (var k = 1; k < rows.length; k++) {
      var o = {};
      for (var j = 0; j < headers.length; j++) o[headers[j]] = rows[k][j] != null ? rows[k][j] : '';
      out.push(o);
    }
    return { headers: headers, rows: out };
  }

  function stripAccentsLower(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function detectColumns(headers) {
    var H = headers.map(function (h) { return { raw: h, n: stripAccentsLower(h) }; });
    function find(cands) {
      for (var c = 0; c < cands.length; c++)
        for (var k = 0; k < H.length; k++)
          if (H[k].n === cands[c]) return H[k].raw;
      for (var c2 = 0; c2 < cands.length; c2++)
        for (var k2 = 0; k2 < H.length; k2++)
          if (H[k2].n.indexOf(cands[c2]) !== -1) return H[k2].raw;
      return '';
    }
    return {
      barcode: find(['code-barres', 'code barres', 'codebarres', 'barcode', 'ean', 'gencod', 'produit', 'code']),
      ref: find(['reference', 'ref', 'default_code', 'code interne', 'article']),
      designation: find(['designation', 'designation produit', 'name', 'nom', 'libelle', 'produit']),
      price: find(['prix', 'price', 'list_price', 'pu']),
      location: find(['emplacement', 'localisation', 'location', 'rangement', 'adresse', 'stockage', 'position']),
      qty: find(['quantite comptee', 'qte comptee', 'comptee']),
      theo: find(['quantite theorique', 'stock theorique', 'stock reel', 'quantite en stock', 'qte en stock',
        'stock disponible', 'quantite disponible', 'qty_available', 'on hand', 'quantite', 'qte', 'qty', 'quantity', 'stock'])
    };
  }

  function normBarcode(v) {
    if (v == null) return '';
    var s = String(v).trim();
    if (/^\d+(\.\d+)?[eE]\+?\d+$/.test(s)) {
      var num = Number(s);
      if (isFinite(num) && Math.abs(num) < 1e15) return String(Math.round(num));
      return s;
    }
    s = s.replace(/\s+/g, '');
    s = s.replace(/[\u0000-\u001F\u007F]/g, '');
    if (/^\d+\.0+$/.test(s)) s = s.split('.')[0];
    return s;
  }

  function buildIndex(rows, barcodeKey) {
    var idx = new Map(), dups = [];
    for (var i = 0; i < rows.length; i++) {
      var code = normBarcode(rows[i][barcodeKey]);
      if (!code) continue;
      if (idx.has(code)) { idx.get(code).push(i); dups.push(code); }
      else idx.set(code, [i]);
    }
    /* dedup ES5 (Array.from + Set indisponibles sur les vieux WebView de PDA) */
    var seen = {}, uniq = [];
    for (var d = 0; d < dups.length; d++) { if (!seen[dups[d]]) { seen[dups[d]] = 1; uniq.push(dups[d]); } }
    return { idx: idx, dups: uniq };
  }

  function applyScan(state, rawCode, delta) {
    delta = (delta == null) ? 1 : delta;
    var code = normBarcode(rawCode);
    if (!code) return { status: 'empty', code: code };
    var hit = state.index.get(code);
    if (hit && hit.length) {
      var r = hit[0];
      state.counts[r] = (state.counts[r] || 0) + delta;
      if (state.counts[r] < 0) state.counts[r] = 0;
      return { status: 'ok', code: code, row: r, count: state.counts[r] };
    }
    return { status: 'unknown', code: code };
  }

  function addUnknown(state, rawCode, designation) {
    var code = normBarcode(rawCode);
    var o = {};
    o[state.barcodeKey] = code;
    if (state.designationKey) o[state.designationKey] = designation || 'INCONNU (scanne)';
    state.rows.push(o);
    state.counts.push(0);
    if (state.locations) state.locations.push('');
    if (state.theo) state.theo.push(0);
    var i = state.rows.length - 1;
    if (!state.index.has(code)) state.index.set(code, []);
    state.index.get(code).push(i);
    return i;
  }

  function buildOdooRows(state, opts) {
    opts = opts || {};
    var loc = opts.location || 'WH/Stock';
    var includeZero = !!opts.includeZero;
    var detailed = !!opts.detailed;
    var src = opts.produitSource === 'ref' ? state.refKey : state.barcodeKey;
    var DESIG = 'Désignation', QTE = 'Quantité comptée';
    var out = [];
    for (var i = 0; i < state.rows.length; i++) {
      var qty = state.counts[i] || 0;
      if (!includeZero && qty <= 0) continue;
      var prod = state.rows[i][src];
      if (prod == null || String(prod).trim() === '') prod = state.rows[i][state.barcodeKey];
      var o = {};
      o['Produit'] = normBarcode(prod);
      o[DESIG] = state.designationKey ? (state.rows[i][state.designationKey] || '') : '';
      var pl = detailed ? getProductLocation(state, i) : '';
      o['Emplacement'] = pl ? joinLocation(loc, pl) : loc;
      o[QTE] = qty;
      out.push(o);
    }
    return out;
  }

  function buildFullRows(state, includeZero) {
    var QTE = 'Quantité comptée', EMP = 'Emplacement affecté';
    var out = [];
    for (var i = 0; i < state.rows.length; i++) {
      var qty = state.counts[i] || 0;
      if (!includeZero && qty <= 0) continue;
      var o = {};
      state.headers.forEach(function (h) { o[h] = state.rows[i][h] != null ? state.rows[i][h] : ''; });
      o[QTE] = qty;
      o[EMP] = getProductLocation(state, i);
      out.push(o);
    }
    return out;
  }

  function toCSV(rows, headers, delim) {
    delim = delim || ';';
    if (!headers) headers = rows.length ? Object.keys(rows[0]) : [];
    function esc(v) {
      v = (v == null) ? '' : String(v);
      if (v.indexOf('"') !== -1 || v.indexOf(delim) !== -1 || v.indexOf('\n') !== -1 || v.indexOf('\r') !== -1)
        return '"' + v.replace(/"/g, '""') + '"';
      return v;
    }
    var lines = [headers.map(esc).join(delim)];
    rows.forEach(function (r) { lines.push(headers.map(function (h) { return esc(r[h]); }).join(delim)); });
    return '\uFEFF' + lines.join('\r\n');
  }

  /* ----- Emplacements (adressage etagere/bac, modele 1 emplacement fixe/produit) -----
     Un code d'emplacement est prefixe par LOC- (ou @, #) pour ne jamais entrer en collision
     avec un code-barres produit (numerique). Ex: "LOC-A-03-B" -> "A-03-B". */
  var LOC_RE = /^(?:LOC[-_.:]|@|#)\s*([A-Za-z0-9][A-Za-z0-9 ._:\/-]*)$/i;

  function normLoc(v) {
    if (v == null) return '';
    return String(v).trim().replace(/\s+/g, '').toUpperCase();
  }
  function parseLocationCode(raw) {
    if (raw == null) return '';
    var m = String(raw).trim().match(LOC_RE);
    return m ? normLoc(m[1]) : '';
  }
  function isLocationCode(raw) { return parseLocationCode(raw) !== ''; }

  function getProductLocation(state, row) {
    if (!state.locations) return '';
    var v = state.locations[row];
    return v == null ? '' : v;
  }
  function setProductLocation(state, row, loc) {
    if (!state.locations) state.locations = [];
    var prev = getProductLocation(state, row);
    state.locations[row] = normLoc(loc);
    return prev;
  }
  function joinLocation(base, code) {
    base = String(base == null ? '' : base).replace(/\/+$/, '');
    code = normLoc(code);
    if (!code) return base;
    if (!base) return code;
    return base + '/' + code;
  }

  function buildLocationRows(state, opts) {
    opts = opts || {};
    var onlyLoc = opts.onlyWithLocation !== false;
    var src = opts.produitSource === 'ref' ? state.refKey : state.barcodeKey;
    var DESIG = 'Désignation', QTE = 'Quantité comptée';
    var out = [];
    for (var i = 0; i < state.rows.length; i++) {
      var loc = getProductLocation(state, i);
      if (onlyLoc && !loc) continue;
      var prod = state.rows[i][src];
      if (prod == null || String(prod).trim() === '') prod = state.rows[i][state.barcodeKey];
      var o = {};
      o['Produit'] = normBarcode(prod);
      o['Code-barres'] = normBarcode(state.rows[i][state.barcodeKey]);
      o[DESIG] = state.designationKey ? (state.rows[i][state.designationKey] || '') : '';
      o['Emplacement'] = loc;
      o[QTE] = state.counts[i] || 0;
      out.push(o);
    }
    return out;
  }

  function locationStats(state) {
    var withLoc = 0, distinctLoc = {};
    var n = state.rows ? state.rows.length : 0;
    for (var i = 0; i < n; i++) {
      var l = getProductLocation(state, i);
      if (l) { withLoc++; distinctLoc[l] = 1; }
    }
    return { withLocation: withLoc, without: n - withLoc, distinct: Object.keys(distinctLoc).length };
  }

  /* ----- Rapport d'ecarts (quantite theorique du fichier vs quantite comptee) -----
     state.theo = tableau optionnel des quantites theoriques, aligne sur state.rows. */
  function buildGapRows(state, opts) {
    opts = opts || {};
    var src = opts.produitSource === 'ref' ? state.refKey : state.barcodeKey;
    var theo = state.theo || [];
    var DESIG = 'Désignation';
    var out = [];
    for (var i = 0; i < state.rows.length; i++) {
      var t = +theo[i] || 0, q = state.counts[i] || 0, d = q - t;
      if (!opts.all && d === 0) continue;
      var prod = state.rows[i][src];
      if (prod == null || String(prod).trim() === '') prod = state.rows[i][state.barcodeKey];
      var o = {};
      o['Produit'] = normBarcode(prod);
      o['Code-barres'] = normBarcode(state.rows[i][state.barcodeKey]);
      o[DESIG] = state.designationKey ? (state.rows[i][state.designationKey] || '') : '';
      o['Qté théorique'] = t;
      o['Qté comptée'] = q;
      o['Écart'] = d;
      o['Emplacement affecté'] = getProductLocation(state, i);
      out.push(o);
    }
    return out;
  }

  function gapStats(state) {
    var theo = state.theo || [];
    var withGap = 0, plus = 0, minus = 0, sumTheo = 0, sumCounted = 0;
    var n = state.rows ? state.rows.length : 0;
    for (var i = 0; i < n; i++) {
      var t = +theo[i] || 0, q = state.counts[i] || 0, d = q - t;
      sumTheo += t; sumCounted += q;
      if (d > 0) { withGap++; plus++; }
      else if (d < 0) { withGap++; minus++; }
    }
    return { withGap: withGap, plus: plus, minus: minus, sumTheo: sumTheo, sumCounted: sumCounted };
  }

  function totals(state) {
    var units = 0, distinct = 0, zero = 0;
    for (var i = 0; i < state.counts.length; i++) {
      var q = state.counts[i] || 0;
      units += q;
      if (q > 0) distinct++; else zero++;
    }
    return { units: units, distinct: distinct, zero: zero, lines: state.counts.length };
  }

  var api = {
    detectDelimiter: detectDelimiter, parseDelimited: parseDelimited, stripAccentsLower: stripAccentsLower,
    detectColumns: detectColumns, normBarcode: normBarcode, buildIndex: buildIndex,
    applyScan: applyScan, addUnknown: addUnknown, buildOdooRows: buildOdooRows,
    buildFullRows: buildFullRows, toCSV: toCSV, totals: totals,
    parseLocationCode: parseLocationCode, isLocationCode: isLocationCode, normLoc: normLoc,
    getProductLocation: getProductLocation, setProductLocation: setProductLocation,
    joinLocation: joinLocation, buildLocationRows: buildLocationRows, locationStats: locationStats,
    buildGapRows: buildGapRows, gapStats: gapStats
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.InvCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
