# Changelog — SmartIDS Inventaire

Format : [SemVer](https://semver.org/lang/fr/). La version applicative est définie dans
`www/app.js` (`APP_VERSION`) et `package.json`, et affichée dans l'app (en-tête, écran
d'import, menu). Le `versionCode` Android est auto-incrémenté par la CI à chaque build AAB.

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
