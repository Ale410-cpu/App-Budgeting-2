const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');

async function repackTarget(appPath) {
  const rootDir = path.resolve(__dirname, '..');
  const tempDir = path.join(rootDir, 'dist-electron', 'temp-repack-' + Math.random().toString(36).substring(2, 7));
  const asarTarget = path.join(appPath, 'Contents', 'Resources', 'app.asar');

  if (!fs.existsSync(path.dirname(asarTarget))) {
    console.log('Skipping non-existent app path:', appPath);
    return;
  }

  console.log('Packing app for:', appPath);
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  if (fs.existsSync(asarTarget)) {
    asar.extractAll(asarTarget, tempDir);
  }

  console.log('Copying fresh dist & electron directories...');
  fs.cpSync(path.join(rootDir, 'dist'), path.join(tempDir, 'dist'), { recursive: true });
  fs.cpSync(path.join(rootDir, 'electron'), path.join(tempDir, 'electron'), { recursive: true });
  fs.copyFileSync(path.join(rootDir, 'package.json'), path.join(tempDir, 'package.json'));

  console.log('Packing to asarTarget:', asarTarget);
  await asar.createPackageWithOptions(tempDir, asarTarget, {
    unpack: '**/@napi-rs/**',
  });

  // Also update Contents/Info.plist version to match package.json
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  const appInfoPlist = path.join(appPath, 'Contents', 'Info.plist');
  if (fs.existsSync(appInfoPlist) && pkg.version) {
    let plist = fs.readFileSync(appInfoPlist, 'utf-8');
    plist = plist
      .replace(/<key>CFBundleShortVersionString<\/key>\s*<string>[^<]*<\/string>/, `<key>CFBundleShortVersionString</key>\n\t<string>${pkg.version}</string>`)
      .replace(/<key>CFBundleVersion<\/key>\s*<string>[^<]*<\/string>/, `<key>CFBundleVersion</key>\n\t<string>${pkg.version}</string>`);
    fs.writeFileSync(appInfoPlist, plist, 'utf-8');
    console.log('Updated Contents/Info.plist to version', pkg.version);
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('Successfully repacked', asarTarget);
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const targets = [
    path.join(rootDir, 'dist-electron', 'mac', 'BudgetingMacApp.app'),
    path.join(rootDir, 'dist-electron', 'mac-arm64', 'BudgetingMacApp.app'),
  ];

  for (const t of targets) {
    if (fs.existsSync(t)) {
      await repackTarget(t);
    }
  }
}

main().catch((err) => {
  console.error('Repack failed:', err);
  process.exit(1);
});
