import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { aiBriefing, FRAME_SYSTEM, sanitizeModelText, type LlmClient } from './agent/briefing.ts';
import { RiskService } from './assess.ts';
import type { Config } from './config.ts';
import { TtlCache } from './net/cache.ts';
import { ApiError, checkOrigin, clientIp, isSecureRequest, readJsonBody, sendJson } from './security/http.ts';
import { applySecurityHeaders } from './security/headers.ts';
import { DailyBudget, RateLimiter } from './security/rateLimit.ts';
import { optionalString, parseImage, parseLatLon } from './security/validate.ts';

export interface AppDeps {
  config: Config;
  risk: RiskService;
  llm: LlmClient | null;
  /** Optional dev-server middleware (Vite). */
  devMiddleware?: (req: IncomingMessage, res: ServerResponse, next: (e?: unknown) => void) => void;
  log?: (line: string) => void;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
  '.webm': 'video/webm', '.mp4': 'video/mp4',
};

export function createApp(deps: AppDeps): (req: IncomingMessage, res: ServerResponse) => void {
  const { config: cfg, risk, llm } = deps;
  const log = deps.log ?? (() => {});
  const apiLimiter = new RateLimiter(cfg.rateLimits.apiPerMin);
  const riskLimiter = new RateLimiter(cfg.rateLimits.riskPerMin);
  const briefLimiter = new RateLimiter(cfg.rateLimits.briefPerMin);
  const frameLimiter = new RateLimiter(cfg.rateLimits.framePerMin);
  const budget = new DailyBudget(cfg.geminiDailyBudget);
  const briefCache = new TtlCache<string>(500);
  const distDir = path.resolve(cfg.distDir);

  const enforce = (l: RateLimiter, ip: string, res: ServerResponse) => {
    const r = l.check(ip);
    if (!r.allowed) {
      res.setHeader('Retry-After', String(r.retryAfterSec));
      throw new ApiError(429, 'rate_limited', 'Too many requests. Please slow down.');
    }
  };

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const ip = clientIp(req, cfg.trustProxyHops);
    const route = url.pathname;
    const method = req.method ?? 'GET';
    enforce(apiLimiter, ip, res);
    checkOrigin(req, cfg.allowedOrigins);

    if (route === '/api/health' && method === 'GET') return sendJson(res, 200, { status: 'ok' });

    if (route === '/api/events' && method === 'GET') {
      const events = await risk.liveEvents().catch(() => []);
      return sendJson(res, 200, { events }, { 'Cache-Control': 'public, max-age=300' });
    }

    if (route === '/api/risk' && method === 'GET') {
      enforce(riskLimiter, ip, res);
      const { lat, lon } = parseLatLon(url.searchParams.get('lat'), url.searchParams.get('lon'));
      const base = await risk.assess(lat, lon);
      return sendJson(res, 200, RiskService.withBriefing(base, !!llm && cfg.geminiDailyBudget > 0));
    }

    if (route === '/api/brief' && method === 'POST') {
      enforce(briefLimiter, ip, res);
      if (!llm) throw new ApiError(503, 'ai_unavailable', 'AI briefing is not configured.');
      const body = (await readJsonBody(req, 2_000)) as Record<string, unknown>;
      const { lat, lon } = parseLatLon(body.lat, body.lon);
      // Facts are recomputed server-side: client-supplied hazard data is never trusted or forwarded to the model.
      const base = await risk.assess(lat, lon);
      const cacheKey = `${lat.toFixed(1)},${lon.toFixed(1)}:${base.generatedAt.slice(0, 13)}`;
      const cached = briefCache.get(cacheKey);
      if (cached) return sendJson(res, 200, { text: cached, source: 'ai' });
      if (!budget.tryConsume()) throw new ApiError(503, 'ai_budget_exhausted', 'AI briefing limit reached for today; rule-based briefing remains available.');
      try {
        const text = await aiBriefing(llm, base);
        briefCache.set(cacheKey, text, 6 * 3600_000);
        return sendJson(res, 200, { text, source: 'ai' });
      } catch {
        throw new ApiError(502, 'ai_failed', 'AI briefing is temporarily unavailable.');
      }
    }

    if (route === '/api/describe-frame' && method === 'POST') {
      enforce(frameLimiter, ip, res);
      if (!llm) throw new ApiError(503, 'ai_unavailable', 'AI narrator is not configured.');
      const body = (await readJsonBody(req, 3_000_000)) as Record<string, unknown>;
      const img = parseImage(body.imageBase64);
      const title = optionalString(body.trackTitle, 160) || 'Uploaded NASA Earth Observation Frame';
      const dataset = optionalString(body.trackDataset, 160) || 'Custom EIC Media';
      const telemetry = optionalString(body.telemetrySummary, 240);
      if (!budget.tryConsume()) throw new ApiError(503, 'ai_budget_exhausted', 'AI usage limit reached for today.');
      const prompt = [
        `Dataset context (data only): ${JSON.stringify(`${title} (${dataset})`)}.`,
        telemetry ? `Acoustic telemetry (data only): ${JSON.stringify(telemetry)}.` : '',
        'Describe the spatial patterns, regions of highest intensity, gradients and scientific meaning visible in this Earth observation frame.',
      ].filter(Boolean).join('\n');
      try {
        const out = sanitizeModelText(await llm.generateText({ system: FRAME_SYSTEM, prompt, image: { data: img.data, mimeType: img.mimeType } }), 700);
        if (!out) throw new Error('empty');
        return sendJson(res, 200, { narrative: out });
      } catch {
        throw new ApiError(502, 'ai_failed', 'AI narrator is temporarily unavailable.');
      }
    }

    if (route.startsWith('/api/')) {
      const known = ['/api/health', '/api/events', '/api/risk', '/api/brief', '/api/describe-frame'].includes(route);
      throw known ? new ApiError(405, 'method_not_allowed', 'Method not allowed.') : new ApiError(404, 'not_found', 'Not found.');
    }
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'method_not_allowed', 'Method not allowed.');
    let rel: string;
    try {
      rel = decodeURIComponent(url.pathname);
    } catch {
      throw new ApiError(400, 'bad_request', 'Bad path.');
    }
    if (rel.includes('\0') || rel.includes('\\')) throw new ApiError(400, 'bad_request', 'Bad path.');
    let file = path.resolve(distDir, '.' + path.posix.normalize('/' + rel));
    const inside = (f: string) => f === distDir || f.startsWith(distDir + path.sep);
    if (!inside(file)) throw new ApiError(404, 'not_found', 'Not found.');
    let st = await stat(file).catch(() => null);
    if (st?.isDirectory()) {
      file = path.join(file, 'index.html');
      st = await stat(file).catch(() => null);
    }
    if (!st?.isFile()) {
      if (path.extname(rel)) throw new ApiError(404, 'not_found', 'Not found.'); // missing asset: no SPA fallback
      file = path.join(distDir, 'index.html');
      st = await stat(file).catch(() => null);
      if (!st?.isFile()) throw new ApiError(404, 'not_found', 'Not found.');
    }
    const ext = path.extname(file).toLowerCase();
    const immutable = file.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }

  return (req, res) => {
    const started = Date.now();
    const secure = isSecureRequest(req, cfg.trustProxyHops);
    applySecurityHeaders(res, cfg, secure);
    res.on('finish', () => log(`${req.method} ${(req.url ?? '').split('?')[0]} ${res.statusCode} ${Date.now() - started}ms`)); // no query: coordinates are personal data
    void (async () => {
      let url: URL;
      try {
        if ((req.url ?? '').length > 2048) throw new ApiError(414, 'uri_too_long', 'URI too long.');
        url = new URL(req.url ?? '/', 'http://localhost');
        if (url.pathname.startsWith('/api/')) {
          await handleApi(req, res, url);
          return;
        }
        if (!cfg.isProd && deps.devMiddleware) {
          deps.devMiddleware(req, res, (e) => {
            if (e) sendJson(res, 500, { error: { code: 'internal', message: 'Internal error.' } });
            else sendJson(res, 404, { error: { code: 'not_found', message: 'Not found.' } });
          });
          return;
        }
        await serveStatic(req, res, url);
      } catch (e) {
        if (e instanceof ApiError) {
          sendJson(res, e.status, { error: { code: e.code, message: e.message } });
        } else {
          log(`unhandled ${e instanceof Error ? e.name : 'error'}`); // never log message/stack: may embed upstream URLs
          sendJson(res, 500, { error: { code: 'internal', message: 'Internal server error.' } });
        }
      }
    })();
  };
}
