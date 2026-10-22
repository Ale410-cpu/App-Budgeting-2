#!/usr/bin/env node
/**
 * build-ipa.cjs
 * Pipeline di build per la versione iOS sideloadable (AltStore / Sideloadly).
 *
 * Passaggi:
 *   1. build del renderer React/Vite (cartella `dist/`)
 *   2. copia del bundle web dentro `ios/BudgetApp/Resources/web/`
 *   3. compilazione del progetto Xcode (`ios/BudgetApp.xcodeproj`)
 *   4. impacchettamento del `.app` in un `.ipa` (Payload/BudgetApp.app)
 *
 * Modalita':
 *   node scripts/build-ipa.cjs                -> IPA non firmato (per AltStore/Sideloadly)
 *   node scripts/build-ipa.cjs --team ABCDE   -> IPA firmato con il tuo ID Apple
 *   node scripts/build-ipa.cjs --source-only  -> solo il progetto Xcode (per chi firma in proprio)
 *   node scripts/build-ipa.cjs --sync-only    -> copia solo il bundle web (debug da Xcode)
 *
 * Il team id si puo' anche passare con la variabile d'ambiente `IOS_TEAM_ID`.
 */

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const IOS_DIR = path.join(ROOT, 'ios');
const PROJECT = path.join(IOS_DIR, 'BudgetApp.xcodeproj');
const WEB_DEST = path.join(IOS_DIR, 'BudgetApp', 'Resources', 'web');
const DIST_DIR = path.join(ROOT, 'dist');
const BUILD_DIR = path.join(ROOT, 'build');
const DERIVED_DIR = path.join(BUILD_DIR, 'ios-derived');
const ARCHIVE_DIR = path.join(BUILD_DIR, 'ios-archive');
const EXPORT_DIR = path.join(BUILD_DIR, 'ios-export');
const OUT_DIR = path.join(ROOT, 'dist-ios');

const args = process.argv.slice(2);
const SYNC_ONLY = args.includes('--sync-only');
const SOURCE_ONLY = args.includes('--source-only');
const TEAM_FLAG_INDEX = args.indexOf('--team');
const TEAM_ID =
  (TEAM_FLAG_INDEX >= 0 ? args[TEAM_FLAG_INDEX + 1] : process.env.IOS_TEAM_ID || '').trim();

const APP_NAME = 'BudgetApp';

function log(message) {
  console.log(message);
}

function fail(message, hint) {
  console.error(`\n❌ ${message}`);
  if (hint) {
    console.error(`\n${hint}\n`);
  }
  process.exit(1);
}

function run(command, options = {}) {
  execSync(command, { stdio: 'inherit', cwd: ROOT, ...options });
}

/** Verifica che Xcode (non solo le Command Line Tools) sia installato. */
function requireXcode() {
  let xcodeVersion = '';
  try {
    xcodeVersion = execFileSync('xcodebuild', ['-version'], { encoding: 'utf-8' }).trim();
  } catch {
    fail(
      'Xcode non e\' installato (o non selezionato).',
      [
        'Per compilare la versione iOS serve Xcode completo:',
        '  1. Scaricalo dall\'App Store (https://developer.apple.com/xcode/) oppure',
        '     da https://developer.apple.com/download/ (sono ~15 GB);',
        '  2. Apri Xcode una volta e accetta la licenza;',
        '  3. Attiva il percorso con:  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
        '  4. Rilancia:  npm run package:ios',
      ].join('\n')
    );
  }

  if (!/Xcode/.test(xcodeVersion)) {
    fail(
      'Sono installate solo le Command Line Tools, non Xcode.',
      [
        'Le Command Line Tools non contengono l\'iOS SDK, quindi non possono',
        'compilare un\'app per iPhone.',
        'Installa Xcode dall\'App Store e poi:',
        '  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer',
      ].join('\n')
    );
  }

  log(`\n▸ ${xcodeVersion.split('\n').join(' | ')}`);

  // L'iOS SDK deve essere presente.
  let sdks = '';
  try {
    sdks = execFileSync('xcodebuild', ['-showsdks'], { encoding: 'utf-8' });
  } catch {
    sdks = '';
  }
  if (!/iphoneos/i.test(sdks)) {
    fail(
      'Xcode non espone alcun iOS SDK.',
      'Apri Xcode una volta, lascia che finisca l\'installazione degli SDK (menu Xcode > Settings > Components).'
    );
  }
}

/**
 * Il CSP del bundle web va adattato alla versione iOS.
 *
 * La WebView serve l'app da uno schema custom (`budgetapp://localhost`): per
 * WebKit quell'origine non e' sempre considerata "same-origin", quindi la
 * direttiva `'self'` non basta e i moduli ES (che sono sempre caricati in
 * modalita' CORS) verrebbero bloccati, lasciando la schermata bianca.
 *
 * Aggiungendo lo schema come source esplicito in ogni direttiva i
 * collegamenti diventano consentiti.
 */
const IOS_CSP = [
  "default-src 'self' budgetapp: data: blob: file:;",
  "script-src 'self' budgetapp: 'unsafe-inline' 'unsafe-eval' blob:;",
  "worker-src 'self' budgetapp: blob: file:;",
  "style-src 'self' budgetapp: 'unsafe-inline' https://fonts.googleapis.com;",
  "font-src 'self' budgetapp: data: file:;",
  "img-src 'self' budgetapp: data: blob: file: https:;",
  "connect-src 'self' budgetapp: https://query1.finance.yahoo.com https://api.github.com https://github.com https://objects.githubusercontent.com ws: wss: http://localhost:* http://127.0.0.1:*;",
].join(' ');

/**
 * Costruisce il bundle web per iOS e lo rende **autosufficiente**.
 *
 * Il bundle viene compilato come IIFE (un solo script classico) e poi
 * script e CSS vengono inlineati nell'HTML.
 *
 * Perche' inlinearli: su iOS 26+ WebKit termina il processo WebContent
 * quando una pagina servita da uno schema URL custom contiene un elemento
 * `<script src=...>` (bugs.webkit.org/show_bug.cgi?id=296698) e la WebView
 * resta bianca. Con lo script inline non viene richiesta alcuna subrisorsa
 * dal parser HTML e il problema sparisce.
 */
function buildIosWebBundle() {
  log('\n▸ Build del renderer per iOS (single-file)…');
  run('npx vite build --config vite.config.ios.ts');

  const srcDir = path.join(ROOT, 'dist-ios-web');
  const indexPath = path.join(srcDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    fail('Build iOS non riuscita: index.html non trovato.');
  }

  const jsPath = path.join(srcDir, 'app.js');
  const cssPath = path.join(srcDir, 'app.css');

  let html = fs.readFileSync(indexPath, 'utf-8');

  // --- CSS inline ---
  // NB: si usa una funzione di sostituzione: con una stringa, `replace`
  // interpreterebbe `$&`, `$'` e `` $` `` come placeholder e corromperebbe
  // il contenuto del bundle.
  if (fs.existsSync(cssPath)) {
    const css = fs.readFileSync(cssPath, 'utf-8');
    html = html.replace(
      /<link rel="stylesheet" crossorigin href="\.\/app\.css">/,
      () => `<style>\n${css}\n</style>`
    );
  }

  // --- script inline (con protezione da "</script>") ---
  //
  // Lo script va in fondo al <body>: inline non puo' essere "defer", quindi
  // se resta nell'<head>' viene eseguito prima che esista il div #root
  // (React error #299: "Target container is not a DOM element").
  if (fs.existsSync(jsPath)) {
    const js = fs.readFileSync(jsPath, 'utf-8').replace(/<\/script>/gi, '<\\/script>');
    html = html.replace(
      /<script type="module" crossorigin src="\.\/app\.js"><\/script>\s*/,
      ''
    );
    html = html.replace(
      /<\/body>/i,
      () => `<script>\n${js}\n</script>\n</body>`
    );
  }

  // --- CSP adattato allo schema custom ---
  // NB: con una funzione di sostituzione i gruppi di cattura vanno usati
  // esplicitamente: `$1`/`$3` verrebbero inseriti letteralmente.
  html = html.replace(
    /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/i,
    (_match, before, _old, after) => `${before}${IOS_CSP}${after}`
  );

  // --- copia nel progetto Xcode ---
  fs.rmSync(WEB_DEST, { recursive: true, force: true });
  fs.mkdirSync(WEB_DEST, { recursive: true });
  fs.writeFileSync(path.join(WEB_DEST, 'index.html'), html, 'utf-8');

  let size = html.length;
  for (const item of fs.readdirSync(srcDir)) {
    if (item === 'index.html' || item === 'app.js' || item === 'app.css') continue;
    const source = path.join(srcDir, item);
    fs.cpSync(source, path.join(WEB_DEST, item), { recursive: true });
    size += directorySize(path.join(WEB_DEST, item));
  }

  log(`  ✓ ${WEB_DEST.replace(`${ROOT}/`, '')} (${(size / 1024 / 1024).toFixed(2)} MB, HTML single-file)`);
}

/** Copia il bundle web (build Vite) dentro la cartella Resources del progetto Xcode. */
function syncWebBundle() {
  if (!fs.existsSync(DIST_DIR)) {
    fail('La cartella `dist/` non esiste: esegui prima la build web.');
  }

  // Il server Express (generato da `npm run build`) non serve su iOS.
  const EXCLUDED = new Set(['server.cjs', 'server.cjs.map']);

  log('\n▸ Sincronizzazione del bundle web dentro il progetto iOS…');
  fs.rmSync(WEB_DEST, { recursive: true, force: true });
  fs.mkdirSync(WEB_DEST, { recursive: true });

  let size = 0;
  for (const item of fs.readdirSync(DIST_DIR)) {
    if (EXCLUDED.has(item)) continue;
    const source = path.join(DIST_DIR, item);
    fs.cpSync(source, path.join(WEB_DEST, item), { recursive: true });
    size += directorySize(path.join(WEB_DEST, item));
  }

  log(`  ✓ ${WEB_DEST.replace(`${ROOT}/`, '')} (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

/** Dimensione totale ricorsiva di un file o di una cartella. */
function directorySize(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs
    .readdirSync(target)
    .reduce((total, entry) => total + directorySize(path.join(target, entry)), 0);
}

/** Crea l'archivio .ipa (Payload/<App>.app) a partire dalla cartella .app. */
function packageIpa(appBundlePath, ipaPath) {
  const zip = require('jszip');

  const zipInstance = new zip();
  const payload = zipInstance.folder('Payload');
  const appFolder = payload.folder(`${APP_NAME}.app`);

  const walk = (dir, target) => {
    for (const item of fs.readdirSync(dir)) {
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full, target.folder(item));
      } else {
        target.file(item, fs.readFileSync(full));
      }
    }
  };

  walk(appBundlePath, appFolder);

  return zipInstance
    .generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    })
    .then((buffer) => {
      fs.mkdirSync(path.dirname(ipaPath), { recursive: true });
      fs.writeFileSync(ipaPath, buffer);
      return buffer.length;
    });
}

/** Compila il progetto Xcode senza firma (l'IPA sara' firmato da AltStore/Sideloadly). */
function buildUnsigned(version) {
  log('\n▸ Compilazione del progetto Xcode (Release, senza firma)…');
  run(
    [
      'xcodebuild',
      '-project',
      `"${PROJECT}"`,
      '-scheme',
      APP_NAME,
      '-configuration',
      'Release',
      '-sdk',
      'iphoneos',
      '-derivedDataPath',
      `"${DERIVED_DIR}"`,
      `MARKETING_VERSION=${version}`,
      `CURRENT_PROJECT_VERSION=${version}`,
      'CODE_SIGNING_ALLOWED=NO',
      'CODE_SIGNING_REQUIRED=NO',
      'CODE_SIGN_IDENTITY=',
      'build',
    ].join(' ')
  );

  const appBundle = path.join(DERIVED_DIR, 'Build', 'Products', 'Release-iphoneos', `${APP_NAME}.app`);
  if (!fs.existsSync(appBundle)) {
    fail('La compilazione non ha prodotto il bundle .app atteso.');
  }
  return appBundle;
}

/** Compila, archivia ed esporta l'IPA gia' firmato con il tuo ID Apple. */
function buildSigned(version, teamId) {
  log(`\n▸ Compilazione e firma con il team ${teamId}…`);

  fs.rmSync(ARCHIVE_DIR, { recursive: true, force: true });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  run(
    [
      'xcodebuild',
      '-project',
      `"${PROJECT}"`,
      '-scheme',
      APP_NAME,
      '-configuration',
      'Release',
      '-sdk',
      'iphoneos',
      '-archivePath',
      `"${path.join(ARCHIVE_DIR, `${APP_NAME}.xcarchive`)}"`,
      `-allowProvisioningUpdates`,
      `DEVELOPMENT_TEAM=${teamId}`,
      'CODE_SIGN_STYLE=Automatic',
      `MARKETING_VERSION=${version}`,
      `CURRENT_PROJECT_VERSION=${version}`,
      'archive',
    ].join(' ')
  );

  const exportOptions = path.join(BUILD_DIR, 'ExportOptions.plist');
  fs.writeFileSync(
    exportOptions,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key>
	<string>development</string>
	<key>teamID</key>
	<string>${teamId}</string>
	<key>signingStyle</key>
	<string>automatic</string>
	<key>destination</key>
	<string>export</string>
	<key>stripSwiftSymbols</key>
	<true/>
</dict>
</plist>
`
  );

  fs.rmSync(EXPORT_DIR, { recursive: true, force: true });
  run(
    [
      'xcodebuild',
      '-exportArchive',
      `"${path.join(ARCHIVE_DIR, `${APP_NAME}.xcarchive`)}"`,
      '-exportOptionsPlist',
      `"${exportOptions}"`,
      '-exportPath',
      `"${EXPORT_DIR}"`,
    ].join(' ')
  );

  const exported = fs
    .readdirSync(EXPORT_DIR)
    .find((file) => file.toLowerCase().endsWith('.ipa'));
  if (!exported) {
    fail('L\'export non ha prodotto alcun file .ipa.');
  }
  return path.join(EXPORT_DIR, exported);
}

/**
 * Crea il pacchetto con il progetto Xcode pronto per essere firmato
 * dall'utente finale (il modello "ogni utente firma con il proprio ID Apple").
 *
 * Contiene il progetto Xcode con il bundle web gia' sincronizzato: l'utente
 * non ha bisogno di Node.js ne' di eseguire la build del renderer.
 */
async function packageSourceZip(version) {
  const zip = require('jszip');

  const zipInstance = new zip();
  const root = zipInstance.folder(`BudgetApp-iOS-${version}`);

  const walk = (dir, target) => {
    for (const item of fs.readdirSync(dir)) {
      if (item === '.DS_Store') continue;
      const full = path.join(dir, item);
      if (fs.statSync(full).isDirectory()) {
        walk(full, target.folder(item));
      } else {
        target.file(item, fs.readFileSync(full));
      }
    }
  };

  walk(IOS_DIR, root.folder('ios'));

  root.file(
    'LEGGIMI.txt',
    `Budget App — progetto Xcode pronto per la firma personale
=========================================================

Contenuto
---------
  ios/                    progetto Xcode (Swift, nessuna dipendenza esterna)
  ios/BudgetApp/Resources/web/
                           bundle web gia' compilato: non serve Node.js

Come firmare l'app con il tuo ID Apple (gratuito)
-------------------------------------------------
1. Apri  ios/BudgetApp.xcodeproj  con Xcode 15 o superiore.
2. Seleziona il target "BudgetApp" > scheda "Signing & Capabilities".
3. Spunta "Automatically manage signing" e scegli il tuo Team
   (un "Personal Team" gratuito va benissimo).
4. Se Xcode lo segnala, cambia il Bundle Identifier in qualcosa di unico,
   per esempio:  com.<tuouso>.budgetapp
5. Collega l'iPhone al Mac, selezionalo come destinazione e premi Run.
6. Sul telefono: Impostazioni > Generali > VPN e gestione dispositivo >
   autorizza il tuo certificato; poi attiva la Modalita' sviluppatore.

Validita'
---------
La firma gratuita dura 7 giorni. Quando l'app smette di avviarsi,
ricalcollega (o usa il debug wireless) e premi di nuovo Run in Xcode:
i dati dell'app vengono conservati.

Nota sui dati
-------------
Se cambi il Bundle Identifier o cancelli l'app dalla Home, i dati vengono
persi: prima esporta un backup con "Esporta copia user-data.json"
(Impostazioni > Archiviazione) e salvalo su iCloud Drive.
`
  );

  const buffer = await zipInstance.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const zipPath = path.join(OUT_DIR, `BudgetApp-${version}-xcode.zip`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(zipPath, buffer);
  return { zipPath, size: buffer.length };
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  const version = pkg.version || '0.0.0';

  log('🚀 [iOS Packaging] Build della versione sideloadable');

  if (SYNC_ONLY) {
    buildIosWebBundle();
    log('\n✅ Bundle web iOS sincronizzato. Ora puoi aprire ios/BudgetApp.xcodeproj in Xcode.\n');
    return;
  }

  // Solo il pacchetto con il progetto Xcode: non serve Xcode sul computer
  // che lo distribuisce (serve a chi dovrà firmare l'app).
  if (SOURCE_ONLY) {
    buildIosWebBundle();

    log('\n▸ Preparazione del pacchetto con il progetto Xcode…');
    const source = await packageSourceZip(version);
    log(`\n✅ Pacchetto pronto: ${source.zipPath.replace(`${ROOT}/`, '')} (${(source.size / 1024 / 1024).toFixed(2)} MB)`);
    log('   Ogni utente puo\' firmare l\'app con il proprio ID Apple aprendolo in Xcode.\n');
    return;
  }

  requireXcode();

  buildIosWebBundle();

  // Pacchetto con il progetto Xcode: serve a chi vuole firmare l'app in
  // proprio con il proprio ID Apple (non richiede Xcode sul computer di chi
  // riceve il pacchetto, ma richiede Xcode al momento della firma).
  log('\n▸ Preparazione del pacchetto con il progetto Xcode…');
  const source = await packageSourceZip(version);
  log(`  ✓ ${source.zipPath.replace(`${ROOT}/`, '')} (${(source.size / 1024 / 1024).toFixed(2)} MB)`);

  let ipaSource;
  if (TEAM_ID) {
    ipaSource = buildSigned(version, TEAM_ID);
  } else {
    ipaSource = buildUnsigned(version);
  }

  const ipaPath = path.join(OUT_DIR, `${APP_NAME}-${version}.ipa`);
  log('\n▸ Impacchettamento del file .ipa…');
  const size = await packageIpa(ipaSource, ipaPath);

  log(`\n✅ Pacchetto IPA generato: ${ipaPath.replace(`${ROOT}/`, '')} (${(size / 1024 / 1024).toFixed(2)} MB)`);

  if (TEAM_ID) {
    log('   Il pacchetto e\' firmato: si puo\' installare direttamente sul telefono.');
  } else {
    log('   Il pacchetto NON e\' firmato: installalo con AltStore o Sideloadly');
    log('   (vedi GUIDA_INSTALLAZIONE_ALTSTORE_IOS.md).');
  }
  log('');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('\n❌ Errore durante la build iOS:', error?.message || error);
    process.exit(1);
  });
}

module.exports = { packageIpa, packageSourceZip, syncWebBundle, buildUnsigned, buildSigned, APP_NAME };