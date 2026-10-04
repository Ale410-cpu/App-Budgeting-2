import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { APP_VERSION } from './src/version';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Disable technology disclosure header
  app.disable('x-powered-by');

  app.use(express.json({ limit: '1mb' }));

  // Security headers & Content Security Policy
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; connect-src 'self' https://query1.finance.yahoo.com ws: wss:; frame-ancestors 'self' *;"
    );
    next();
  });

  const ALLOWED_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'ytd', 'max']);
  const TICKER_REGEX = /^[A-Z0-9.\-^=]{1,20}$/;

  // In-memory cache to prevent redundant outbound requests & API throttling
  interface CacheEntry {
    data: any;
    expiresAt: number;
  }
  const tickerCache = new Map<string, CacheEntry>();

  // In-memory sliding window rate limiter
  interface RateLimitRecord {
    count: number;
    resetAt: number;
  }
  const rateLimitMap = new Map<string, RateLimitRecord>();
  const RATE_LIMIT_WINDOW_MS = 60 * 1000;
  const RATE_LIMIT_MAX_REQUESTS = 60;

  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const record = rateLimitMap.get(ip);
    if (!record || now > record.resetAt) {
      rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }
    if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }
    record.count += 1;
    return true;
  }

  // Periodic cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of tickerCache.entries()) {
      if (now > entry.expiresAt) {
        tickerCache.delete(key);
      }
    }
    for (const [ip, record] of rateLimitMap.entries()) {
      if (now > record.resetAt) {
        rateLimitMap.delete(ip);
      }
    }
  }, 5 * 60 * 1000);

  // API route for fetching stock/crypto price
  app.get('/api/ticker-price', async (req, res) => {
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return res.status(429).json({ error: 'Troppe richieste: riprova tra un minuto.' });
    }

    const { ticker } = req.query;
    if (!ticker || typeof ticker !== 'string') {
      return res.status(400).json({ error: 'Ticker is required' });
    }

    const tickerClean = ticker.trim().toUpperCase();
    if (!TICKER_REGEX.test(tickerClean)) {
      return res.status(400).json({ error: 'Invalid ticker symbol format' });
    }

    try {
      const { range } = req.query;
      const rawRange = typeof range === 'string' && range.trim() ? range.trim().toLowerCase() : '5y';
      const queryRange = ALLOWED_RANGES.has(rawRange) ? rawRange : '5y';

      const cacheKey = `${tickerClean}:${queryRange}`;
      const cached = tickerCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return res.json(cached.data);
      }

      // Fetch data from Yahoo Finance chart endpoint with timeout protection
      const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tickerClean)}?range=${encodeURIComponent(queryRange)}&interval=1d`;
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
        return res.status(response.status).json({ error: `Yahoo Finance returned status ${response.status}` });
      }
      
      const data = (await response.json()) as any;
      const result = data?.chart?.result?.[0];
      const meta = result?.meta;
      
      if (!meta) {
        return res.status(404).json({ error: 'Ticker not found or no metadata available' });
      }
      
      const price = meta.regularMarketPrice;
      const previousClose = meta.chartPreviousClose;
      const currency = meta.currency || 'USD';
      const symbol = meta.symbol || tickerClean;
      const longName = meta.longName || symbol;
      
      // Parse historical data if available to allow trending/charts
      const timestamp = result?.timestamp || [];
      const closePrices = result?.indicators?.quote?.[0]?.close || [];
      
      const history = timestamp.map((t: number, index: number) => {
        const dateStr = new Date(t * 1000).toISOString().split('T')[0];
        return {
          date: dateStr,
          price: closePrices[index],
        };
      }).filter((item: any) => item.price !== null && item.price !== undefined);

      const payload = {
        price,
        previousClose,
        currency,
        symbol,
        longName,
        history,
      };

      // Cache for 60 seconds
      tickerCache.set(cacheKey, { data: payload, expiresAt: Date.now() + 60 * 1000 });

      res.json(payload);
    } catch (err: any) {
      console.error('Error in /api/ticker-price:', err?.message || err);
      res.status(500).json({ error: 'Impossibile recuperare i dati finanziari del ticker selezionato' });
    }
  });

  // API route for checking GitHub updates (web fallback)
  app.get('/api/check-update', async (req, res) => {
    const defaultRepo = (process.env.GITHUB_REPO || 'Ale410-cpu/App-Budgeting-2').replace('App-Budegting-2', 'App-Budgeting-2');
    let rawInput = typeof req.query.repo === 'string' && req.query.repo.trim() ? req.query.repo.trim() : defaultRepo;
    rawInput = rawInput
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace('App-Budegting-2', 'App-Budgeting-2');

    const repoMatch = rawInput.match(/^([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
    const rawRepo =
      repoMatch && !repoMatch[1].includes('sole31012002')
        ? repoMatch[1]
        : defaultRepo;

    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(rawRepo)) {
      return res.status(400).json({ error: 'Formato repository non valido. Usa "owner/repo"' });
    }

    const customToken =
      (typeof req.query.token === 'string' && req.query.token.trim()) ||
      (typeof req.headers['x-github-token'] === 'string' && req.headers['x-github-token'].trim()) ||
      process.env.GITHUB_TOKEN ||
      '';

    const parseSemver = (v: string): number[] => {
      if (!v) return [0, 0, 0];
      const match = String(v).match(/(\d+(?:\.\d+)+)/);
      const target = match ? match[1] : String(v).replace(/^v/i, '').trim().split('-')[0];
      const parts = target.split('.').map((n) => parseInt(n, 10) || 0);
      while (parts.length < 3) parts.push(0);
      return parts;
    };

    const compareSemver = (a: string, b: string): number => {
      const pa = parseSemver(a);
      const pb = parseSemver(b);
      const len = Math.max(pa.length, pb.length);
      for (let i = 0; i < len; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na !== nb) return na > nb ? 1 : -1;
      }
      return 0;
    };

    const extractVersionsFromText = (text?: string | null): string[] => {
      if (!text || typeof text !== 'string') return [];
      const matches: string[] = [];
      const regex = /(?:^|[^0-9.])v?(\d+\.\d+(?:\.\d+){0,2})(?![0-9.])/gi;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        if (m[1]) matches.push(m[1]);
      }
      return matches;
    };

    const extractBestVersionFromRelease = (rel: any): string => {
      const candidates: string[] = [];
      candidates.push(...extractVersionsFromText(rel?.tag_name));
      candidates.push(...extractVersionsFromText(rel?.name));
      if (Array.isArray(rel?.assets)) {
        for (const asset of rel.assets) {
          candidates.push(...extractVersionsFromText(asset?.name));
        }
      }
      if (typeof rel?.body === 'string') {
        candidates.push(...extractVersionsFromText(rel.body.slice(0, 300)));
      }
      if (candidates.length === 0) {
        return String(rel?.tag_name || rel?.name || '0.0.0').replace(/^v/i, '').trim();
      }
      candidates.sort((a, b) => compareSemver(b, a));
      return candidates[0];
    };

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'BudgetingMacApp-WebUpdater/1.0',
        'Accept': 'application/vnd.github.v3+json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      };
      if (customToken) {
        headers['Authorization'] = `token ${customToken}`;
      }

      let response = await fetch(`https://api.github.com/repos/${rawRepo}/releases?per_page=30&_t=${Date.now()}`, {
        signal: AbortSignal.timeout(9000),
        headers,
      });

      // Fallback without token if user provided an invalid custom token on a public repo
      if ((response.status === 401 || response.status === 403) && customToken) {
        const publicHeaders = { ...headers };
        delete publicHeaders['Authorization'];
        response = await fetch(`https://api.github.com/repos/${rawRepo}/releases?per_page=30&_t=${Date.now()}`, {
          signal: AbortSignal.timeout(9000),
          headers: publicHeaders,
        });
      }

      if (response.status === 404) {
        return res.json({
          updateAvailable: false,
          currentVersion: APP_VERSION,
          latestVersion: APP_VERSION,
          message: customToken
            ? `Repository "${rawRepo}" non trovato su GitHub (404). Verifica il nome "proprietario/repository".`
            : `Repository "${rawRepo}" non trovato o privato (404). Se la repository su GitHub è privata, rendila Pubblica nelle impostazioni di GitHub (Settings → Change visibility → Public) oppure inserisci un Token GitHub (PAT).`,
          repo: rawRepo,
        });
      }

      if (!response.ok) {
        return res.status(response.status).json({
          updateAvailable: false,
          error: `GitHub ha risposto con codice ${response.status}`,
          repo: rawRepo,
        });
      }

      const releasesList = (await response.json()) as any[];
      let validReleases = Array.isArray(releasesList)
        ? releasesList.filter((r) => !r.draft)
        : [];
      if (validReleases.length === 0 && Array.isArray(releasesList) && releasesList.length > 0) {
        validReleases = releasesList;
      }

      // If no releases exist, check tags as fallback
      if (validReleases.length === 0) {
        const tagsResp = await fetch(`https://api.github.com/repos/${rawRepo}/tags?per_page=20&_t=${Date.now()}`, {
          signal: AbortSignal.timeout(8000),
          headers,
        });
        if (tagsResp.ok) {
          const tagsList = (await tagsResp.json()) as any[];
          if (Array.isArray(tagsList) && tagsList.length > 0) {
            validReleases = tagsList.map((t) => ({
              tag_name: t.name,
              name: t.name,
              body: 'Tag pubblicato su GitHub.',
              html_url: `https://github.com/${rawRepo}/releases/tag/${t.name}`,
              assets: [],
            }));
          }
        }
      }

      if (validReleases.length === 0) {
        return res.json({
          updateAvailable: false,
          currentVersion: APP_VERSION,
          latestVersion: APP_VERSION,
          message: `Nessuna release o versione pubblicata trovata nel repository "${rawRepo}".`,
          repo: rawRepo,
        });
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
      const currentVersion = APP_VERSION;
      const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

      const rawAssets = Array.isArray(data.assets) ? [...data.assets] : [];
      // Sort assets so those matching latestVersion or newest upload come first
      rawAssets.sort((a: any, b: any) => {
        const aHasVer = a.name?.includes(latestVersion) ? 1 : 0;
        const bHasVer = b.name?.includes(latestVersion) ? 1 : 0;
        if (aHasVer !== bHasVer) return bHasVer - aHasVer;
        const tA = new Date(a.updated_at || a.created_at || 0).getTime() || 0;
        const tB = new Date(b.updated_at || b.created_at || 0).getTime() || 0;
        return tB - tA;
      });

      const mainInstallers = rawAssets.filter(
        (a: any) =>
          a.name &&
          !a.name.endsWith('.command') &&
          !a.name.endsWith('.sh') &&
          !a.name.endsWith('.txt') &&
          !a.name.endsWith('.md') &&
          !a.name.endsWith('.blockmap') &&
          !a.name.endsWith('.yml')
      );
      const pool = mainInstallers.length > 0 ? mainInstallers : rawAssets;
      const dmgAsset = pool.find((a: any) => a.name?.endsWith('.dmg'));
      const zipAsset = pool.find((a: any) => a.name?.endsWith('.zip') || a.name?.includes('.zip.part_'));
      const exeAsset = pool.find((a: any) => a.name?.endsWith('.exe'));
      const ipaAsset = pool.find((a: any) => a.name?.endsWith('.ipa'));
      const chosenAsset = dmgAsset || zipAsset || exeAsset || ipaAsset || pool[0] || null;

      res.json({
        updateAvailable: hasUpdate,
        currentVersion,
        latestVersion,
        tagName,
        releaseName: data.name || tagName,
        releaseNotes: data.body || 'Nessuna nota di rilascio fornita.',
        publishedAt: data.updated_at || data.published_at || data.created_at,
        htmlUrl: data.html_url || `https://github.com/${rawRepo}/releases`,
        isPrerelease: Boolean(data.prerelease),
        repo: rawRepo,
        asset: chosenAsset
          ? {
              name: chosenAsset.name,
              downloadUrl: chosenAsset.browser_download_url,
              apiUrl: chosenAsset.url,
              size: chosenAsset.size,
              contentType: chosenAsset.content_type,
            }
          : null,
      });
    } catch (err: any) {
      console.error('Error in /api/check-update:', err?.message || err);
      res.status(500).json({ error: 'Impossibile verificare gli aggiornamenti su GitHub.' });
    }
  });

  // Direct download endpoint for the AltStore-compatible iOS .ipa package
  app.get('/api/download-ipa', async (_req, res) => {
    try {
      const distIosDir = path.join(process.cwd(), 'dist-ios');
      const versionedIpa = path.join(distIosDir, `BudgetApp-${APP_VERSION}.ipa`);
      const latestIpa = path.join(distIosDir, 'BudgetApp-latest.ipa');

      let targetIpa = fs.existsSync(versionedIpa)
        ? versionedIpa
        : fs.existsSync(latestIpa)
          ? latestIpa
          : '';

      if (!targetIpa) {
        const { buildIpa } = await import('./scripts/build-ipa.cjs');
        targetIpa = await buildIpa();
      }

      if (!targetIpa || !fs.existsSync(targetIpa)) {
        return res.status(404).json({ error: 'Pacchetto IPA non trovato.' });
      }

      const fileName = `BudgetApp-${APP_VERSION}.ipa`;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      fs.createReadStream(targetIpa).pipe(res);
    } catch (err: any) {
      console.error('Error in /api/download-ipa:', err?.message || err);
      res.status(500).json({ error: 'Impossibile generare o scaricare il pacchetto IPA.' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
