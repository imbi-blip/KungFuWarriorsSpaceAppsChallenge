# Security

## Findings in the original project and how each was fixed

| # | Finding | Fix |
|---|---|---|
| 1 | `/api/predict-disasters` and `/api/describe-frame` were **unauthenticated and unlimited**; anyone could spend your Gemini quota | Per-IP limits per route, global daily AI budget (`GEMINI_DAILY_BUDGET`), response caching, same-origin enforcement |
| 2 | 10 MB JSON body limit on every route (memory/DoS) | Route caps (2 KB for briefs, 3 MB for frames), streaming size check, 10 s body timeout, `Content-Type` enforcement |
| 3 | Image endpoint accepted any string and passed it upstream | base64 + **magic-byte check (JPEG/PNG only)**, 2 MB cap |
| 4 | Client-supplied `localHazards`, titles and coordinates were interpolated into the LLM prompt (**prompt injection**) | The model only receives facts the server recomputes itself; strings are sanitised, JSON-quoted and labelled as data; client hazard fields are ignored |
| 5 | Upstream error text echoed to clients (could leak internals/keys) | Generic public errors; upstream errors carry provider+kind only; URLs (FIRMS key is in the URL path) never logged |
| 6 | Model output rendered as-is; Maps grounding URIs rendered as `href` | Output stripped of markup/links, **phone-number-like strings removed** (contacts come only from the curated directory); client renders only `https:` links |
| 7 | No security headers | Strict CSP (no inline script in production), `nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`, COOP/CORP, `Permissions-Policy`, HSTS behind TLS |
| 8 | Any website could script your API from visitors' browsers | `Origin` / `Sec-Fetch-Site` check on every `/api` request; no CORS headers emitted |
| 9 | Secrets: only `.env*` git-ignored | Config fails fast on bad values, placeholders treated as unset, secret values never described/logged, `envPrefix: VITE_`, source maps off, **`npm run audit:bundle`** fails the build if a key pattern or configured secret is in `dist/` |
| 10 | Wide dependency surface (Express 4, dotenv) | Server rewritten on `node:http` with **zero runtime packages** besides `@google/genai` (lazy-loaded). Build tools are devDependencies and absent in the container |
| 11 | Static serving by framework defaults | Own handler: path normalisation, decoded-traversal and NUL/backslash rejection, no SPA fallback for missing assets, tested |
| 12 | Location privacy | Coordinates rounded to ~1 km before any upstream call, not logged (query strings are dropped from logs), no IP logging, no cookies/storage |

## SSRF and upstream safety
`UpstreamClient` allows only `https`, exact allow-listed hostnames (NASA, USGS, Open-Meteo, the configured geocoder),
no credentials/ports, `redirect: error`, 12 s timeout, byte caps. Users cannot influence the host or path.

## Abuse controls (defaults, all env-tunable)
120 req/min per IP overall; 20 `/api/risk`; 6 `/api/brief`; 4 `/api/describe-frame`; 300 AI calls/day global;
bounded in-memory limiter state; negative caching + request coalescing protect upstream APIs;
Nominatim throttled to 1 req/s with fail-fast.

## What you still must do (cannot be solved in code)
1. **Restrict the Gemini key** in Google Cloud (API restriction, quota, budget alert). The browser never sees it, but a server compromise would.
2. Set `TRUST_PROXY_HOPS` to the real number of proxies, otherwise limits are per-proxy not per-user.
3. Run behind TLS and, for public launch, a CDN/WAF (Cloudflare etc.) with bot protection: the in-memory limiter is per-instance, and headers like `Origin` cannot stop a determined non-browser script.
4. For multi-instance deployments use a shared limiter (Redis / edge rate-limit rules).
5. Pin and audit dependencies: create `package-lock.json`, run `npm audit`, enable Dependabot.
6. Fonts load from Google Fonts (allowed in CSP). Self-host them to remove the third party entirely.
7. Re-verify `emergencyDirectory.ts` at least yearly; emergency data is life-safety content.
8. Do not log request bodies/query strings in your platform logs (they contain coordinates).

## Reporting
Add your contact in `CONTACT_EMAIL` and a `/.well-known/security.txt` when you publish.
