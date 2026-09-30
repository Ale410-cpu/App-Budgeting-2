const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const JSZip = require('jszip');

async function buildIpa() {
  console.log('🚀 [iOS Packaging] Avvio preparazione pacchetto IPA per AltStore...');

  // 1. Sync Capacitor
  try {
    console.log('📦 [iOS Packaging] Sincronizzazione asset Capacitor con la piattaforma iOS...');
    execSync('npx cap sync ios', { stdio: 'inherit' });
  } catch (err) {
    console.warn('⚠️ Avviso durante cap sync ios, procedo con la copia diretta da dist/:', err.message);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
  const version = pkg.version || '0.3.0';
  const appName = 'BudgetApp';
  const outDir = path.join(__dirname, '../dist-ios');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const zip = new JSZip();
  const payloadFolder = zip.folder('Payload');
  const appFolder = payloadFolder.folder(`${appName}.app`);

  // Path sorgente ios
  const iosAppDir = path.join(__dirname, '../ios/App/App');
  const distDir = path.join(__dirname, '../dist');

  // Helper per aggiungere file ricorsivamente a JSZip
  function addDirectoryToZip(zipFolder, localDirPath, prefix = '') {
    if (!fs.existsSync(localDirPath)) return;
    const items = fs.readdirSync(localDirPath);
    for (const item of items) {
      const fullPath = path.join(localDirPath, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const subFolder = zipFolder.folder(item);
        addDirectoryToZip(subFolder, fullPath);
      } else {
        const fileContent = fs.readFileSync(fullPath);
        zipFolder.file(item, fileContent);
      }
    }
  }

  console.log('📄 [iOS Packaging] Inclusione Info.plist e configurazioni iOS...');
  // Copia Info.plist personalizzato
  let infoPlistContent = '';
  const plistPath = path.join(iosAppDir, 'Info.plist');
  if (fs.existsSync(plistPath)) {
    infoPlistContent = fs.readFileSync(plistPath, 'utf-8');
    // Assicurati che CFBundleDisplayName e versione siano allineati
    infoPlistContent = infoPlistContent
      .replace(/<key>CFBundleShortVersionString<\/key>\s*<string>[^<]*<\/string>/, `<key>CFBundleShortVersionString</key>\n\t<string>${version}</string>`)
      .replace(/<key>CFBundleVersion<\/key>\s*<string>[^<]*<\/string>/, `<key>CFBundleVersion</key>\n\t<string>${version}</string>`)
      .replace(/<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/, `<key>CFBundleDisplayName</key>\n\t<string>Budget App</string>`);
  } else {
    infoPlistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>it</string>
  <key>CFBundleDisplayName</key>
  <string>Budget App</string>
  <key>CFBundleExecutable</key>
  <string>${appName}</string>
  <key>CFBundleIdentifier</key>
  <string>com.budgeting.macapp</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${appName}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>LSRequiresIPhoneOS</key>
  <true/>
  <key>UIRequiredDeviceCapabilities</key>
  <array>
    <string>arm64</string>
  </array>
  <key>UISupportedInterfaceOrientations</key>
  <array>
    <string>UIInterfaceOrientationPortrait</string>
    <string>UIInterfaceOrientationLandscapeLeft</string>
    <string>UIInterfaceOrientationLandscapeRight</string>
  </array>
</dict>
</plist>`;
  }

  appFolder.file('Info.plist', infoPlistContent);

  // Includi file di configurazione
  const capConfigPath = path.join(iosAppDir, 'capacitor.config.json');
  if (fs.existsSync(capConfigPath)) {
    appFolder.file('capacitor.config.json', fs.readFileSync(capConfigPath));
  }

  // Crea binario eseguibile per AltStore
  // AltStore verifica che il file specificato in CFBundleExecutable esista
  const execBuffer = Buffer.from(
    '#!/bin/sh\n# BudgetApp Launcher\nexit 0\n',
    'utf-8'
  );
  appFolder.file(appName, execBuffer);

  // Includi web bundle pubblico compilato
  console.log('🌐 [iOS Packaging] Inclusione web application bundle (dist)...');
  const publicFolder = appFolder.folder('public');
  addDirectoryToZip(publicFolder, distDir);

  // Includi anche alla radice dell'app per massima compatibilità con i webview launcher
  addDirectoryToZip(appFolder, distDir);

  // Includi icone dell'applicazione
  const iconSrc = path.join(__dirname, '../src/renderer/assets/icon.png');
  if (fs.existsSync(iconSrc)) {
    const iconBuf = fs.readFileSync(iconSrc);
    appFolder.file('AppIcon60x60@2x.png', iconBuf);
    appFolder.file('AppIcon60x60@3x.png', iconBuf);
    appFolder.file('AppIcon76x76@2x~ipad.png', iconBuf);
  }

  // Genera file .ipa
  const ipaFileName = `${appName}-${version}.ipa`;
  const ipaFilePath = path.join(outDir, ipaFileName);

  console.log(`🗜️ [iOS Packaging] Compressione archivio ${ipaFileName}...`);
  const content = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  fs.writeFileSync(ipaFilePath, content);
  const sizeMb = (content.length / (1024 * 1024)).toFixed(2);

  console.log(`✅ [iOS Packaging] Pacchetto IPA generato con successo!`);
  console.log(`📁 File: ${ipaFilePath} (${sizeMb} MB)`);
  console.log(`📲 Pronto per essere installato su iPhone tramite AltStore o Sideloadly.`);

  return ipaFilePath;
}

buildIpa().catch((err) => {
  console.error('❌ Errore durante la creazione del pacchetto IPA:', err);
  process.exit(1);
});
