const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

async function zipMacApp() {
  const zip = new JSZip();
  const appDir = path.join(__dirname, '../dist-electron/mac/BudgetingMacApp.app');
  const outZip = path.join(__dirname, '../dist-electron/BudgetingMacApp-0.3.13-mac.zip');

  function addDirToZip(dir, zipFolder) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const subFolder = zipFolder.folder(file);
        addDirToZip(fullPath, subFolder);
      } else {
        const content = fs.readFileSync(fullPath);
        zipFolder.file(file, content);
      }
    }
  }

  console.log('Zipping BudgetingMacApp.app...');
  const appFolder = zip.folder('BudgetingMacApp.app');
  addDirToZip(appDir, appFolder);

  const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outZip, content);
  console.log('Zip created at:', outZip);
}

zipMacApp().catch(console.error);
