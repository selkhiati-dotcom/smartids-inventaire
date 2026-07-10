# CLAUDE.md — SmartIDS Inventaire (contexte pour Claude Code)

Application Android d'inventaire par scan de codes-barres, pour PDA et téléphone.
Groupe SYN / Stratson / Palmax (boatshop). Construite en **Capacitor** (WebView) pour réutiliser
un moteur JavaScript déjà éprouvé par des tests.

## Ce qu'il faut savoir avant de modifier

- **`www/inv_core.js` = le moteur pur, NE PAS CASSER.** Il est couvert par une suite de tests
  (parsing CSV/XLSX, normalisation code-barres dont notation scientifique Excel, comptage, undo,
  emplacements étagère/bac, exports Odoo). Toute modif doit préserver ces comportements.
  Ajouts v1.1 (non testés par la suite d'origine) : `buildGapRows`/`gapStats` (rapport d'écarts),
  colonne `theo` dans `detectColumns`.
- **Persistance = vrai fichier local**, jamais le cache navigateur — exigence forte (des données
  ont été perdues quand l'app était ouverte depuis un mail = cache éphémère). Depuis la v1.1,
  schéma multi-couches dans `www/app.js` :
  1. **journal append** `journal.jsonl` (Directory.Data) écrit à CHAQUE action (scan, +/-, undo,
     emplacement) — rejoué au boot pour les actions postérieures à la dernière sauvegarde ;
  2. état complet écrit **atomiquement** (debounce 350 ms) : `inventaire_new.json` → renommage
     `inventaire.json`, l'ancien devient `inventaire.bak.json` ;
  3. copie visible `Documents/SmartIDS/inventaire.json` + instantanés 10 min
     `Documents/SmartIDS/backups/` ;
  4. au boot, lecture en cascade : principal → new → bak → copie Documents, puis rejeu du journal.
  Ne JAMAIS affaiblir ce schéma (inventaires de plusieurs jours).
- **Réglages** persistés dans `settings.json` (Directory.Data) : emplacements on/off, ajout auto
  des codes inconnus (défaut ON), dernier opérateur. Un **opérateur** (responsable du comptage)
  est exigé au démarrage, journalisé, et tracé dans les exports (nom de fichier + colonne).
- **COMPAT VIEUX WEBVIEW (PDA) — règle absolue** : les PDA Honeywell/Zebra ont des WebView
  anciens jamais mis à jour. ES5 strict UNIQUEMENT, et bannir les API récentes :
  pas de `file.text()`/`arrayBuffer()` (→ `FileReader`), pas de `NodeList.forEach`
  (→ helper `each()`), pas de `Array.from`/`Set` en dédup, pas de `inset` CSS.
  Un `window.onerror` affiche toute erreur JS dans le bandeau `#err` — le garder.
- **Scan / clavier (v1.1.2)** : TROIS chemins de scan dans `www/app.js` — (1) `wedgeCapture`
  keydown global pour les lecteurs à vrais événements clavier ; (2) champ `#scan` focalisé
  (PAS readonly !) pour les lecteurs qui insèrent le texte façon IME : traité sur Entrée,
  `change`, ou 150 ms d'inactivité ; (3) bouton « ⌨ Saisie » manuel. Le clavier virtuel est
  masqué nativement (`@capacitor/keyboard`, hide() sur keyboardDidShow hors saisie manuelle).
  NE PAS réintroduire de boucle blur→refocus (avale les taps) ni de readonly (tue l'IME).
- **Versioning** : `APP_VERSION` dans `www/app.js` (affichée dans l'app) + `package.json` +
  entrée `CHANGELOG.md` à chaque évolution. Le versionCode Android est incrémenté par la CI.
- **Modèle emplacements** : 1 emplacement fixe par produit. On scanne une étiquette d'emplacement
  (code-barres préfixé `LOC-`, ex `LOC-A-03-B`) qui devient l'emplacement courant, puis les produits
  scannés s'y rattachent. Voir `parseLocationCode` / `setProductLocation` dans `inv_core.js`.
- **Scan** : PDA = lecteur laser en mode clavier (aucune config, frappes capturées globalement,
  voir point « Scan / clavier » ci-dessus). Téléphone = bouton Caméra (BarcodeDetector).

## Structure

| Fichier | Rôle |
|---|---|
| `www/inv_core.js` | moteur pur (testé) — logique d'inventaire |
| `www/app.js` | interface + persistance fichier (Capacitor Filesystem) + exports |
| `www/index.html`, `www/styles.css` | écran de l'app |
| `capacitor.config.json` | appId `ma.syn.smartids.inventaire`, webDir `www` |
| `CHANGELOG.md` | historique des versions (SemVer, tenu à jour à chaque évolution) |
| `resources/icon.png` | icône source 1024px (génère les icônes via `npx capacitor-assets generate`) |
| `.github/workflows/build-apk.yml` | build APK debug (test) |
| `.github/workflows/build-aab.yml` | build AAB signé pour Google Play Console |

Le dossier natif `android/` n'est **pas** versionné : il est généré à la volée par
`npx cap add android` (en local et en CI). Ne pas le committer.

## Commandes

```bash
npm install
npx cap add android          # génère android/
npx capacitor-assets generate --android   # icônes/splash depuis resources/
npx cap sync android         # copie www/ dans android/
cd android && ./gradlew assembleDebug     # APK debug
cd android && ./gradlew bundleRelease     # AAB release (signé, voir README)
```

## Feuille de route

- **V1** : inventaire + emplacements fixes + persistance fichier + exports Odoo (import
  ajustement de stock par code-barres). Testé.
- **V1.1 (actuelle)** : persistance journalisée « infaillible », rapport d'écarts (théorique vs
  compté), comptage libre sans fichier, ajout auto des codes inconnus (option), emplacements en
  option, clavier virtuel maîtrisé (`inputmode=none` + bouton saisie), sauvegarde cloud via la
  feuille de partage (Drive/mail, sans OAuth), affichage de version + CHANGELOG.
- **V2 (à faire)** : **création / gestion des emplacements directement dans l'app** (pas seulement
  affectation) : créer une arborescence Zone/Étagère/Bac, imprimer/générer les étiquettes, éditer.
- Idées : scan caméra natif ML Kit (fiabilité téléphone), synchro multi-postes optionnelle
  (un backend Node existe déjà côté projet VPS — meilleure voie pour une vraie synchro Drive/cloud
  automatique qu'une intégration OAuth Google dans l'app), photos produit.

## Conventions

- Vanilla JS (pas de framework), ES5-ish pour compat WebView. Pas de bundler.
- Plugins Capacitor appelés via `window.Capacitor.Plugins.*` (pas d'import ESM).
- Garder le code du moteur pur (`inv_core.js`) sans dépendance au DOM.
