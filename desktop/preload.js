/* Pont Electron -> API Capacitor Filesystem (sous-ensemble utilise par www/app.js).
   DATA      -> %APPDATA%\SmartIDS-Inventaire   (etat, journal, .bak, reglages)
   DOCUMENTS -> Documents\                      (copie visible SmartIDS\, exports, backups)
   Les erreurs REJETTENT la promesse : les fallbacks de l'app (lecture en cascade,
   catch silencieux) fonctionnent exactement comme sur Android. */
'use strict';
const { contextBridge } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'SmartIDS-Inventaire');
const DOCS_DIR = path.join(os.homedir(), 'Documents');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}

function resolve(dir, p) {
  const base = dir === 'DOCUMENTS' ? DOCS_DIR : DATA_DIR;
  const full = path.normalize(path.join(base, String(p || '')));
  if (!full.startsWith(base)) throw new Error('Chemin hors zone autorisee');
  return full;
}

const Filesystem = {
  writeFile: function (o) {
    const f = resolve(o.directory, o.path);
    return fsp.mkdir(path.dirname(f), { recursive: true })
      .then(function () { return fsp.writeFile(f, String(o.data), 'utf8'); })
      .then(function () { return { uri: f }; });
  },
  appendFile: function (o) {
    const f = resolve(o.directory, o.path);
    return fsp.mkdir(path.dirname(f), { recursive: true })
      .then(function () { return fsp.appendFile(f, String(o.data), 'utf8'); });
  },
  readFile: function (o) {
    return fsp.readFile(resolve(o.directory, o.path), 'utf8')
      .then(function (d) { return { data: d }; });
  },
  deleteFile: function (o) { return fsp.unlink(resolve(o.directory, o.path)); },
  mkdir: function (o) { return fsp.mkdir(resolve(o.directory, o.path), { recursive: !!o.recursive }); },
  rename: function (o) {
    return fsp.rename(resolve(o.directory, o.from), resolve(o.toDirectory || o.directory, o.to));
  },
  getUri: function (o) { return Promise.resolve({ uri: resolve(o.directory, o.path) }); },
  stat: function (o) {
    return fsp.stat(resolve(o.directory, o.path)).then(function (s) {
      return { type: s.isDirectory() ? 'directory' : 'file', size: s.size, mtime: s.mtimeMs };
    });
  }
};

contextBridge.exposeInMainWorld('Capacitor', {
  isDesktop: true,
  Plugins: { Filesystem: Filesystem }
});
