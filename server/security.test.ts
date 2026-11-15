import test from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, DailyBudget } from './security/rateLimit.ts';
import { parseLatLon, parseImage } from './security/validate.ts';
import { checkOrigin, clientIp, ApiError } from './security/http.ts';
import { TtlCache } from './net/cache.ts';
import { UpstreamClient, UpstreamError } from './net/upstream.ts';
import { loadConfig, describeConfig } from './config.ts';
import { buildCsp } from './security/headers.ts';
import { sanitizeModelText } from './agent/briefing.ts';

test('parseLatLon accepts valid, rounds to 2dp, rejects junk', () => {
  assert.deepEqual(parseLatLon('33.68421', '73.04791'), { lat: 33.68, lon: 73.05 });
  assert.deepEqual(parseLatLon(-0.001, 0), { lat: 0, lon: 0 });
  for (const bad of [['91', '0'], ['0', '181'], ['abc', '1'], ['1e2', '1'], ['0x10', '1'], ['NaN', '1'], ['', '1'], [null, 1], ['1', undefined], ['1;DROP', '2'], [Infinity, 0]]) {
    assert.throws(() => parseLatLon(bad[0], bad[1]), (e: unknown) => e instanceof ApiError && e.status === 400, JSON.stringify(bad));
  }
});

test('parseImage verifies magic bytes and size', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50)]).toString('base64');
  assert.equal(parseImage(`data:image/jpeg;base64,${jpeg}`).mimeType, 'image/jpeg');
  assert.throws(() => parseImage(Buffer.from('<svg onload=alert(1)>').toString('base64')), ApiError);
  assert.throws(() => parseImage('not base64!!'), ApiError);
  assert.throws(() => parseImage('A'.repeat(3_000_000)), (e: unknown) => e instanceof ApiError && e.status === 413);
});

test('RateLimiter windows, retry-after and bounded memory', () => {
  let t = 0;
  const rl = new RateLimiter(3, 1000, 5, () => t);
  assert.ok(rl.check('a').allowed && rl.check('a').allowed && rl.check('a').allowed);
  const blocked = rl.check('a');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1);
  t = 1001;
  assert.ok(rl.check('a').allowed);
  for (let i = 0; i < 100; i++) rl.check('k' + i); // attacker floods keys
  assert.ok(((rl as unknown as { hits: Map<string, unknown> }).hits.size) <= 5);
});

test('DailyBudget resets at UTC midnight', () => {
  let t = Date.UTC(2026, 0, 1, 23, 0);
  const b = new DailyBudget(2, () => t);
  assert.ok(b.tryConsume() && b.tryConsume());
  assert.equal(b.tryConsume(), false);
  t = Date.UTC(2026, 0, 2, 0, 1);
  assert.ok(b.tryConsume());
});

test('TtlCache dedupes in-flight loads, expires, and negative-caches failures', async () => {
  let t = 0;
  const c = new TtlCache<number>(10, () => t);
  let calls = 0;
  const load = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return 7; };
  const [x, y] = await Promise.all([c.getOrLoad('k', 100, load), c.getOrLoad('k', 100, load)]);
  assert.equal(x + y, 14);
  assert.equal(calls, 1);
  t = 101;
  await c.getOrLoad('k', 100, load);
  assert.equal(calls, 2);
  let fails = 0;
  const bad = async () => { fails++; throw new Error('x'); };
  await assert.rejects(c.getOrLoad('f', 100, bad, 50));
  await assert.rejects(c.getOrLoad('f', 100, bad, 50));
  assert.equal(fails, 1);
});

test('checkOrigin blocks cross-site, allows same-origin and listed origins', () => {
  const req = (h: Record<string, string>) => ({ headers: h }) as never;
  assert.doesNotThrow(() => checkOrigin(req({ host: 'a.com', origin: 'https://a.com' }), []));
  assert.doesNotThrow(() => checkOrigin(req({ host: 'a.com', 'sec-fetch-site': 'same-origin' }), []));
  assert.doesNotThrow(() => checkOrigin(req({ host: 'a.com' }), []));
  assert.doesNotThrow(() => checkOrigin(req({ host: 'x', origin: 'https://ok.example' }), ['https://ok.example']));
  assert.throws(() => checkOrigin(req({ host: 'a.com', origin: 'https://evil.com' }), []), ApiError);
  assert.throws(() => checkOrigin(req({ host: 'a.com', 'sec-fetch-site': 'cross-site' }), []), ApiError);
  assert.throws(() => checkOrigin(req({ host: 'a.com', origin: 'null' }), []), ApiError);
});

test('clientIp only trusts X-Forwarded-For when configured, using the proxy-appended entry', () => {
  const req = { headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }, socket: { remoteAddress: '10.0.0.1' } } as never;
  assert.equal(clientIp(req, 0), '10.0.0.1');
  assert.equal(clientIp(req, 1), '1.2.3.4'); // spoofed leftmost entry ignored
});

test('UpstreamClient: SSRF guards, redirects, size cap, timeout, no URL/secret leakage', async () => {
  const ok = (body: string, init: ResponseInit = {}) => async () => new Response(body, init);
  const mk = (fetchImpl: typeof fetch) => new UpstreamClient({ allowedHosts: ['power.larc.nasa.gov', 'firms.modaps.eosdis.nasa.gov'], userAgent: 't', fetchImpl });
  const secretUrl = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv/SECRETKEY1234567890/x';
  for (const u of ['http://power.larc.nasa.gov/x', 'https://evil.com/x', 'https://power.larc.nasa.gov:8443/x', 'https://user:pw@power.larc.nasa.gov/x', 'https://127.0.0.1/x', 'file:///etc/passwd', 'not a url']) {
    await assert.rejects(mk(ok('{}')).text('T', u), (e: unknown) => e instanceof UpstreamError && e.kind === 'blocked', u);
  }
  assert.equal(await mk(ok('hello')).text('T', 'https://power.larc.nasa.gov/x'), 'hello');
  await assert.rejects(mk(ok('x'.repeat(100))).text('T', 'https://power.larc.nasa.gov/x', { maxBytes: 10 }), (e: unknown) => (e as UpstreamError).kind === 'too_large');
  await assert.rejects(mk(ok('no', { status: 500 })).text('T', 'https://power.larc.nasa.gov/x'), (e: unknown) => (e as UpstreamError).status === 500);
  await assert.rejects(mk(ok('no', { status: 403 })).text('T', 'https://power.larc.nasa.gov/x'), (e: unknown) => (e as UpstreamError).kind === 'auth');
  await assert.rejects(mk(async () => { throw new TypeError('redirect mode is set to error'); }).text('T', 'https://power.larc.nasa.gov/x'), (e: unknown) => (e as UpstreamError).kind === 'network');
  const keep = setInterval(() => {}, 50); // AbortSignal.timeout timers are unref'd; keep the loop alive in this fake
  await assert.rejects(mk(async (_u, init) => { await new Promise((_r, rej) => (init!.signal as AbortSignal).addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' })))); return new Response(''); }).text('T', 'https://power.larc.nasa.gov/x', { timeoutMs: 20 }), (e: unknown) => (e as UpstreamError).kind === 'timeout');
  clearInterval(keep);
  await assert.rejects(mk(async () => { throw new Error('connect ' + secretUrl); }).text('FIRMS', secretUrl), (e: unknown) => !String((e as Error).message).includes('SECRET'));
  await assert.rejects(mk(ok('not json')).json('T', 'https://power.larc.nasa.gov/x'), (e: unknown) => (e as UpstreamError).kind === 'parse');
});

test('config: placeholders are ignored, secrets never described, bad values rejected', () => {
  const c = loadConfig({ GEMINI_API_KEY: 'MY_GEMINI_API_KEY', FIRMS_MAP_KEY: 'abcdefabcdefabcdefabcdef', PORT: '8080' } as never, []);
  assert.equal(c.geminiApiKey, null);
  assert.equal(c.port, 8080);
  assert.ok(!JSON.stringify(describeConfig(c)).includes('abcdefabcdef'));
  assert.throws(() => loadConfig({ PORT: 'abc' } as never, []));
  assert.throws(() => loadConfig({ GEOCODER_URL: 'http://insecure' } as never, []));
  assert.throws(() => loadConfig({ ALLOWED_ORIGINS: 'javascript:alert(1)x' } as never, []));
  assert.equal(loadConfig({ NODE_ENV: 'production' } as never, []).isProd, true);
  assert.equal(loadConfig({ PORT: '8080', NGINX_PORT: '8080', DEFAULT_APP_PORT: '3000' } as never, []).port, 3000);
});

test('CSP is strict in production', () => {
  const csp = buildCsp({ isProd: true, frameAncestors: "'none'" });
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.ok(!csp.includes("script-src 'self' 'unsafe"));
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self'(;|$)/);
});

test('sanitizeModelText strips markup, links and invented phone numbers but keeps dates', () => {
  const out = sanitizeModelText('Risk peaks 2026-11-20. Call +1 (555) 123-4567 or <script>alert(1)</script> [click](https://evil.com) 0300 1234567 now.');
  assert.ok(out.includes('2026-11-20'));
  assert.ok(!/555|1234567|<script|evil\.com/.test(out), out);
});
