# SmartIDS Inventaire — Application Android

Inventaire par scan (PDA + telephone). Moteur JS eprouve enveloppe en **Capacitor**.
Persistance dans un **vrai fichier local** (jamais le cache navigateur) avec reprise automatique.

- **Package (applicationId)** : `ma.syn.smartids.inventaire`  (non modifiable apres publication Play).
- **Version** : 1.1.0 — definie dans `www/app.js` (`APP_VERSION`) + `package.json`, affichee dans
  l'app ; historique dans `CHANGELOG.md`. Le versionCode Android est auto-incremente a chaque
  build AAB en CI.

## 1. Continuer le projet dans Claude Code
Ouvre le dossier dans Claude Code : le fichier `CLAUDE.md` donne tout le contexte (structure, moteur
teste a ne pas casser, persistance fichier, feuille de route V2 = creation d'emplacements).
```bash
npm install
npx cap add android
npx cap sync android
```

## 2. APK debug (pour tester sur tes appareils)
Pousse le projet sur GitHub -> onglet **Actions** -> workflow **"APK debug"** -> telecharge
l'artefact `SmartIDS-APK-debug`. Installe l'APK a la main (autoriser les sources inconnues).
En local : `npm install && npx cap add android && cd android && ./gradlew assembleDebug`.

## 3. AAB signe pour Google Play Console
Le Play Console exige un **Android App Bundle (.aab) signe**.

### a) Generer ta cle de signature (une seule fois)
```bash
keytool -genkey -v -keystore upload.keystore -alias upload -keyalg RSA -keysize 2048 -validity 9125
```
Garde `upload.keystore` et les mots de passe EN LIEU SUR (ils servent a chaque mise a jour).

### b) Ajouter 4 secrets dans GitHub
Repo -> Settings -> Secrets and variables -> Actions -> New repository secret :
- `KEYSTORE_BASE64` = resultat de `base64 -w0 upload.keystore`
- `KEYSTORE_PASSWORD` = mot de passe du keystore
- `KEY_ALIAS` = `upload`
- `KEY_PASSWORD` = mot de passe de la cle

### c) Lancer le build
Onglet **Actions** -> workflow **"AAB release (Play Console)"** -> **Run workflow**
(ou pousse un tag `v1.0.0`). Telecharge l'artefact `SmartIDS-AAB-release` -> `app-release.aab`.

### d) Televerser sur Play Console
Play Console -> ton app -> Test interne ou Production -> Creer une release -> deposer le `.aab`.
Active **Play App Signing** (recommande) : Google gere la cle finale, ta cle ci-dessus est la cle d'upload.
Chaque release doit avoir un versionCode superieur : le workflow l'incremente automatiquement,
donc il suffit de relancer le workflow pour publier une mise a jour.

## 4. A preparer cote Play Console (fiche du store)
- Icone (generee depuis `resources/icon.png`), captures d'ecran, description.
- **Politique de confidentialite (URL obligatoire)** : modele fourni dans `privacy.html`
  (heberge-le et mets l'URL dans le Play Console). L'app stocke tout en local, aucun envoi serveur.
- Questionnaire "Securite des donnees" : declarer "aucune donnee collectee / partagee".

## Structure
Voir `CLAUDE.md`. Le dossier `android/` est genere (non versionne).
