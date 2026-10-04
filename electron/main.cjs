const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const child_process = require('child_process');
const { app, BrowserWindow, ipcMain, nativeImage, shell, session, dialog } = require('electron');

// Enable GPU hardware acceleration and smooth compositing for macOS Metal & 60/120Hz displays
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// Ensure consistent application name for data paths across sessions
app.setName('BudgetingMacApp');

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
  if (frameUrl.startsWith('file://')) return true;
  try {
    const parsed = new URL(frameUrl);
    const parsedDev = new URL(devServerUrl);
    return parsed.origin === parsedDev.origin;
  } catch {
    return false;
  }
}

function getAppIcon() {
  const possiblePaths = [
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '../build/icon.png'),
    path.join(__dirname, '../public/icon.png'),
    path.join(__dirname, '../src/renderer/assets/icon.png'),
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

function getAllCandidatePaths() {
  const home = app.getPath('home') || process.env.HOME || '';
  const documentsDir = getPrimaryDocumentsDir();
  const primaryFile = path.join(documentsDir, 'user-data.json');
  const userData = app.getPath('userData');

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

  // 1. Stored custom path
  try {
    const customRecord = getCustomPathRecordFile();
    if (fs.existsSync(customRecord)) {
      const recorded = fs.readFileSync(customRecord, 'utf-8').trim();
      if (recorded && fs.existsSync(recorded)) {
        list.push(recorded);
      }
    }
  } catch {}

  // 2. File opened on startup (drag and drop / open-file / argv)
  if (fileOpenedOnStartup && fs.existsSync(fileOpenedOnStartup)) {
    list.push(fileOpenedOnStartup);
  }

  // 3. Primary shared Documents folder (visible & permanent)
  list.push(primaryFile);
  list.push(path.join(documentsDir, 'budget-data.json'));

  // 4. Standard macOS Application Support folders (all variants across sessions)
  list.push(path.join(userData, 'user-data.json'));
  list.push(path.join(appData, 'BudgetingMacApp', 'user-data.json'));
  list.push(path.join(appData, 'budgeting-mac-app', 'user-data.json'));
  list.push(path.join(appData, 'com.budgeting.macapp', 'user-data.json'));
  list.push(path.join(appData, 'Electron', 'user-data.json'));

  // 5. User Documents root
  const baseDocDir = path.dirname(documentsDir);
  list.push(path.join(baseDocDir, 'user-data.json'));
  list.push(path.join(baseDocDir, 'budget-data.json'));

  // 6. Desktop & Downloads
  if (desktop) list.push(path.join(desktop, 'user-data.json'));
  if (downloads) list.push(path.join(downloads, 'user-data.json'));

  // 7. Working directory
  list.push(path.join(process.cwd(), 'user-data.json'));

  return Array.from(new Set(list));
}

function findBestDataFile() {
  const candidates = getAllCandidatePaths();
  let bestCandidate = null;
  let bestMtime = -1;
  let bestData = null;

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const stat = fs.statSync(candidate);
      if (!stat.isFile() || stat.size < 2) continue;

      const raw = fs.readFileSync(candidate, 'utf-8');
      const parsed = JSON.parse(raw);

      // Check if it looks like budgeting app data
      const hasContent =
        Array.isArray(parsed?.transactions) ||
        Array.isArray(parsed?.assets) ||
        Array.isArray(parsed?.budgetCategories) ||
        parsed?.openingNetWorth !== undefined;

      if (hasContent) {
        if (stat.mtimeMs > bestMtime) {
          bestMtime = stat.mtimeMs;
          bestCandidate = candidate;
          bestData = parsed;
        }
      }
    } catch {
      // Ignore unparseable or inaccessible candidates
    }
  }

  const primaryDir = getPrimaryDocumentsDir();
  const defaultPath = path.join(primaryDir, 'user-data.json');

  if (bestCandidate) {
    return { filePath: bestCandidate, data: bestData };
  }

  return { filePath: defaultPath, data: null };
}

let lastWrittenHash = '';

async function safeWriteJson(targetPath, data) {
  isWritingData = true;
  const dir = path.dirname(targetPath);
  await fs.promises.mkdir(dir, { recursive: true });

  const tempPath = path.join(dir, `.user-data-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.tmp`);
  const serialized = JSON.stringify(data, null, 2);
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

  // Watch for external modifications (other app opened, another session, user edits)
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

      const parsed = JSON.parse(content);

      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send('app:data-updated-on-disk', parsed);
      }
    } catch (err) {
      console.error('Error reading updated data file:', err);
    }
  });
}

function switchActiveDataFile(newPath, broadcast = false) {
  activeDataFilePath = newPath;
  setupDataFileWatcher(newPath);

  try {
    fs.writeFileSync(getCustomPathRecordFile(), newPath, 'utf-8');
  } catch {}

  if (broadcast && mainWindow && !mainWindow.isDestroyed()) {
    try {
      const content = fs.readFileSync(newPath, 'utf-8');
      const parsed = JSON.parse(content);
      mainWindow.webContents.send('app:data-updated-on-disk', parsed);
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
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
    if (!activeDataFilePath) {
      const primaryDir = getPrimaryDocumentsDir();
      activeDataFilePath = path.join(primaryDir, 'user-data.json');
    }

    // Limit maximum payload to 50MB
    const serialized = JSON.stringify(data);
    if (serialized.length > 50 * 1024 * 1024) {
      return { success: false, error: 'Payload exceeds maximum allowed size (50MB)' };
    }

    // 1. Write to active path
    await safeWriteJson(activeDataFilePath, data);

    // 2. Mirror to Documents/BudgetingMacApp/user-data.json if active is different
    const primaryDir = getPrimaryDocumentsDir();
    const primaryPath = path.join(primaryDir, 'user-data.json');
    if (activeDataFilePath !== primaryPath) {
      try {
        await safeWriteJson(primaryPath, data);
      } catch {}
    }

    // 3. Mirror to app.getPath('userData')/user-data.json for internal redundancy
    const internalPath = path.join(app.getPath('userData'), 'user-data.json');
    if (activeDataFilePath !== internalPath && primaryPath !== internalPath) {
      try {
        await safeWriteJson(internalPath, data);
      } catch {}
    }

    return { success: true };
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
    const exists = Boolean(activeDataFilePath && fs.existsSync(activeDataFilePath));
    let size = 0;
    let lastModified = 0;

    if (exists) {
      const stat = fs.statSync(activeDataFilePath);
      size = stat.size;
      lastModified = stat.mtimeMs;
    }

    return {
      filePath: activeDataFilePath || path.join(getPrimaryDocumentsDir(), 'user-data.json'),
      exists,
      size,
      lastModified,
      candidates: getAllCandidatePaths().filter((p) => fs.existsSync(p)),
    };
  } catch (err) {
    return {
      filePath: activeDataFilePath || '',
      exists: false,
      size: 0,
      lastModified: 0,
      candidates: [],
    };
  }
});

ipcMain.handle('app:select-data-file', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleziona il file dei tuoi dati registrati',
    defaultPath: activeDataFilePath ? path.dirname(activeDataFilePath) : getPrimaryDocumentsDir(),
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
    const content = await fs.promises.readFile(selectedPath, 'utf-8');
    const parsed = JSON.parse(content);

    switchActiveDataFile(selectedPath, true);

    return {
      success: true,
      filePath: selectedPath,
      data: parsed,
    };
  } catch (error) {
    return {
      success: false,
      error: `Impossibile leggere il file selezionato: ${error?.message || 'formato non valido'}`,
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

  const currentVersion = app.getVersion() || '0.3.4';
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
