const fs = require('fs');
const path = require('path');
const https = require('https');

// Carica variabili d'ambiente da .env se presente
try {
  const envPath = path.join(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envLines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of envLines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, ...v] = trimmed.split('=');
        if (!process.env[k.trim()]) {
          process.env[k.trim()] = v.join('=').trim();
        }
      }
    }
  }
} catch (e) {}

async function createGitHubRelease() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf-8'));
  const version = pkg.version || '0.3.0';
  const tag = `v${version}`;

  // Recupera repository configurato
  let repo = 'Ale410-cpu/App-Budgeting-2';
  if (pkg.repository && pkg.repository.url) {
    repo = pkg.repository.url.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').trim();
  }

  // Token GitHub
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('❌ Errore: Variabile d\'ambiente GITHUB_TOKEN non trovata.');
    console.error('   Per pubblicare automaticamente una release su GitHub, è necessario un Personal Access Token (PAT) con permessi "repo".');
    console.error('   Esempio di utilizzo:');
    console.error('   GITHUB_TOKEN=ghp_tuoToken npm run release:github');
    process.exit(1);
  }

  console.log(`🚀 [GitHub Release] Gestione release ${tag} per ${repo}...`);

  const releaseData = {
    tag_name: tag,
    target_commitish: 'main',
    name: `Budget Ledger ${tag}`,
    body: `## Novità e Aggiornamenti ${tag}\n\n` +
      `- 📱 **Supporto iOS e AltStore**: pacchetto \`BudgetApp-${version}.ipa\` per installazione nativa tramite AltStore e Sideloadly.\n` +
      `- 📥 **Importazione Universale Flessibile**: supporto completo per Apple Numbers (\`.numbers\`), PDF bancari (\`.pdf\`), Excel e CSV.\n` +
      `- 🛡️ **Persistenza e Sicurezza Dati**: archiviazione protetta nella cartella utente di sistema e compatibilità cloud.\n\n` +
      `### Asset disponibili per il download:\n` +
      `- \`BudgetingMacApp-${version}-mac.zip\` (Applicazione per macOS)\n` +
      `- \`BudgetApp-${version}.ipa\` (Pacchetto per iPhone / iOS)`,
    draft: false,
    prerelease: false,
  };

  let release = null;
  try {
    release = await postJson(`https://api.github.com/repos/${repo}/releases`, releaseData, token);
    console.log(`✅ [GitHub Release] Release creata con successo! ID: ${release.id}`);
  } catch (err) {
    console.log(`ℹ️ [GitHub Release] La release ${tag} esiste già o è in fase di aggiornamento. Recupero release esistente...`);
    release = await getJson(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, token);
    console.log(`✅ [GitHub Release] Release esistente recuperata! ID: ${release.id}`);
  }

  console.log(`🔗 URL: ${release.html_url}`);

  const uploadUrlTemplate = release.upload_url;
  const baseUploadUrl = uploadUrlTemplate.replace(/\{\?name,label\}$/, '');

  // Recupera asset già caricati per evitare duplicati
  const existingAssets = Array.isArray(release.assets) ? release.assets.map((a) => a.name) : [];

  // Lista degli asset da caricare
  const assetsToUpload = [
    {
      filePath: path.join(__dirname, `../dist-ios/BudgetApp-${version}.ipa`),
      fileName: `BudgetApp-${version}.ipa`,
      contentType: 'application/octet-stream',
    },
    {
      filePath: path.join(__dirname, `../dist-electron/BudgetingMacApp-${version}-mac.zip`),
      fileName: `BudgetingMacApp-${version}-mac.zip`,
      contentType: 'application/zip',
    },
    {
      filePath: path.join(__dirname, `../dist-electron/BudgetingMacApp-${version}.dmg`),
      fileName: `BudgetingMacApp-${version}.dmg`,
      contentType: 'application/x-apple-diskimage',
    },
  ];

  for (const item of assetsToUpload) {
    if (existingAssets.includes(item.fileName)) {
      console.log(`ℹ️ [GitHub Release] Asset ${item.fileName} già presente nella release.`);
      continue;
    }

    if (fs.existsSync(item.filePath)) {
      console.log(`⬆️ [GitHub Release] Caricamento asset: ${item.fileName}...`);
      await uploadAsset(baseUploadUrl, item.filePath, item.fileName, item.contentType, token);
      console.log(`✅ [GitHub Release] ${item.fileName} caricato con successo!`);
    } else {
      console.log(`ℹ️ [GitHub Release] File ${item.fileName} non trovato in locale.`);
    }
  }

  console.log(`🎉 [GitHub Release] Operazione completata! Release ${tag} online su GitHub.`);
}

function getJson(urlStr, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'BudgetApp-ReleaseBot/1.0',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      },
      (res) => {
        let respBody = '';
        res.on('data', (chunk) => (respBody += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(respBody));
            } catch (e) {
              resolve(respBody);
            }
          } else {
            reject(new Error(`GitHub API error (${res.statusCode}): ${respBody}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function postJson(urlStr, data, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyStr = JSON.stringify(data);
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'User-Agent': 'BudgetApp-ReleaseBot/1.0',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      },
      (res) => {
        let respBody = '';
        res.on('data', (chunk) => (respBody += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(respBody));
            } catch (e) {
              resolve(respBody);
            }
          } else {
            reject(new Error(`GitHub API error (${res.statusCode}): ${respBody}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function uploadAsset(baseUploadUrl, filePath, fileName, contentType, token) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(filePath);
    const url = new URL(`${baseUploadUrl}?name=${encodeURIComponent(fileName)}`);

    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'User-Agent': 'BudgetApp-ReleaseBot/1.0',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': contentType,
          'Content-Length': stat.size,
        },
      },
      (res) => {
        let respBody = '';
        res.on('data', (chunk) => (respBody += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Asset upload error (${res.statusCode}): ${respBody}`));
          }
        });
      }
    );

    req.on('error', reject);
    const stream = fs.createReadStream(filePath);
    stream.pipe(req);
  });
}

createGitHubRelease().catch((err) => {
  console.error('❌ Errore durante la creazione della release:', err.message);
  process.exit(1);
});
