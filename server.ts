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
    const rawRepo = typeof req.query.repo === 'string' && req.query.repo.trim()
      ? req.query.repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '')
      : 'Ale410-cpu/App-Budgeting-2';

    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(rawRepo)) {
      return res.status(400).json({ error: 'Formato repository non valido. Usa "owner/repo"' });
    }

    try {
      const response = await fetch(`https://api.github.com/repos/${rawRepo}/releases/latest`, {
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': 'BudgetingMacApp-WebUpdater/1.0',
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (response.status === 404) {
        return res.json({
          updateAvailable: false,
          currentVersion: APP_VERSION,
          latestVersion: APP_VERSION,
          message: 'Nessuna release pubblica trovata su GitHub.',
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

      const data = (await response.json()) as any;
      const tagName = data.tag_name || '';
      const latestVersion = tagName.replace(/^v/i, '');
      const currentVersion = APP_VERSION;

      const parseSemver = (v: string) => {
        const cleaned = v.replace(/^v/i, '').trim().split('-')[0];
        const parts = cleaned.split('.').map((n) => parseInt(n, 10) || 0);
        while (parts.length < 3) parts.push(0);
        return parts;
      };

      const [lMaj, lMin, lPatch] = parseSemver(latestVersion);
      const [cMaj, cMin, cPatch] = parseSemver(currentVersion);
      const hasUpdate =
        lMaj > cMaj ||
        (lMaj === cMaj && lMin > cMin) ||
        (lMaj === cMaj && lMin === cMin && lPatch > cPatch);

      const assets = Array.isArray(data.assets) ? data.assets : [];
      const dmgAsset = assets.find((a: any) => a.name?.endsWith('.dmg'));
      const zipAsset = assets.find((a: any) => a.name?.endsWith('.zip'));
      const exeAsset = assets.find((a: any) => a.name?.endsWith('.exe'));
      const chosenAsset = dmgAsset || zipAsset || exeAsset || assets[0] || null;

      res.json({
        updateAvailable: hasUpdate,
        currentVersion,
        latestVersion,
        tagName,
        releaseName: data.name || tagName,
        releaseNotes: data.body || 'Nessuna nota di rilascio fornita.',
        publishedAt: data.published_at,
        htmlUrl: data.html_url,
        repo: rawRepo,
        asset: chosenAsset
          ? {
              name: chosenAsset.name,
              downloadUrl: chosenAsset.browser_download_url,
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
