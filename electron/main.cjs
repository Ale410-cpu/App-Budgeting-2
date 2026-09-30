const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const child_process = require('child_process');
const { app, BrowserWindow, ipcMain, nativeImage, shell, session } = require('electron');

const devServerUrl = 'http://127.0.0.1:5173';
const TICKER_REGEX = /^[A-Z0-9.\-^=]{1,20}$/;

function parseSemver(v) {
  if (!v) return [0, 0, 0];
  const cleaned = String(v).replace(/^v/i, '').trim().split('-')[0];
  const parts = cleaned.split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function isNewerVersion(latest, current) {
  const [lMaj, lMin, lPatch] = parseSemver(latest);
  const [cMaj, cMin, cPatch] = parseSemver(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPatch > cPatch;
}

function pickReleaseAsset(assets, platform, arch) {
  if (!Array.isArray(assets) || assets.length === 0) return null;

  if (platform === 'darwin') {
    const isArm = arch === 'arm64';
    const armDmg = assets.find((a) => a.name.endsWith('.dmg') && (a.name.includes('arm64') || a.name.includes('aarch64')));
    const x64Dmg = assets.find((a) => a.name.endsWith('.dmg') && (a.name.includes('x64') || a.name.includes('intel')));
    const anyDmg = assets.find((a) => a.name.endsWith('.dmg'));
    const armZip = assets.find((a) => a.name.endsWith('.zip') && (a.name.includes('arm64') || a.name.includes('mac')));
    const anyZip = assets.find((a) => a.name.endsWith('.zip'));

    if (isArm && armDmg) return armDmg;
    if (!isArm && x64Dmg) return x64Dmg;
    if (anyDmg) return anyDmg;
    if (isArm && armZip) return armZip;
    if (anyZip) return anyZip;
  } else if (platform === 'win32') {
    const exe = assets.find((a) => a.name.endsWith('.exe'));
    const zip = assets.find((a) => a.name.endsWith('.zip'));
    if (exe) return exe;
    if (zip) return zip;
  } else if (platform === 'linux') {
    const appImage = assets.find((a) => a.name.endsWith('.AppImage'));
    const deb = assets.find((a) => a.name.endsWith('.deb'));
    const zip = assets.find((a) => a.name.endsWith('.zip') || a.name.endsWith('.tar.gz'));
    if (appImage) return appImage;
    if (deb) return deb;
    if (zip) return zip;
  }

  return assets[0] || null;
}

function downloadFileWithRedirects(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let totalBytes = 0;
    let receivedBytes = 0;

    function get(currentUrl, redirectCount = 0) {
      if (redirectCount > 8) {
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error('Troppi reindirizzamenti durante il download.'));
      }

      const client = currentUrl.startsWith('https:') ? https : http;
      const parsedUrl = new URL(currentUrl);

      const req = client.get(
        currentUrl,
        {
          headers: {
            'User-Agent': 'BudgetingMacApp-Updater/1.0',
            'Accept': 'application/octet-stream, */*',
          },
        },
        (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            let nextUrl = res.headers.location;
            if (!nextUrl.startsWith('http://') && !nextUrl.startsWith('https://')) {
              nextUrl = new URL(nextUrl, parsedUrl.origin).href;
            }
            res.resume();
            return get(nextUrl, redirectCount + 1);
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

    get(url, 0);
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

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#08111f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 16 },
    icon: appIconInfo.image || appIconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

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
      const parsedUrl = new URL(navigationUrl);
      const parsedDevUrl = new URL(devServerUrl);
      const isDevUrl = parsedUrl.origin === parsedDevUrl.origin;
      const isFileUrl = navigationUrl.startsWith('file://');
      if (!isDevUrl && !isFileUrl) {
        event.preventDefault();
        if (navigationUrl.startsWith('https:') || navigationUrl.startsWith('http:')) {
          shell.openExternal(navigationUrl);
        }
      }
    } catch {
      event.preventDefault();
    }
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
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

  // Enforce Content-Security-Policy & security headers for electron session
  if (session.defaultSession) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://query1.finance.yahoo.com https://api.github.com https://github.com https://objects.githubusercontent.com ws: wss: http://localhost:* http://127.0.0.1:*;"
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

ipcMain.handle('app:ping', (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }
  return {
    ok: true,
    version: app.getVersion(),
    platform: process.platform,
  };
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
        'Pragma': 'no-cache'
      }
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

    // Parse historical data if available to allow trending/charts
    const timestamp = result?.timestamp || [];
    const closePrices = result?.indicators?.quote?.[0]?.close || [];

    const history = timestamp.map((t, index) => {
      const dateStr = new Date(t * 1000).toISOString().split('T')[0];
      return {
        date: dateStr,
        price: closePrices[index],
      };
    }).filter((item) => item.price !== null && item.price !== undefined);

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

ipcMain.handle('app:save-data', async (event, data) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  try {
    const userDataPath = app.getPath('userData');
    const filePath = path.join(userDataPath, 'user-data.json');
    const tempPath = path.join(userDataPath, `user-data-${Date.now()}.tmp`);

    const serialized = JSON.stringify(data, null, 2);
    // Limit maximum payload to 50MB to prevent storage exhaustion attacks
    if (serialized.length > 50 * 1024 * 1024) {
      return { success: false, error: 'Payload exceeds maximum allowed size (50MB)' };
    }

    // Atomic write pattern: write to tmp file first, then atomically rename
    await fs.promises.writeFile(tempPath, serialized, 'utf-8');
    await fs.promises.rename(tempPath, filePath);
    return { success: true };
  } catch (error) {
    console.error('Failed to save user data:', error?.message || error);
    return { success: false, error: 'Errore durante il salvataggio dei dati' };
  }
});

ipcMain.handle('app:load-data', async (event) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  try {
    const userDataPath = app.getPath('userData');
    const filePath = path.join(userDataPath, 'user-data.json');
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Failed to load user data:', error?.message || error);
    return null;
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

ipcMain.handle('app:check-for-updates', async (event, customRepo) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  const repo = (customRepo && typeof customRepo === 'string' && customRepo.trim())
    ? customRepo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '')
    : 'Ale410-cpu/App-Budgeting-2';

  const currentVersion = app.getVersion() || '0.3.0';

  try {
    const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(9000),
      headers: {
        'User-Agent': 'BudgetingMacApp-Updater/1.0',
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (response.status === 404) {
      return {
        updateAvailable: false,
        currentVersion,
        latestVersion: currentVersion,
        message: 'Nessuna release pubblicata trovata su GitHub per questo repository.',
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

    const data = await response.json();
    const tagName = data.tag_name || '';
    const latestVersion = tagName.replace(/^v/i, '');

    const hasUpdate = isNewerVersion(latestVersion, currentVersion);
    const chosenAsset = pickReleaseAsset(data.assets || [], process.platform, process.arch);

    return {
      updateAvailable: hasUpdate,
      currentVersion,
      latestVersion,
      tagName,
      releaseName: data.name || tagName,
      releaseNotes: data.body || 'Nessuna nota di rilascio fornita per questo aggiornamento.',
      publishedAt: data.published_at,
      htmlUrl: data.html_url,
      repo,
      asset: chosenAsset ? {
        name: chosenAsset.name,
        downloadUrl: chosenAsset.browser_download_url,
        size: chosenAsset.size,
        contentType: chosenAsset.content_type,
      } : null,
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

ipcMain.handle('app:download-and-install-update', async (event, { downloadUrl, assetName }) => {
  if (!validateIpcSender(event)) {
    throw new Error('Unauthorized IPC sender');
  }

  if (!downloadUrl || typeof downloadUrl !== 'string') {
    throw new Error('downloadUrl è richiesto');
  }

  const safeAssetName = (assetName && typeof assetName === 'string')
    ? path.basename(assetName)
    : `BudgetingMacApp-update-${Date.now()}.dmg`;

  const tempDir = app.getPath('temp');
  const targetFile = path.join(tempDir, safeAssetName);

  try {
    // Scarica il file con avanzamento in streaming
    await downloadFileWithRedirects(downloadUrl, targetFile, (progress) => {
      try {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('app:update-progress', progress);
        }
      } catch (err) {
        // Ignora sender chiuso
      }
    });

    const ext = path.extname(targetFile).toLowerCase();

    if (process.platform === 'darwin') {
      if (ext === '.dmg') {
        // Apre automaticamente il DMG: macOS monterà l'immagine disco e mostrerà la finestra con l'app
        await shell.openPath(targetFile);
        return {
          success: true,
          message: 'L\'aggiornamento è stato scaricato e aperto con successo. Trascina l\'applicazione nella cartella Applicazioni per completare l\'aggiornamento.',
          filePath: targetFile,
        };
      } else if (ext === '.zip') {
        shell.showItemInFolder(targetFile);
        return {
          success: true,
          message: 'Pacchetto ZIP scaricato nella cartella temporanea ed evidenziato nel Finder.',
          filePath: targetFile,
        };
      } else {
        await shell.openPath(targetFile);
        return {
          success: true,
          message: 'File di aggiornamento scaricato con successo.',
          filePath: targetFile,
        };
      }
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
      // Linux
      try {
        fs.chmodSync(targetFile, '755');
      } catch (e) {}
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