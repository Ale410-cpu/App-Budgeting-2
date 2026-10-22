const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const child_process = require('child_process');
const { app, BrowserWindow, ipcMain, nativeImage, shell, session, dialog, screen, Notification } = require('electron');
const {
  showNativeNotification,
  probeNativeNotification,
  APP_BUNDLE_ID,
  APP_DISPLAY_NAME,
} = require('./notifications.cjs');

// Enable GPU hardware acceleration and smooth compositing for macOS Metal & 60/120Hz displays
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// Ensure consistent application name and AppUserModelId for notifications across sessions
app.setName('BudgetingMacApp');
if (process.platform === 'win32' || process.platform === 'darwin') {
  app.setAppUserModelId(APP_BUNDLE_ID);
}

const devServerUrl = 'http://127.0.0.1:3000';
const TICKER_REGEX = /^[A-Z0-9.\-^=]{1,20}$/;

let mainWindow = null;
let activeDataFilePath = null;
let isWritingData = false;
let fileOpenedOnStartup = null;

// Catch files opened with the app on macOS (e.g. drag & drop onto app icon or double click in Finder)
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  fileOpenedOnStartup = filePath;
  if (mainWindow && !mainWindow.isDestroyed()) {
    switchActiveDataFile(filePath, true);
  }
});

// Single instance lock to prevent port/file locking conflicts between instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

/**
 * QA helper: `BudgetingMacApp --test-notification` posts a real macOS system
 * notification and exits. Useful to verify that the packaged build is able to
 * reach Notification Center without opening the UI.
 */
const isNotificationSmokeTest = process.argv.includes('--test-notification');
if (isNotificationSmokeTest) {
  app.whenReady().then(async () => {
    const result = await showNativeNotification(Notification, {
      title: 'BudgetingMacApp',
      body: 'Notifica di prova — il canale di sistema funziona.',
      tag: 'smoke-test',
    });
    const report = `[smoke-test] ${new Date().toISOString()} ${JSON.stringify(result)}`;
    console.log(report);
    try {
      require('fs').writeFileSync(require('os').tmpdir() + '/budget-notification-smoke.log', report + '\n');
    } catch {
      /* ignore */
    }
    setTimeout(() => app.quit(), 1500);
  });
}

/**
 * QA helper: `BudgetingMacApp --test-window-close` closes the window and
 * reports whether the app stays alive in the Dock (expected on macOS).
 */
const isWindowCloseSmokeTest = process.argv.includes('--test-window-close');
if (isWindowCloseSmokeTest) {
  app.whenReady().then(() => {
    createWindow();
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      setTimeout(() => {
        const alive = app.isReady();
        const report = `[window-close-test] ${new Date().toISOString()} alive=${alive} dockVisible=${
          app.dock ? app.dock.getBadge() !== undefined : 'n/a'
        }`;
        console.log(report);
        try {
          require('fs').writeFileSync(require('os').tmpdir() + '/budget-window-close-smoke.log', report + '\n');
        } catch {
          /* ignore */
        }
        setTimeout(() => app.quit(), 800);
      }, 2000);
    }, 2500);
  });
}

function parseSemver(v) {
  if (!v) return [0, 0, 0];
  const match = String(v).match(/(\d+(?:\.\d+)+)/);
  const target = match ? match[1] : String(v).replace(/^v/i, '').trim().split('-')[0];
  const parts = target.split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na > nb ? 1 : -1;
  }
  return 0;
}

function isNewerVersion(latest, current) {
  return compareSemver(latest, current) > 0;
}

function extractVersionsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const matches = [];
  const regex = /(?:^|[^0-9.])v?(\d+\.\d+(?:\.\d+){0,2})(?![0-9.])/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    if (m[1]) matches.push(m[1]);
  }
  return matches;
}

function extractBestVersionFromRelease(rel) {
  const candidates = [];
  candidates.push(...extractVersionsFromText(rel && rel.tag_name));
  candidates.push(...extractVersionsFromText(rel && rel.name));
  if (rel && Array.isArray(rel.assets)) {
    for (const asset of rel.assets) {
      candidates.push(...extractVersionsFromText(asset && asset.name));
    }
  }
  if (rel && typeof rel.body === 'string') {
    candidates.push(...extractVersionsFromText(rel.body.slice(0, 300)));
  }
  if (candidates.length === 0) {
    return String((rel && (rel.tag_name || rel.name)) || '0.0.0').replace(/^v/i, '').trim();
  }
  candidates.sort((a, b) => compareSemver(b, a));
  return candidates[0];
}

function pickReleaseAsset(assets, platform, arch, targetVersion) {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  const sorted = [...assets].sort((a, b) => {
    if (targetVersion) {
      const aHasVer = a.name && a.name.includes(targetVersion) ? 1 : 0;
      const bHasVer = b.name && b.name.includes(targetVersion) ? 1 : 0;
      if (aHasVer !== bHasVer) return bHasVer - aHasVer;
    }
    const tA = new Date((a && (a.updated_at || a.created_at)) || 0).getTime() || 0;
    const tB = new Date((b && (b.updated_at || b.created_at)) || 0).getTime() || 0;
    return tB - tA;
  });

  const mainPool = sorted.filter(
    (a) =>
      a &&
      a.name &&
      !a.name.endsWith('.command') &&
      !a.name.endsWith('.sh') &&
      !a.name.endsWith('.txt') &&
      !a.name.endsWith('.md') &&
      !a.name.endsWith('.blockmap') &&
      !a.name.endsWith('.yml')
  );
  const pool = mainPool.length > 0 ? mainPool : sorted;

  if (platform === 'darwin') {
    const isArm = arch === 'arm64';
    const armDmg = pool.find((a) => a.name.endsWith('.dmg') && (a.name.includes('arm64') || a.name.includes('aarch64')));
    const x64Dmg = pool.find((a) => a.name.endsWith('.dmg') && (a.name.includes('x64') || a.name.includes('intel')));
    const anyDmg = pool.find((a) => a.name.endsWith('.dmg'));
    const armZip = pool.find((a) => a.name.endsWith('.zip') && (a.name.includes('arm64') || a.name.includes('mac')));
    const anyZip = pool.find((a) => a.name.endsWith('.zip') || a.name.includes('.zip.part_'));

    if (isArm && armDmg) return armDmg;
    if (!isArm && x64Dmg) return x64Dmg;
    if (anyDmg) return anyDmg;
    if (isArm && armZip) return armZip;
    if (anyZip) return anyZip;
  } else if (platform === 'win32') {
    const exe = pool.find((a) => a.name.endsWith('.exe'));
    const zip = pool.find((a) => a.name.endsWith('.zip'));
    if (exe) return exe;
    if (zip) return zip;
  } else if (platform === 'linux') {
    const appImage = pool.find((a) => a.name.endsWith('.AppImage'));
    const deb = pool.find((a) => a.name.endsWith('.deb'));
    const zip = pool.find((a) => a.name.endsWith('.zip') || a.name.endsWith('.tar.gz'));
    if (appImage) return appImage;
    if (deb) return deb;
    if (zip) return zip;
  }

  return pool[0] || null;
}

function downloadFileWithRedirects(url, destPath, onProgress, authToken = '') {
  return new Promise((resolve, reject) => {
    try {
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
      }
    } catch {}

    const file = fs.createWriteStream(destPath);
    let totalBytes = 0;
    let receivedBytes = 0;

    function get(currentUrl, redirectCount = 0, includeAuth = Boolean(authToken)) {
      if (redirectCount > 8) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error('Troppi reindirizzamenti durante il download.'));
      }

      const client = currentUrl.startsWith('https:') ? https : http;
      const parsedUrl = new URL(currentUrl);

      const reqHeaders = {
        'User-Agent': 'BudgetingMacApp-Updater/1.0',
        'Accept': parsedUrl.hostname === 'api.github.com' ? 'application/octet-stream' : '*/*',
      };
      if (includeAuth && authToken && (parsedUrl.hostname === 'api.github.com' || parsedUrl.hostname === 'github.com')) {
        reqHeaders['Authorization'] = `token ${authToken}`;
      }

      const req = client.get(
        currentUrl,
        {
          headers: reqHeaders,
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let nextUrl = res.headers.location;
            if (!nextUrl.startsWith('http://') && !nextUrl.startsWith('https://')) {
              nextUrl = new URL(nextUrl, parsedUrl.origin).href;
            }
            const nextParsed = new URL(nextUrl);
            const keepAuth = nextParsed.hostname === 'api.github.com' || nextParsed.hostname === 'github.com';
            res.resume();
            return get(nextUrl, redirectCount + 1, keepAuth);
          }

          if (res.statusCode !== 200) {
            file.close();
            fs.unlink(destPath, () => {});
            return reject(new Error(`Download fallito con codice di stato HTTP ${res.statusCode}`));
          }

          totalBytes = parseInt(res.headers['content-length'] || '0', 10);

          res.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (onProgress) {
              const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
              onProgress({ percent, transferred: receivedBytes, total: totalBytes });
            }
          });

          res.pipe(file);

          file.on('finish', () => {
            file.close(() => resolve(destPath));
          });
        }
      );

      req.on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
    }

    get(url, 0, Boolean(authToken));
  });
}

function validateIpcSender(event) {
  if (!event || !event.senderFrame) return false;
  const frameUrl = event.senderFrame.url;
  if (!frameUrl) return false;

  if (frameUrl.startsWith('file://')) {
    try {
      const parsedPath = decodeURIComponent(new URL(frameUrl).pathname);
      const appRoot = path.resolve(__dirname, '..');
      const resourcesRoot = process.resourcesPath ? path.resolve(process.resourcesPath) : appRoot;
      return parsedPath.startsWith(appRoot) || parsedPath.startsWith(resourcesRoot);
    } catch {
      return false;
    }
  }

  try {
    const parsed = new URL(frameUrl);
    const parsedDev = new URL(devServerUrl);
    return parsed.origin === parsedDev.origin;
  } catch {
    return false;
  }
}

/**
 * Resolves the app icon for runtime use (Dock tile, window icon).
 *
 * In a packaged build macOS reads `Contents/Resources/icon.icns` on its own:
 * overriding it with a raster image is what makes the Dock tile look smaller
 * than the one of every other app. The PNG is therefore only used while
 * developing (`npm run dev`), where there is no bundle to read it from.
 */
function getAppIcon() {
  const possiblePaths = [
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '../build/icon.png'),
    path.join(__dirname, '../public/icon.png'),
    path.join(process.resourcesPath || '', 'build/icon.png'),
    path.join(process.resourcesPath || '', 'icon.png'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) {
          return { path: p, image: img };
        }
      } catch {
        return { path: p, image: null };
      }
    }
  }
  return { path: undefined, image: null };
}

const appIconInfo = getAppIcon();
const appIconPath = appIconInfo.path;

// === PERSISTENCE & DATA FILE MANAGEMENT ===

function getICloudDriveRoot() {
  const home = app.getPath('home') || process.env.HOME || '';
  if (!home) return '';
  return path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
}

function isICloudPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  return (
    filePath.includes('com~apple~CloudDocs') ||
    filePath.includes('Mobile Documents') ||
    filePath.toLowerCase().includes('icloud')
  );
}

function formatFriendlyDataLocation(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const home = app.getPath('home') || process.env.HOME || '';
  const icloudRoot = getICloudDriveRoot();
  if (icloudRoot && filePath.startsWith(icloudRoot)) {
    const rel = filePath.slice(icloudRoot.length).replace(/^\/+/, '');
    return `iCloud Drive ▸ ${rel.split('/').join(' ▸ ')}`;
  }
  if (home && filePath.startsWith(home)) {
    const rel = filePath.slice(home.length).replace(/^\/+/, '');
    return `~/${rel}`;
  }
  return filePath;
}

function getPrimaryDocumentsDir() {
  const home = app.getPath('home') || process.env.HOME || '';
  let documents = '';
  try {
    documents = app.getPath('documents');
  } catch {
    documents = path.join(home, 'Documents');
  }
  const dir = path.join(documents, 'BudgetingMacApp');
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch {}
  return dir;
}

function getCustomPathRecordFile() {
  return path.join(app.getPath('userData'), 'active-data-path.txt');
}

function getPrimaryConfigJsonFile() {
  return path.join(app.getPath('userData'), 'primary-data-config.json');
}

function recordPrimaryDataPath(filePath, isCustom = true) {
  if (!filePath || typeof filePath !== 'string') return;
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
  } catch {}
  try {
    fs.writeFileSync(getCustomPathRecordFile(), filePath, 'utf-8');
  } catch {}
  try {
    fs.writeFileSync(
      getPrimaryConfigJsonFile(),
      JSON.stringify(
        {
          primaryFilePath: filePath,
          isCustomPrimary: Boolean(isCustom),
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      'utf-8'
    );
  } catch {}
}

function getRecordedPrimaryInfo() {
  try {
    const cfgPath = getPrimaryConfigJsonFile();
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      if (parsed && typeof parsed.primaryFilePath === 'string' && parsed.primaryFilePath.trim()) {
        return {
          filePath: parsed.primaryFilePath.trim(),
          isCustomPrimary: Boolean(parsed.isCustomPrimary),
        };
      }
    }
  } catch {}
  try {
    const txtPath = getCustomPathRecordFile();
    if (fs.existsSync(txtPath)) {
      const recorded = fs.readFileSync(txtPath, 'utf-8').trim();
      if (recorded) {
        return {
          filePath: recorded,
          isCustomPrimary: true,
        };
      }
    }
  } catch {}
  return null;
}

function ensureICloudFileDownloaded(targetFilePath) {
  if (!targetFilePath || process.platform !== 'darwin') return;
  try {
    if (fs.existsSync(targetFilePath)) return;
    const dir = path.dirname(targetFilePath);
    const base = path.basename(targetFilePath);
    const placeholder = path.join(dir, `.${base}.icloud`);
    if (fs.existsSync(placeholder) && fs.existsSync('/usr/bin/brctl')) {
      child_process.execFileSync('/usr/bin/brctl', ['download', targetFilePath], {
        stdio: 'ignore',
        timeout: 4000,
      });
    }
  } catch {}
}

function getAllCandidatePaths() {
  const home = app.getPath('home') || process.env.HOME || '';
  const documentsDir = getPrimaryDocumentsDir();
  const primaryFile = path.join(documentsDir, 'user-data.json');
  const userData = app.getPath('userData');
  const icloudRoot = getICloudDriveRoot();

  let appData = '';
  try {
    appData = app.getPath('appData');
  } catch {
    appData = path.join(home, 'Library/Application Support');
  }

  let desktop = '';
  try {
    desktop = app.getPath('desktop');
  } catch {
    desktop = path.join(home, 'Desktop');
  }

  let downloads = '';
  try {
    downloads = app.getPath('downloads');
  } catch {
    downloads = path.join(home, 'Downloads');
  }

  const list = [];

  // 1. Stored primary path (always #1 priority)
  const recordedInfo = getRecordedPrimaryInfo();
  if (recordedInfo && recordedInfo.filePath) {
    ensureICloudFileDownloaded(recordedInfo.filePath);
    list.push(recordedInfo.filePath);
  }

  // 2. File opened on startup (drag and drop / open-file / argv)
  if (fileOpenedOnStartup && fs.existsSync(fileOpenedOnStartup)) {
    list.push(fileOpenedOnStartup);
  }

  // 3. iCloud Drive default location if present
  if (icloudRoot) {
    list.push(path.join(icloudRoot, 'BudgetingMacApp', 'user-data.json'));
    list.push(path.join(icloudRoot, 'user-data.json'));
  }

  // 4. Primary shared Documents folder (visible & permanent)
  list.push(primaryFile);
  list.push(path.join(documentsDir, 'budget-data.json'));

  // 5. Standard macOS Application Support folders (all variants across sessions)
  list.push(path.join(userData, 'user-data.json'));
  list.push(path.join(appData, 'BudgetingMacApp', 'user-data.json'));
  list.push(path.join(appData, 'budgeting-mac-app', 'user-data.json'));
  list.push(path.join(appData, 'com.budgeting.macapp', 'user-data.json'));
  list.push(path.join(appData, 'Electron', 'user-data.json'));

  // 6. User Documents root
  const baseDocDir = path.dirname(documentsDir);
  list.push(path.join(baseDocDir, 'user-data.json'));
  list.push(path.join(baseDocDir, 'budget-data.json'));

  // 7. Desktop & Downloads
  if (desktop) list.push(path.join(desktop, 'user-data.json'));
  if (downloads) list.push(path.join(downloads, 'user-data.json'));

  // 8. Working directory
  list.push(path.join(process.cwd(), 'user-data.json'));

  return Array.from(new Set(list));
}

function readValidBudgetJsonFile(filePath) {
  try {
    if (!filePath) return null;
    ensureICloudFileDownloaded(filePath);
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < 2) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const hasContent =
      Array.isArray(parsed?.transactions) ||
      Array.isArray(parsed?.assets) ||
      Array.isArray(parsed?.budgetCategories) ||
      parsed?.openingNetWorth !== undefined;
    if (hasContent) {
      return { parsed, mtimeMs: stat.mtimeMs };
    }
  } catch {}
  return null;
}

function findBestDataFile() {
  // CRITICAL: If user explicitly set a primary file path, ALWAYS keep that path as primary!
  const recordedInfo = getRecordedPrimaryInfo();
  if (recordedInfo && recordedInfo.filePath) {
    const validRecorded = readValidBudgetJsonFile(recordedInfo.filePath);
    if (validRecorded) {
      return {
        filePath: recordedInfo.filePath,
        data: validRecorded.parsed,
        isCustomPrimary: recordedInfo.isCustomPrimary,
      };
    }
    // Even if the file at recordedInfo.filePath hasn't been written yet or is temporarily empty,
    // keep recordedInfo.filePath as the primary path and seed data from any existing backup mirror.
    const candidates = getAllCandidatePaths();
    for (const candidate of candidates) {
      if (candidate === recordedInfo.filePath) continue;
      const fallback = readValidBudgetJsonFile(candidate);
      if (fallback) {
        return {
          filePath: recordedInfo.filePath,
          data: fallback.parsed,
          isCustomPrimary: recordedInfo.isCustomPrimary,
        };
      }
    }
    return {
      filePath: recordedInfo.filePath,
      data: null,
      isCustomPrimary: recordedInfo.isCustomPrimary,
    };
  }

  const candidates = getAllCandidatePaths();
  let bestCandidate = null;
  let bestMtime = -1;
  let bestData = null;

  for (const candidate of candidates) {
    const res = readValidBudgetJsonFile(candidate);
    if (res && res.mtimeMs > bestMtime) {
      bestMtime = res.mtimeMs;
      bestCandidate = candidate;
      bestData = res.parsed;
    }
  }

  const primaryDir = getPrimaryDocumentsDir();
  const defaultPath = path.join(primaryDir, 'user-data.json');

  if (bestCandidate) {
    return { filePath: bestCandidate, data: bestData, isCustomPrimary: false };
  }

  return { filePath: defaultPath, data: null, isCustomPrimary: false };
}

let lastWrittenHash = '';

/**
 * Impronta del contenuto *significativo* di un payload.
 *
 * Il payload contiene dei timestamp (`exportedAt`, `_fileMeta.updatedAt`) che
 * cambiano a ogni salvataggio: senza escluderli ogni scrittura produrrebbe
 * un file diverso, l'iCloud Drive lo sincronizzerebbe e l'altra piattaforma
 * ricaricherebbe... triggering un ciclo di riscritture. Con l'impronta
 * semantica si scrive solo quando i dati sono davvero diversi.
 */
function semanticHashOf(payload) {
  try {
    const stable = { ...payload };
    delete stable.exportedAt;
    if (stable._fileMeta && typeof stable._fileMeta === 'object') {
      stable._fileMeta = { ...stable._fileMeta };
      delete stable._fileMeta.updatedAt;
    }
    return crypto.createHash('md5').update(JSON.stringify(stable)).digest('hex');
  } catch {
    return '';
  }
}

/// Ultima impronta semantica scritta sul file principale.
let lastSemanticHash = '';

async function safeWriteJson(targetPath, data, primaryReferencePath = null) {
  isWritingData = true;
  const dir = path.dirname(targetPath);
  await fs.promises.mkdir(dir, { recursive: true });

  const refPath = primaryReferencePath || targetPath;
  const payloadWithMeta =
    data && typeof data === 'object'
      ? {
          ...data,
          _fileMeta: {
            fileName: path.basename(refPath),
            macFilePath: refPath,
            folderPath: path.dirname(refPath),
            displayLocation: formatFriendlyDataLocation(refPath),
            isICloud: isICloudPath(refPath),
            updatedAt: new Date().toISOString(),
          },
        }
      : data;

  const tempPath = path.join(dir, `.user-data-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.tmp`);
  const serialized = JSON.stringify(payloadWithMeta, null, 2);
  lastWrittenHash = crypto.createHash('md5').update(serialized).digest('hex');

  await fs.promises.writeFile(tempPath, serialized, 'utf-8');

  // Retry rename if locked by another app or session
  let attempts = 0;
  while (attempts < 6) {
    try {
      await fs.promises.rename(tempPath, targetPath);
      break;
    } catch {
      attempts++;
      if (attempts >= 6) {
        await fs.promises.writeFile(targetPath, serialized, 'utf-8');
        try { await fs.promises.unlink(tempPath); } catch {}
        break;
      }
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  setTimeout(() => {
    isWritingData = false;
  }, 1200);
}

let activeFileWatcher = null;

function setupDataFileWatcher(filePath) {
  if (activeFileWatcher) {
    try {
      fs.unwatchFile(activeFileWatcher);
    } catch {}
    activeFileWatcher = null;
  }

  activeFileWatcher = filePath;

  // Watch for external modifications (iCloud sync, external edits, other session)
  fs.watchFile(filePath, { interval: 1500 }, async (curr, prev) => {
    if (isWritingData) return;
    if (curr.mtimeMs <= prev.mtimeMs) return;

    try {
      if (!fs.existsSync(filePath)) return;
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const incomingHash = crypto.createHash('md5').update(content).digest('hex');

      // If content is identical to what we just wrote, ignore to avoid re-render loops
      if (incomingHash === lastWrittenHash) return;
      lastWrittenHash = incomingHash;
      // Il contenuto e' cambiato dall'esterno: la prossima scrittura deve
      // avvenire (e non essere scartata come duplicata).
      lastSemanticHash = '';

      const parsed = JSON.parse(content);

      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send('app:data-updated-on-disk', parsed);
      }
    } catch (err) {
      console.error('Error reading updated data file:', err);
    }
  });
}

function switchActiveDataFile(newPath, broadcast = false, isCustom = true) {
  activeDataFilePath = newPath;
  setupDataFileWatcher(newPath);
  recordPrimaryDataPath(newPath, isCustom);

  if (broadcast && mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (fs.existsSync(newPath)) {
        const content = fs.readFileSync(newPath, 'utf-8');
        const parsed = JSON.parse(content);
        mainWindow.webContents.send('app:data-updated-on-disk', parsed);
      }
    } catch {}
  }
}

// === WINDOW & BUNDLE LOADING ===

function getIndexHtmlPath() {
  const possiblePaths = [
    path.join(app.getAppPath(), 'dist', 'index.html'),
    path.join(__dirname, '..', 'dist', 'index.html'),
    path.join(__dirname, 'dist', 'index.html'),
    path.join(process.resourcesPath || '', 'app.asar', 'dist', 'index.html'),
    path.join(process.resourcesPath || '', 'app', 'dist', 'index.html'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function getWindowStatePath() {
  try {
    return path.join(app.getPath('userData'), 'window-state.json');
  } catch {
    return null;
  }
}

function loadWindowState() {
  let defaultWidth = 1440;
  let defaultHeight = 960;
  let workArea = { x: 0, y: 0, width: 1440, height: 960 };

  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    if (primaryDisplay && primaryDisplay.workArea) {
      workArea = primaryDisplay.workArea;
      defaultWidth = Math.min(1440, Math.round(workArea.width * 0.92));
      defaultHeight = Math.min(960, Math.round(workArea.height * 0.90));
    }
  } catch {}

  const statePath = getWindowStatePath();
  if (statePath && fs.existsSync(statePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const width = Math.max(680, Math.min(Number(saved.width) || defaultWidth, workArea.width));
      const height = Math.max(500, Math.min(Number(saved.height) || defaultHeight, workArea.height));

      let x = typeof saved.x === 'number' ? saved.x : undefined;
      let y = typeof saved.y === 'number' ? saved.y : undefined;

      if (x !== undefined && y !== undefined) {
        const displays = screen.getAllDisplays();
        const isVisible = displays.some((d) => {
          const wa = d.workArea;
          return x >= wa.x - 100 && x < wa.x + wa.width - 100 && y >= wa.y - 50 && y < wa.y + wa.height - 100;
        });
        if (!isVisible) {
          x = undefined;
          y = undefined;
        }
      }

      return {
        width,
        height,
        x,
        y,
        isMaximized: Boolean(saved.isMaximized),
        isFullScreen: Boolean(saved.isFullScreen),
      };
    } catch {}
  }

  return {
    width: Math.max(680, defaultWidth),
    height: Math.max(500, defaultHeight),
    x: undefined,
    y: undefined,
    isMaximized: false,
    isFullScreen: false,
  };
}

let saveWindowStateTimer = null;
function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const statePath = getWindowStatePath();
  if (!statePath) return;

  try {
    const isMaximized = win.isMaximized();
    const isFullScreen = win.isFullScreen();
    const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    const data = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized,
      isFullScreen,
    };
    fs.writeFileSync(statePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

function scheduleSaveWindowState(win) {
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(() => {
    saveWindowState(win);
    if (win && !win.isDestroyed() && win.webContents) {
      try {
        win.webContents.send('app:window-bounds-changed', win.getBounds());
      } catch {}
    }
  }, 180);
}

function createWindow() {
  const winState = loadWindowState();

  mainWindow = new BrowserWindow({
    width: winState.width,
    height: winState.height,
    x: winState.x,
    y: winState.y,
    minWidth: 680,
    minHeight: 500,
    show: false, // Prevent black screen flash while loading
    backgroundColor: '#08111f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 16 },
    icon: appIconInfo.image || appIconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Allows local ES modules and bundled assets under file://
      webSecurity: false, // Allows smooth local asset resolution without CORS blocks
      allowRunningInsecureContent: false,
    },
  });

  if (winState.isFullScreen) {
    mainWindow.setFullScreen(true);
  } else if (winState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.on('resize', () => scheduleSaveWindowState(mainWindow));
  mainWindow.on('move', () => scheduleSaveWindowState(mainWindow));
  mainWindow.on('maximize', () => scheduleSaveWindowState(mainWindow));
  mainWindow.on('unmaximize', () => scheduleSaveWindowState(mainWindow));
  mainWindow.on('enter-full-screen', () => scheduleSaveWindowState(mainWindow));
  mainWindow.on('leave-full-screen', () => scheduleSaveWindowState(mainWindow));
  mainWindow.on('close', () => saveWindowState(mainWindow));

  // Smoothly show window when content is rendered
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Safety fallback in case ready-to-show event takes too long
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  }, 1400);

  // Disallow arbitrary new window creation and open web links in default system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Guard against arbitrary web navigation away from the application
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const isFileUrl = navigationUrl.startsWith('file://');
      if (!isFileUrl) {
        event.preventDefault();
        if (navigationUrl.startsWith('https:') || navigationUrl.startsWith('http:')) {
          shell.openExternal(navigationUrl);
        }
      }
    } catch {
      event.preventDefault();
    }
  });

  // Handle load errors so window never gets permanently stuck on a black screen
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`Page failed to load [${errorCode}]: ${errorDescription} at ${validatedURL}`);
    const localIndex = getIndexHtmlPath();
    if (localIndex && validatedURL !== `file://${localIndex}`) {
      mainWindow.loadFile(localIndex);
    }
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('Renderer process gone:', details);
    if (details.reason !== 'clean-exit') {
      mainWindow.reload();
    }
  });

  const localIndexPath = getIndexHtmlPath();

  if (localIndexPath) {
    mainWindow.loadFile(localIndexPath).catch((err) => {
      console.error('Failed to load local HTML bundle:', err);
    });
  } else {
    // If local dist is not yet built, try devServerUrl
    mainWindow.loadURL(devServerUrl).catch(() => {
      console.error('Neither local dist bundle nor dev server is reachable.');
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// === APP LIFECYCLE ===

app.whenReady().then(() => {
  // Initialize data file discovery
  const initialBest = findBestDataFile();
  activeDataFilePath = initialBest.filePath;
  setupDataFileWatcher(activeDataFilePath);

  if (process.platform === 'darwin' && app.dock) {
    // Packaged builds: macOS picks the icon up from the bundle (.icns), so the
    // Dock tile keeps the exact same size as every other app. Overriding it
    // here with a raster image is what makes the icon look smaller/off-grid.
    if (!app.isPackaged) {
      try {
        if (appIconInfo.image && !appIconInfo.image.isEmpty()) {
          app.dock.setIcon(appIconInfo.image);
        } else if (appIconPath && fs.existsSync(appIconPath)) {
          app.dock.setIcon(appIconPath);
        }
      } catch (err) {
        console.error('Failed to set dock icon:', err);
      }
    }
  }

  // Enforce Content-Security-Policy for network sessions without blocking file:// resources
  if (session.defaultSession) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      // Do not alter headers for local file:// protocol
      if (details.url.startsWith('file://')) {
        callback({ cancel: false });
        return;
      }
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' file: data: blob:; script-src 'self' file: 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' file: blob:; style-src 'self' file: 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' file: https://fonts.gstatic.com data:; img-src 'self' file: data: blob: https:; connect-src 'self' file: https://query1.finance.yahoo.com https://api.github.com https://github.com https://objects.githubusercontent.com ws: wss: http://localhost:* http://127.0.0.1:*;"
          ],
          'X-Content-Type-Options': ['nosniff'],
        },
      });
    });
  }

  if (isNotificationSmokeTest || isWindowCloseSmokeTest) return;

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }
    // Clicking a system notification (or the dock icon) must bring the app forward
    focusMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    return;
  }
  // macOS: the app stays alive in the Dock when the window is closed, so the
  // icon remains visible and clicking it re-opens the window.
  if (app.dock && typeof app.dock.show === 'function') {
    app.dock.show();
  }
});

// === IPC HANDLERS ===

ipcMain.handle('app:ping', (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }
  return {
    ok: true,
    version: app.getVersion(),
    platform: process.platform,
    dataFilePath: activeDataFilePath,
  };
});

ipcMain.handle('app:load-data', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  try {
    const best = findBestDataFile();
    activeDataFilePath = best.filePath;
    setupDataFileWatcher(activeDataFilePath);

    if (best.data) {
      return best.data;
    }

    if (fs.existsSync(activeDataFilePath)) {
      const content = await fs.promises.readFile(activeDataFilePath, 'utf-8');
      return JSON.parse(content);
    }

    return null;
  } catch (error) {
    console.error('Failed to load user data:', error?.message || error);
    return null;
  }
});

ipcMain.handle('app:save-data', async (event, data) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  try {
    const recordedInfo = getRecordedPrimaryInfo();
    if (recordedInfo && recordedInfo.filePath) {
      activeDataFilePath = recordedInfo.filePath;
    } else if (!activeDataFilePath) {
      const primaryDir = getPrimaryDocumentsDir();
      activeDataFilePath = path.join(primaryDir, 'user-data.json');
    }

    // Limit maximum payload to 50MB
    const serialized = JSON.stringify(data);
    if (serialized.length > 50 * 1024 * 1024) {
      return { success: false, error: 'Payload exceeds maximum allowed size (50MB)' };
    }

    // 1. Write to internal redundancy mirrors FIRST (so primary path always has the newest mtime)
    const primaryDir = getPrimaryDocumentsDir();
    const primaryPath = path.join(primaryDir, 'user-data.json');
    if (activeDataFilePath !== primaryPath) {
      try {
        await safeWriteJson(primaryPath, data, activeDataFilePath);
      } catch {}
    }

    const internalPath = path.join(app.getPath('userData'), 'user-data.json');
    if (activeDataFilePath !== internalPath && primaryPath !== internalPath) {
      try {
        await safeWriteJson(internalPath, data, activeDataFilePath);
      } catch {}
    }

    // Se il contenuto non e' cambiato, non riscrivere: evita conflitti con
    // l'altra piattaforma quando il file e' condiviso su iCloud Drive.
    const semanticHash = semanticHashOf(data);
    if (semanticHash && semanticHash === lastSemanticHash && fs.existsSync(activeDataFilePath)) {
      return { success: true, filePath: activeDataFilePath };
    }
    lastSemanticHash = semanticHash;

    // 2. Write to the active primary path LAST and lock it as primary
    await safeWriteJson(activeDataFilePath, data, activeDataFilePath);
    recordPrimaryDataPath(activeDataFilePath, Boolean(recordedInfo?.isCustomPrimary));

    return { success: true, filePath: activeDataFilePath };
  } catch (error) {
    console.error('Failed to save user data:', error?.message || error);
    return { success: false, error: 'Errore durante il salvataggio dei dati' };
  }
});

ipcMain.handle('app:get-data-file-info', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  try {
    const recordedInfo = getRecordedPrimaryInfo();
    if (recordedInfo && recordedInfo.filePath) {
      activeDataFilePath = recordedInfo.filePath;
    }
    const currentPath = activeDataFilePath || path.join(getPrimaryDocumentsDir(), 'user-data.json');
    const exists = Boolean(currentPath && fs.existsSync(currentPath));
    let size = 0;
    let lastModified = 0;

    if (exists) {
      const stat = fs.statSync(currentPath);
      size = stat.size;
      lastModified = stat.mtimeMs;
    }

    const icloudRoot = getICloudDriveRoot();
    const iCloudAvailable = Boolean(icloudRoot && fs.existsSync(icloudRoot));
    const iCloudDefaultPath = icloudRoot
      ? path.join(icloudRoot, 'BudgetingMacApp', 'user-data.json')
      : '';

    return {
      filePath: currentPath,
      fileName: path.basename(currentPath),
      folderPath: path.dirname(currentPath),
      displayLocation: formatFriendlyDataLocation(currentPath),
      isICloud: isICloudPath(currentPath),
      isCustomPrimary: Boolean(recordedInfo?.isCustomPrimary),
      iCloudAvailable,
      iCloudDefaultPath,
      exists,
      size,
      lastModified,
      candidates: getAllCandidatePaths().filter((p) => fs.existsSync(p)),
    };
  } catch (err) {
    const fallbackPath = activeDataFilePath || '';
    return {
      filePath: fallbackPath,
      fileName: fallbackPath ? path.basename(fallbackPath) : 'user-data.json',
      folderPath: fallbackPath ? path.dirname(fallbackPath) : '',
      displayLocation: formatFriendlyDataLocation(fallbackPath),
      isICloud: isICloudPath(fallbackPath),
      isCustomPrimary: false,
      iCloudAvailable: false,
      iCloudDefaultPath: '',
      exists: false,
      size: 0,
      lastModified: 0,
      candidates: [],
    };
  }
});

ipcMain.handle('app:scan-receipt', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Scegli la foto dello scontrino',
      buttonLabel: 'Riconosci',
      properties: ['openFile'],
      filters: [
        { name: 'Immagini', extensions: ['png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'tiff', 'tif', 'bmp'] },
        { name: 'Tutti i file', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const text = await runReceiptOcr(result.filePaths[0]);

    if (!text || !text.trim()) {
      return { success: false, error: 'Nessun testo riconosciuto nella foto dello scontrino.' };
    }

    return { success: true, text, source: 'vision' };
  } catch (error) {
    console.error('Errore durante la scansione dello scontrino:', error);
    return { success: false, error: error?.message || 'Riconoscimento non riuscito.' };
  }
});

/**
 * Motore OCR: il binario `receipt-ocr` (compilato da `npm run build:ocr`)
 * usa il framework Vision di macOS. Se il binario non c'e', prova a
 * compilarlo al volo; se impossibile, lo dice con un messaggio chiaro.
 */
function resolveOcrBinary() {
  const candidates = [];

  if (app.isPackaged && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'bin', 'receipt-ocr'));
  }
  candidates.push(path.join(__dirname, 'bin', 'receipt-ocr'));

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function compileOcrBinary() {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'receipt-ocr.swift');
  const enginePath = path.join(__dirname, '..', 'ios', 'BudgetApp', 'Bridge', 'ReceiptOCR.swift');
  if (!fs.existsSync(scriptPath)) return null;

  // Il comando e il motore condiviso con iOS vengono compilati insieme.
  const sources = [scriptPath];
  if (fs.existsSync(enginePath)) sources.push(enginePath);

  const targetPath = path.join(app.getPath('userData'), 'receipt-ocr');
  const combinedPath = path.join(app.getPath('userData'), 'receipt-ocr-build.swift');

  try {
    fs.writeFileSync(combinedPath, sources.map((file) => fs.readFileSync(file, 'utf-8')).join('\n'));
    child_process.execFileSync('swiftc', ['-O', combinedPath, '-o', targetPath], {
      stdio: 'ignore',
      timeout: 180000,
    });
  } catch (error) {
    console.error('Compilazione del motore OCR non riuscita:', error?.message || error);
    return null;
  } finally {
    try {
      fs.unlinkSync(combinedPath);
    } catch {}
  }

  return fs.existsSync(targetPath) ? targetPath : null;
}

/**
 * Esegue il motore OCR. Usa la API asincrona: il riconoscimento (che al
 * primo avvio può richiedere qualche secondo per caricare i modelli di
 * Vision) non deve bloccare il processo principale e congelare l'interfaccia.
 */
async function runReceiptOcr(imagePath) {
  const binary = resolveOcrBinary() || compileOcrBinary();

  if (!binary) {
    throw new Error(
      "Motore OCR non disponibile: installa gli Xcode Command Line Tools (per swiftc) e ricostruisci l'app, oppure usa la versione iOS."
    );
  }

  const stdout = await new Promise((resolve, reject) => {
    child_process.execFile(
      binary,
      [imagePath],
      { encoding: 'utf-8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });

  try {
    const parsed = JSON.parse(stdout);
    return parsed.text || '';
  } catch {
    return stdout;
  }
}

ipcMain.handle('app:select-data-file', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  const icloudRoot = getICloudDriveRoot();
  const defaultDir =
    activeDataFilePath && fs.existsSync(path.dirname(activeDataFilePath))
      ? path.dirname(activeDataFilePath)
      : icloudRoot && fs.existsSync(icloudRoot)
        ? icloudRoot
        : getPrimaryDocumentsDir();

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleziona il file user-data.json (anche da iCloud Drive)',
    defaultPath: defaultDir,
    properties: ['openFile'],
    filters: [
      { name: 'File Dati Budget (JSON)', extensions: ['json'] },
      { name: 'Tutti i file', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  const selectedPath = result.filePaths[0];

  try {
    ensureICloudFileDownloaded(selectedPath);
    const content = await fs.promises.readFile(selectedPath, 'utf-8');
    const parsed = JSON.parse(content);

    switchActiveDataFile(selectedPath, true, true);
    // Update _fileMeta in the file so Mac and Web both see the exact chosen path
    try {
      await safeWriteJson(selectedPath, parsed, selectedPath);
    } catch {}

    return {
      success: true,
      filePath: selectedPath,
      displayLocation: formatFriendlyDataLocation(selectedPath),
      isICloud: isICloudPath(selectedPath),
      data: parsed,
    };
  } catch (error) {
    return {
      success: false,
      error: `Impossibile leggere il file selezionato: ${error?.message || 'formato non valido'}`,
    };
  }
});

ipcMain.handle('app:choose-save-data-location', async (event, currentData, startInICloud = false) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  const icloudRoot = getICloudDriveRoot();
  let startDir = getPrimaryDocumentsDir();
  if (startInICloud && icloudRoot && fs.existsSync(icloudRoot)) {
    startDir = icloudRoot;
  } else if (activeDataFilePath && fs.existsSync(path.dirname(activeDataFilePath))) {
    startDir = path.dirname(activeDataFilePath);
  } else if (icloudRoot && fs.existsSync(icloudRoot)) {
    startDir = icloudRoot;
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Scegli dove salvare user-data.json come Posizione Principale (anche iCloud Drive)',
    defaultPath: path.join(startDir, 'user-data.json'),
    buttonLabel: 'Imposta come Principale e Salva',
    properties: ['createDirectory', 'showOverwriteConfirmation'],
    filters: [{ name: 'File Dati Budget (JSON)', extensions: ['json'] }],
  });

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }

  const chosenPath = result.filePath.endsWith('.json') ? result.filePath : `${result.filePath}.json`;

  try {
    let dataToUse = currentData;
    // If file already exists at chosenPath and has valid budget data, check if we should load or save
    const existingValid = readValidBudgetJsonFile(chosenPath);
    if (!dataToUse && existingValid) {
      dataToUse = existingValid.parsed;
    }

    switchActiveDataFile(chosenPath, false, true);

    if (dataToUse && typeof dataToUse === 'object') {
      await safeWriteJson(chosenPath, dataToUse, chosenPath);
    } else if (existingValid && existingValid.parsed) {
      await safeWriteJson(chosenPath, existingValid.parsed, chosenPath);
      dataToUse = existingValid.parsed;
    }

    return {
      success: true,
      filePath: chosenPath,
      displayLocation: formatFriendlyDataLocation(chosenPath),
      isICloud: isICloudPath(chosenPath),
      data: dataToUse,
    };
  } catch (error) {
    return {
      success: false,
      error: `Impossibile salvare nella posizione scelta: ${error?.message || 'errore di scrittura'}`,
    };
  }
});

/**
 * Collega un file user-data.json ESISTENTE (per esempio su iCloud Drive)
 * come posizione principale, senza sovrascriverlo.
 *
 * E' il flusso simmetrico a quello iOS e permette a Mac e iPhone di usare
 * lo stesso file: le modifiche vengono sincronizzate da iCloud Drive.
 */
ipcMain.handle('app:link-primary-file', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  const icloudRoot = getICloudDriveRoot();
  const startDir =
    activeDataFilePath && fs.existsSync(path.dirname(activeDataFilePath))
      ? path.dirname(activeDataFilePath)
      : icloudRoot && fs.existsSync(icloudRoot)
        ? icloudRoot
        : getPrimaryDocumentsDir();

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Collega user-data.json esistente (es. su iCloud Drive)',
    defaultPath: startDir,
    buttonLabel: 'Collega',
    properties: ['openFile'],
    filters: [{ name: 'File Dati Budget (JSON)', extensions: ['json'] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  const chosenPath = result.filePaths[0];

  try {
    const existing = readValidBudgetJsonFile(chosenPath);

    switchActiveDataFile(chosenPath, false, true);

    return {
      success: true,
      filePath: chosenPath,
      displayLocation: formatFriendlyDataLocation(chosenPath),
      isICloud: isICloudPath(chosenPath),
      data: existing && existing.parsed ? existing.parsed : null,
    };
  } catch (error) {
    return {
      success: false,
      error: `Impossibile collegare il file scelto: ${error?.message || 'errore'}`,
    };
  }
});

ipcMain.handle('app:use-icloud-data-location', async (event, currentData) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  const icloudRoot = getICloudDriveRoot();
  if (!icloudRoot || !fs.existsSync(icloudRoot)) {
    return {
      success: false,
      error: 'Cartella iCloud Drive non trovata su questo Mac. Assicurati che iCloud Drive sia attivo nelle Impostazioni di Sistema oppure usa "Scegli posizione principale...".',
    };
  }

  try {
    const icloudAppDir = path.join(icloudRoot, 'BudgetingMacApp');
    if (!fs.existsSync(icloudAppDir)) {
      fs.mkdirSync(icloudAppDir, { recursive: true });
    }
    const icloudFilePath = path.join(icloudAppDir, 'user-data.json');

    const existingICloud = readValidBudgetJsonFile(icloudFilePath);
    let dataToUse = currentData;

    // If an existing valid file is already on iCloud Drive and has transactions while currentData is empty, prefer it
    if (
      existingICloud &&
      existingICloud.parsed &&
      (!currentData || (!Array.isArray(currentData.transactions) || currentData.transactions.length === 0))
    ) {
      dataToUse = existingICloud.parsed;
    }

    switchActiveDataFile(icloudFilePath, false, true);

    if (dataToUse && typeof dataToUse === 'object') {
      await safeWriteJson(icloudFilePath, dataToUse, icloudFilePath);
    }

    return {
      success: true,
      filePath: icloudFilePath,
      displayLocation: formatFriendlyDataLocation(icloudFilePath),
      isICloud: true,
      data: dataToUse,
    };
  } catch (error) {
    return {
      success: false,
      error: `Errore durante la configurazione su iCloud Drive: ${error?.message || 'errore sconosciuto'}`,
    };
  }
});

ipcMain.handle('app:open-data-folder', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  try {
    if (activeDataFilePath && fs.existsSync(activeDataFilePath)) {
      shell.showItemInFolder(activeDataFilePath);
      return true;
    }
    const dir = getPrimaryDocumentsDir();
    shell.openPath(dir);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('app:open-external', async (event, url) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('app:get-ticker-price', async (event, ticker) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  if (!ticker || typeof ticker !== 'string') {
    throw new Error('Ticker is required');
  }

  const tickerClean = ticker.trim().toUpperCase();
  if (!TICKER_REGEX.test(tickerClean)) {
    throw new Error('Invalid ticker symbol format');
  }

  try {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tickerClean)}?range=1y&interval=1d`;
    const response = await fetch(yahooUrl, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance returned status ${response.status}`);
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;

    if (!meta) {
      throw new Error('Ticker not found or no metadata available');
    }

    const price = meta.regularMarketPrice;
    const previousClose = meta.chartPreviousClose;
    const currency = meta.currency || 'USD';
    const symbol = meta.symbol || tickerClean;
    const longName = meta.longName || symbol;

    const timestamp = result?.timestamp || [];
    const closePrices = result?.indicators?.quote?.[0]?.close || [];

    const history = timestamp
      .map((t, index) => {
        const dateStr = new Date(t * 1000).toISOString().split('T')[0];
        return {
          date: dateStr,
          price: closePrices[index],
        };
      })
      .filter((item) => item.price !== null && item.price !== undefined);

    return {
      price,
      previousClose,
      currency,
      symbol,
      longName,
      history,
    };
  } catch (error) {
    console.error(`Error in app:get-ticker-price for ${tickerClean}:`, error?.message || error);
    throw new Error('Impossibile recuperare i dati del ticker');
  }
});

function getStoredGithubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  try {
    if (activeDataFilePath && fs.existsSync(activeDataFilePath)) {
      const parsed = JSON.parse(fs.readFileSync(activeDataFilePath, 'utf-8'));
      if (parsed && typeof parsed.githubToken === 'string' && parsed.githubToken.trim()) {
        return parsed.githubToken.trim();
      }
    }
  } catch {}
  return '';
}

ipcMain.handle('app:check-for-updates', async (event, customRepo, customToken) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  const defaultRepo = (process.env.GITHUB_REPO || 'Ale410-cpu/App-Budgeting-2').replace('App-Budegting-2', 'App-Budgeting-2');
  let rawInput = customRepo && typeof customRepo === 'string' && customRepo.trim() ? customRepo.trim() : defaultRepo;
  rawInput = rawInput
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace('App-Budegting-2', 'App-Budgeting-2');

  const repoMatch = rawInput.match(/^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
  const repo =
    repoMatch && !repoMatch[1].includes('sole31012002')
      ? repoMatch[1]
      : defaultRepo;

  const currentVersion = app.getVersion() || '0.3.6';
  const token = (typeof customToken === 'string' && customToken.trim()) || getStoredGithubToken();

  try {
    const apiUrl = `https://api.github.com/repos/${repo}/releases?per_page=30&_t=${Date.now()}`;
    const headers = {
      'User-Agent': 'BudgetingMacApp-Updater/1.0',
      'Accept': 'application/vnd.github.v3+json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
    };
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }

    let response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(9000),
      headers,
    });

    if ((response.status === 401 || response.status === 403) && token) {
      const publicHeaders = { ...headers };
      delete publicHeaders['Authorization'];
      response = await fetch(apiUrl, {
        signal: AbortSignal.timeout(9000),
        headers: publicHeaders,
      });
    }

    if (response.status === 404) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: currentVersion,
        message: token
          ? `Repository "${repo}" non trovato su GitHub (404). Verifica il nome "proprietario/repository".`
          : `Repository "${repo}" non trovato o privato (404). Se la repository su GitHub è privata, rendila Pubblica nelle impostazioni di GitHub (Settings → Change visibility → Public) oppure inserisci un Token GitHub (PAT).`,
        repo,
      };
    }

    if (!response.ok) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: currentVersion,
        error: `Risposta da GitHub: codice ${response.status}`,
        repo,
      };
    }

    const releasesList = await response.json();
    let validReleases = Array.isArray(releasesList)
      ? releasesList.filter((r) => !r.draft)
      : [];
    if (validReleases.length === 0 && Array.isArray(releasesList) && releasesList.length > 0) {
      validReleases = releasesList;
    }

    if (validReleases.length === 0) {
      const tagsResp = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=20&_t=${Date.now()}`, {
        signal: AbortSignal.timeout(8000),
        headers,
      });
      if (tagsResp.ok) {
        const tagsList = await tagsResp.json();
        if (Array.isArray(tagsList) && tagsList.length > 0) {
          validReleases = tagsList.map((t) => ({
            tag_name: t.name,
            name: t.name,
            body: 'Tag pubblicato su GitHub.',
            html_url: `https://github.com/${repo}/releases/tag/${t.name}`,
            assets: [],
          }));
        }
      }
    }

    if (validReleases.length === 0) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: currentVersion,
        message: `Nessuna release o versione pubblicata trovata nel repository "${repo}".`,
        repo,
      };
    }

    const enriched = validReleases.map((rel) => {
      const detectedVersion = extractBestVersionFromRelease(rel);
      const timestamp = Math.max(
        new Date(rel.updated_at || 0).getTime() || 0,
        new Date(rel.published_at || 0).getTime() || 0,
        new Date(rel.created_at || 0).getTime() || 0
      );
      return { rel, detectedVersion, timestamp };
    });

    enriched.sort((a, b) => {
      const cmp = compareSemver(b.detectedVersion, a.detectedVersion);
      if (cmp !== 0) return cmp;
      return b.timestamp - a.timestamp;
    });

    const best = enriched[0];
    const data = best.rel;
    const latestVersion = best.detectedVersion;
    const tagName = data.tag_name || `v${latestVersion}`;

    const hasUpdate = isNewerVersion(latestVersion, currentVersion);
    const chosenAsset = pickReleaseAsset(data.assets || [], process.platform, process.arch, latestVersion);

    return {
      updateAvailable: hasUpdate,
      currentVersion,
      latestVersion,
      tagName,
      releaseName: data.name || tagName,
      releaseNotes: data.body || 'Nessuna nota di rilascio fornita per questo aggiornamento.',
      publishedAt: data.updated_at || data.published_at || data.created_at,
      htmlUrl: data.html_url || `https://github.com/${repo}/releases`,
      isPrerelease: Boolean(data.prerelease),
      repo,
      asset: chosenAsset
        ? {
            name: chosenAsset.name,
            downloadUrl: chosenAsset.browser_download_url,
            apiUrl: chosenAsset.url,
            size: chosenAsset.size,
            contentType: chosenAsset.content_type,
          }
        : null,
    };
  } catch (error) {
    console.error('Error in app:check-for-updates:', error?.message || error);
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      error: error?.message || 'Impossibile verificare gli aggiornamenti su GitHub.',
      repo,
    };
  }
});

function findAppBundleInDirectory(dirPath, maxDepth = 3, currentDepth = 0) {
  if (currentDepth > maxDepth || !fs.existsSync(dirPath)) return null;
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('._') || entry.name === '__MACOSX') continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory() && entry.name.toLowerCase().endsWith('.app')) {
      return fullPath;
    }
  }

  for (const entry of entries) {
    if (entry.name.startsWith('._') || entry.name === '__MACOSX') continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory() && !entry.name.toLowerCase().endsWith('.app')) {
      const found = findAppBundleInDirectory(fullPath, maxDepth, currentDepth + 1);
      if (found) return found;
    }
  }
  return null;
}

function getRunningMacAppBundlePath() {
  try {
    const exePath = app.getPath('exe') || '';
    const match = exePath.match(/^(.+?\.app)(?:\/|$)/i);
    if (match && match[1]) {
      const bundlePath = match[1];
      if (bundlePath.toLowerCase().endsWith('/electron.app')) {
        return '/Applications/BudgetingMacApp.app';
      }
      if (bundlePath.includes('/AppTranslocation/')) {
        try {
          const out = child_process
            .execFileSync('/usr/bin/security', ['translocate-original-path', bundlePath], {
              encoding: 'utf-8',
              stdio: ['ignore', 'pipe', 'ignore'],
            })
            .trim();
          const origMatch = out.match(/original-path=(.+\.app)/i);
          if (origMatch && origMatch[1] && !origMatch[1].startsWith('/Volumes/')) {
            return origMatch[1].trim();
          }
        } catch {}
        return path.join('/Applications', path.basename(bundlePath));
      }
      if (bundlePath.startsWith('/Volumes/')) {
        return path.join('/Applications', path.basename(bundlePath));
      }
      return bundlePath;
    }
  } catch {}
  return '/Applications/BudgetingMacApp.app';
}

ipcMain.handle('app:download-and-install-update', async (event, { downloadUrl, apiUrl, assetName, githubToken }) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  if (!downloadUrl || typeof downloadUrl !== 'string') {
    throw new Error('downloadUrl è richiesto');
  }

  const safeAssetName =
    assetName && typeof assetName === 'string'
      ? path.basename(assetName.split('?')[0])
      : `BudgetingMacApp-update-${Date.now()}.zip`;

  const tempDir = app.getPath('temp');
  const targetFile = path.join(tempDir, safeAssetName);
  const token = (typeof githubToken === 'string' && githubToken.trim()) || getStoredGithubToken();
  const effectiveUrl = token && apiUrl ? apiUrl : downloadUrl;

  const emitProgress = (progress) => {
    try {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('app:update-progress', { ...progress, phase: 'downloading' });
      }
    } catch {}
  };

  try {
    try {
      await downloadFileWithRedirects(effectiveUrl, targetFile, emitProgress, token);
    } catch (firstErr) {
      if (token && effectiveUrl !== downloadUrl) {
        await downloadFileWithRedirects(downloadUrl, targetFile, emitProgress, '');
      } else {
        throw firstErr;
      }
    }

    const ext = path.extname(targetFile).toLowerCase();

    if (process.platform === 'darwin') {
      try {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('app:update-progress', {
            percent: 100,
            transferred: 1,
            total: 1,
            phase: 'installing',
          });
        }
      } catch {}

      const stagingDir = path.join(tempDir, `BudgetApp-stage-${Date.now()}`);
      fs.mkdirSync(stagingDir, { recursive: true });

      if (ext === '.zip') {
        try {
          child_process.execFileSync('/usr/bin/ditto', ['-x', '-k', targetFile, stagingDir], {
            stdio: 'ignore',
          });
        } catch {
          child_process.execFileSync('/usr/bin/unzip', ['-q', '-o', '-y', targetFile, '-d', stagingDir], {
            stdio: 'ignore',
          });
        }
      } else if (ext === '.dmg') {
        const mountPoint = path.join(tempDir, `BudgetApp-dmg-${Date.now()}`);
        fs.mkdirSync(mountPoint, { recursive: true });
        try {
          child_process.execFileSync(
            '/usr/bin/hdiutil',
            ['attach', '-nobrowse', '-readonly', '-noverify', '-noautoopen', '-mountpoint', mountPoint, targetFile],
            { stdio: 'ignore' }
          );
          const mountedApp = findAppBundleInDirectory(mountPoint, 2);
          if (!mountedApp) {
            throw new Error('Impossibile trovare il pacchetto .app all\'interno del file DMG.');
          }
          const destStaged = path.join(stagingDir, path.basename(mountedApp));
          child_process.execFileSync('/usr/bin/ditto', [mountedApp, destStaged], { stdio: 'ignore' });
        } finally {
          try {
            child_process.execFileSync('/usr/bin/hdiutil', ['detach', mountPoint, '-force'], {
              stdio: 'ignore',
            });
          } catch {}
        }
      } else {
        await shell.openPath(targetFile);
        return {
          success: true,
          message: 'File di aggiornamento scaricato con successo.',
          filePath: targetFile,
        };
      }

      const stagedAppPath = findAppBundleInDirectory(stagingDir, 3);
      if (!stagedAppPath) {
        throw new Error('Impossibile individuare l\'applicazione (.app) nel pacchetto scaricato.');
      }

      // Remove Gatekeeper quarantine and ensure executable permissions on the staged .app
      try {
        child_process.execFileSync('/usr/bin/xattr', ['-cr', stagedAppPath], { stdio: 'ignore' });
      } catch {}
      try {
        child_process.execFileSync('/bin/chmod', ['-R', 'u+rwX', stagedAppPath], { stdio: 'ignore' });
        const macosBinDir = path.join(stagedAppPath, 'Contents', 'MacOS');
        if (fs.existsSync(macosBinDir)) {
          for (const binFile of fs.readdirSync(macosBinDir)) {
            fs.chmodSync(path.join(macosBinDir, binFile), 0o755);
          }
        }
      } catch {}
      try {
        child_process.execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', stagedAppPath], {
          stdio: 'ignore',
        });
      } catch {}

      const destAppPath = getRunningMacAppBundlePath();
      const updaterScriptPath = path.join(tempDir, `budgetapp-updater-${Date.now()}.sh`);

      const updaterScript = [
        '#!/bin/sh',
        "trap '' HUP TERM INT",
        'OLD_PID="$1"',
        'STAGED_APP="$2"',
        'DEST_APP="$3"',
        'STAGING_DIR="$4"',
        'ARCHIVE_FILE="$5"',
        'LOG_FILE="/tmp/budgetapp-updater.log"',
        '',
        'echo "[Updater] Starting update at $(date)" > "$LOG_FILE" 2>/dev/null || true',
        'echo "[Updater] OLD_PID=$OLD_PID STAGED_APP=$STAGED_APP DEST_APP=$DEST_APP" >> "$LOG_FILE" 2>/dev/null || true',
        '',
        '# Wait up to 10 seconds for the current app instance to exit',
        'i=0',
        'while kill -0 "$OLD_PID" 2>/dev/null && [ $i -lt 50 ]; do',
        '  sleep 0.2',
        '  i=$((i + 1))',
        'done',
        'kill -9 "$OLD_PID" 2>/dev/null || true',
        'sleep 0.4',
        '',
        'DEST_DIR="$(dirname "$DEST_APP")"',
        'mkdir -p "$DEST_DIR" 2>/dev/null || true',
        'BACKUP_APP="${DEST_APP}.old-$$"',
        'rm -rf "$BACKUP_APP" 2>/dev/null || true',
        '',
        'if [ -d "$DEST_APP" ]; then',
        '  mv "$DEST_APP" "$BACKUP_APP" 2>>"$LOG_FILE" || rm -rf "$DEST_APP" 2>>"$LOG_FILE" || true',
        'fi',
        '',
        'if /usr/bin/ditto "$STAGED_APP" "$DEST_APP" 2>>"$LOG_FILE"; then',
        '  rm -rf "$BACKUP_APP" 2>/dev/null || true',
        'else',
        '  /usr/bin/osascript -e "do shell script \\"rm -rf \'$DEST_APP\' \'$BACKUP_APP\' && /usr/bin/ditto \'$STAGED_APP\' \'$DEST_APP\' && /usr/bin/xattr -cr \'$DEST_APP\'\\" with administrator privileges" 2>>"$LOG_FILE" || {',
        '    if [ ! -d "$DEST_APP" ] && [ -d "$BACKUP_APP" ]; then',
        '      mv "$BACKUP_APP" "$DEST_APP" 2>/dev/null || true',
        '    fi',
        '  }',
        'fi',
        '',
        '# If user ran from Downloads/Desktop and also has a copy in /Applications, keep /Applications in sync',
        'APPS_COPY="/Applications/BudgetingMacApp.app"',
        'if [ "$DEST_APP" != "$APPS_COPY" ] && [ -d "$APPS_COPY" ]; then',
        '  rm -rf "$APPS_COPY" 2>/dev/null && /usr/bin/ditto "$STAGED_APP" "$APPS_COPY" 2>/dev/null && /usr/bin/xattr -cr "$APPS_COPY" 2>/dev/null || true',
        'fi',
        '',
        '/usr/bin/xattr -cr "$DEST_APP" 2>/dev/null || true',
        '/bin/chmod -R u+rwX "$DEST_APP" 2>/dev/null || true',
        '/bin/chmod +x "$DEST_APP/Contents/MacOS/"* 2>/dev/null || true',
        '/usr/bin/codesign --force --deep --sign - "$DEST_APP" 2>/dev/null || true',
        '/usr/bin/touch "$DEST_APP" 2>/dev/null || true',
        '',
        '# Launch the newly updated application',
        '/usr/bin/open -n "$DEST_APP" >>"$LOG_FILE" 2>&1 || /usr/bin/open "$DEST_APP" >>"$LOG_FILE" 2>&1',
        '',
        'sleep 1',
        'rm -rf "$STAGING_DIR" "$ARCHIVE_FILE" "$BACKUP_APP" "$0" 2>/dev/null || true',
        '',
      ].join('\n');

      fs.writeFileSync(updaterScriptPath, updaterScript, { mode: 0o755 });

      const child = child_process.spawn(
        '/bin/sh',
        [updaterScriptPath, String(process.pid), stagedAppPath, destAppPath, stagingDir, targetFile],
        { detached: true, stdio: 'ignore' }
      );
      child.unref();

      setTimeout(() => {
        app.exit(0);
      }, 900);

      return {
        success: true,
        message:
          'Aggiornamento completato! L\'applicazione viene ora sostituita automaticamente e si riavvierà da sola tra un istante.',
        filePath: destAppPath,
      };
    } else if (process.platform === 'win32') {
      if (ext === '.exe') {
        child_process.spawn(targetFile, [], { detached: true, stdio: 'ignore' }).unref();
        setTimeout(() => {
          app.quit();
        }, 1200);
        return {
          success: true,
          message: 'Installazione avviata! L\'applicazione si chiuderà per completare l\'aggiornamento.',
          filePath: targetFile,
        };
      } else {
        await shell.openPath(targetFile);
        return { success: true, filePath: targetFile };
      }
    } else {
      try {
        fs.chmodSync(targetFile, '755');
      } catch {}
      await shell.openPath(targetFile);
      return {
        success: true,
        message: 'Aggiornamento scaricato con successo.',
        filePath: targetFile,
      };
    }
  } catch (error) {
    console.error('Download/install update error:', error);
    return {
      success: false,
      error: error?.message || 'Errore durante il download o l\'installazione dell\'aggiornamento.',
    };
  }
});

/**
 * Focuses the main window — used when the user clicks a system notification.
 */
function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin' && app.dock && typeof app.dock.show === 'function') {
    app.dock.show();
  }
}

ipcMain.handle('app:send-notification', async (event, payload = {}) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  const { title, body, icon, silent, tag } = payload;

  try {
    const result = await showNativeNotification(Notification, {
      title,
      body,
      icon,
      silent,
      tag,
      onClick: focusMainWindow,
    });

    if (result.delivered) {
      return { success: true, channel: result.channel, reason: result.reason };
    }

    return {
      success: false,
      channel: result.channel,
      reason: result.reason || 'System notifications could not be delivered',
    };
  } catch (err) {
    console.error('Failed to trigger macOS notification:', err);
    return { success: false, channel: 'none', error: err?.message || String(err) };
  }
});

/**
 * Reports which notification channel is usable, so the UI can explain the
 * current state (e.g. "the app is not signed, using the compatibility channel").
 */
ipcMain.handle('app:notification-capability', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  try {
    const probe = await probeNativeNotification(Notification);
    return {
      supported: probe.supported,
      channel: probe.channel,
      bundleId: probe.bundleId,
      appName: APP_DISPLAY_NAME,
      platform: process.platform,
      signed: app.isSigned,
    };
  } catch (err) {
    console.error('Failed to probe notification capability:', err);
    return {
      supported: false,
      channel: 'none',
      bundleId: APP_BUNDLE_ID,
      appName: APP_DISPLAY_NAME,
      platform: process.platform,
      error: err?.message || String(err),
    };
  }
});
