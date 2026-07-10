# Changelog — SmartIDS Inventaire

Format : [SemVer](https://semver.org/lang/fr/). La version applicative est définie dans
`www/app.js` (`APP_VERSION`) et `package.json`, et affichée dans l'app (en-tête, écran
d'import, menu). Le `versionCode` Android est auto-incrémenté par la CI à chaque build AAB.

## [1.2.0] — 2026-07-10

Refonte performance de l'écran de scan (suggestion utilisateur) : sur PDA, l'app devenait
inutilisable après quelques scans — la liste complète (1400 lignes) était redessinée à
chaque scan et saturait le WebView.

### Modifié
- **Plus de liste complète à l'écran de scan** : seuls les **5 derniers scans** s'affichent
  (avec +/- pour corriger). La recherche n'affiche des résultats (20 max) que si on tape
  au moins 2 caractères. Rendu quasi instantané, même avec des milliers de références.
- **Choix « Scanner aussi les emplacements » déplacé sur la page de démarrage** (case à
  cocher à côté du nom de l'opérateur) — plus visible que dans les Réglages (où il reste
  modifiable en cours de session).
- **Copie Documents throttlée** (1 fois / 30 s max, forcée au passage en arrière-plan) :
  moins d'I/O par scan sur les vieux appareils. Le journal d'actions et le fichier
  principal continuent de protéger chaque scan individuellement.

## [1.1.4] — 2026-07-10

Tactile figé sur l'écran de scan (PDA Honeywell) — cause identifiée : tempête
show→hide→show entre le clavier natif et le `Keyboard.hide()`, qui saturait le thread.

### Corrigé
- **Anti-tempête clavier** : une seule fermeture du clavier ; s'il revient dans les 2,5 s,
  on le laisse visible plutôt que de geler l'écran. Re-focus du champ limité (throttle 800 ms).

### Ajouté
- **Réglage « Mode lecteur »** : *Champ focalisé* (défaut — lecteur qui insère le texte) ou
  *Touches clavier* (recommandé : mode « Wedge as keys » des PDA Honeywell / DataWedge Zebra —
  aucun champ focalisé, aucun clavier, capture globale). Procédure indiquée dans Réglages.
- **🔧 Diagnostic scan** (Réglages) : journal en direct des événements du lecteur (touches,
  insertions, focus, clavier natif) pour diagnostiquer n'importe quel PDA sur le terrain.

## [1.1.3] — 2026-07-10

### Corrigé
- **Clavier fermé instantanément sur le champ « Opérateur »** (écran d'accueil) : le
  masquage natif du clavier ne s'applique plus que sur l'écran de scan quand le focus
  est sur le champ scan (ou aucun champ). Tous les autres champs — opérateur, recherche,
  réglages, emplacement Odoo — gardent un clavier normal.

## [1.1.2] — 2026-07-10

Compatibilité **vieux WebView de PDA** (app morte sur Honeywell ancien avec la 1.1.1).

### Corrigé
- **Import de fichier** : `FileReader` remplace `file.text()`/`arrayBuffer()` (Chrome 76+
  seulement — l'import plantait sur tout WebView antérieur à 2019).
- **ES5 strict** : suppression de `Array.from(new Set(...))` (moteur) et de
  `NodeList.forEach` (Chrome 45/51+) ; `inset` CSS remplacé par top/left/right/bottom.
- **Scanner** : le champ n'est plus en lecture seule (ça bloquait les lecteurs qui
  insèrent le texte comme un IME, sans événements de touche — cas des vieux Honeywell).
  Trois chemins de scan cohabitent : capture clavier globale (WebView récents), champ
  focalisé avec traitement sur Entrée/`change`/150 ms d'inactivité (insertion IME),
  saisie manuelle.
- **Clavier virtuel masqué nativement** (plugin `@capacitor/keyboard`, `hide()` dès
  qu'il apparaît hors saisie manuelle) — fiable même quand `inputmode=none` est ignoré.
- Re-focus **doux** du champ scan (tap sur zone non interactive uniquement) — plus
  jamais de boucle blur→focus qui avalait les taps sur les boutons.

### Ajouté
- **Bandeau d'erreur visible à l'écran** (`window.onerror`) : sur PDA, une erreur JS
  n'est plus silencieuse — elle s'affiche avec fichier et ligne, pour diagnostiquer.

## [1.1.1] — 2026-07-10

Correctifs suite au premier test sur PDA Honeywell (v1.1.0).

### Corrigé
- **Clavier virtuel qui remontait sur PDA** : le champ scan est désormais en **lecture seule**
  (le clavier ne peut plus jamais s'ouvrir seul, même sur les WebView/Gboard qui ignorent
  `inputmode=none`). Les frappes du lecteur laser sont capturées **au niveau du document** :
  aucun champ n'a besoin d'être focalisé.
- **Boutons (⋯, Saisie, Caméra…) qui ne répondaient pas** : suppression du re-focus automatique
  du champ scan qui avalait les taps sur certains WebView.

### Ajouté
- **Opérateur (responsable du comptage)** : demandé au démarrage de l'inventaire, affiché à
  l'écran de scan, modifiable dans Réglages (changement journalisé), mémorisé pour la session
  suivante, inscrit dans le **nom des fichiers exportés** et en **colonne « Opérateur »** dans
  les rapports (écarts, emplacements, complet — l'export Odoo reste au format d'import pur).
- Tap sur le champ scan = ouvre la saisie manuelle (équivalent du bouton ⌨ Saisie).

### Modifié
- **Ajout automatique des codes absents du fichier : activé par défaut** — un code inconnu est
  enregistré avec sa quantité et la désignation « INCONNU (scanné) », facile à filtrer dans
  Excel pour recherche ultérieure.

## [1.1.0] — 2026-07-10

### Ajouté
- **Rapport d'écarts** : nouvelle colonne « quantité théorique / stock » au mapping d'import ;
  export CSV `Rapport_ecarts_*.csv` (Produit, Code-barres, Désignation, Qté théorique,
  Qté comptée, Écart, Emplacement) listant les lignes en écart.
- **Comptage libre** : démarrer un inventaire sans fichier de référence (chaque code scanné
  est ajouté et compté).
- **Réglages** (persistés dans `settings.json`) :
  - gestion des emplacements **activable/désactivable** (interface masquée si désactivée) ;
  - **ajout automatique** des codes absents du fichier (sinon confirmation, comme avant).
- **Menu** (⋯) : sauvegarde vers le cloud via la feuille de partage Android (Google Drive,
  mail, WhatsApp…) — optionnel, aucune liaison de compte requise, jamais bloquant.
- **Affichage de version** dans l'en-tête, l'écran d'import et le menu ; ce CHANGELOG.

### Fiabilité (sessions d'inventaire de plusieurs jours)
- **Journal d'actions** (`journal.jsonl`, append immédiat à chaque scan/ajustement) :
  aucune fenêtre de perte, même si l'app est tuée entre deux sauvegardes.
- **Écriture atomique** de l'état : `inventaire_new.json` → renommages, plus de risque de
  fichier tronqué ; conservation d'un `inventaire.bak.json`.
- **Instantanés horodatés** toutes les 10 min dans `Documents/SmartIDS/backups/`.
- **Récupération en cascade au démarrage** : principal → écriture interrompue → .bak →
  copie Documents, puis **rejeu du journal** (actions postérieures à la dernière sauvegarde).

### Modifié
- **Écran de scan épuré** : pendant le comptage, seuls restent l'emplacement courant, le champ
  de scan, Annuler/Saisie/Caméra, une ligne de compteurs discrète et la liste. Les exports et
  leurs options sont regroupés dans le menu ⋯ (section « Exports »).
- **Clavier virtuel** : le champ scan passe en `inputmode="none"` — le scanner physique
  (Honeywell, Zebra… en mode clavier) continue de fonctionner, mais le clavier ne remonte
  plus en permanence sur téléphone. Nouveau bouton « ⌨ Saisie » pour taper un code à la main.
- Le menu ⋯ (ancien `prompt()` texte) devient un vrai menu tactile.

## [1.0.0]

- Version initiale : import CSV/XLSX, scan PDA (mode clavier) + caméra, comptage, undo,
  emplacements fixes (étiquettes `LOC-`), persistance fichier avec reprise automatique,
  exports Odoo / emplacements / complet.
