import { existsSync } from 'node:fs';

export interface Config {
  isProd: boolean;
  port: number;
  host: string;
  geminiApiKey: string | null;
  geminiModel: string;
  firmsMapKey: string | null;
  trustProxyHops: number;
  allowedOrigins: string[];
  frameAncestors: string;
  enableOpenMeteo: boolean;
  geocoderUrl: string;
  contactEmail: string | null;
  geminiDailyBudget: number;
  rateLimits: {
    apiPerMin: number;
    riskPerMin: number;
    briefPerMin: number;
    framePerMin: number;
  };
  distDir: string;
}

const PLACEHOLDERS = new Set(['', 'MY_GEMINI_API_KEY', 'MY_FIRMS_MAP_KEY', 'MY_APP_URL', 'changeme', 'your-key-here']);

function secret(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return PLACEHOLDERS.has(t) ? null : t;
}

function intEnv(env: NodeJS.ProcessEnv, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid ${name}: expected integer in [${min}, ${max}]`);
  }
  return n;
}

function boolEnv(env: NodeJS.ProcessEnv, name: string, def: boolean): boolean {
  const raw = (env[name] ?? '').trim().toLowerCase();
  if (raw === '') return def;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`Invalid ${name}: expected true/false`);
}

/** Load .env.local then .env (never overriding real environment variables). */
export function loadEnvFiles(): void {
  for (const f of ['.env.local', '.env']) {
    if (existsSync(f)) {
      try {
        process.loadEnvFile(f);
      } catch {
        /* ignore malformed file; validation below reports what matters */
      }
    }
  }
}

function origins(env: NodeJS.ProcessEnv): string[] {
  const list = [env.ALLOWED_ORIGINS, env.APP_URL]
    .filter((x): x is string => !!x && !PLACEHOLDERS.has(x.trim()))
    .flatMap((x) => x.split(','))
    .map((x) => x.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const o of list) {
    let u: URL;
    try {
      u = new URL(o);
    } catch {
      throw new Error('Invalid ALLOWED_ORIGINS / APP_URL entry (must be an absolute origin URL)');
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('ALLOWED_ORIGINS / APP_URL must be http(s) origins');
    out.push(u.origin);
  }
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): Config {
  const isProd = env.NODE_ENV === 'production' || argv.includes('--production');
  const geocoderUrl = (env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/reverse').trim();
  if (!geocoderUrl.startsWith('https://')) throw new Error('GEOCODER_URL must be https');
  const portEnv = env.NGINX_PORT && env.PORT === env.NGINX_PORT ? { ...env, PORT: env.DEFAULT_APP_PORT || '3000' } : env;
  const cfg: Config = {
    isProd,
    port: intEnv(portEnv, 'PORT', 3000, 1, 65535),
    host: (env.HOST || '0.0.0.0').trim(),
    geminiApiKey: secret(env.GEMINI_API_KEY),
    geminiModel: (env.GEMINI_MODEL || 'gemini-4-hydrogen').trim(),
    firmsMapKey: secret(env.FIRMS_MAP_KEY),
    trustProxyHops: intEnv(env, 'TRUST_PROXY_HOPS', 0, 0, 5),
    allowedOrigins: origins(env),
    frameAncestors: (env.FRAME_ANCESTORS || "'self' https://aistudio.google.com https://*.aistudio.google.com https://*.googleusercontent.com").trim(),
    enableOpenMeteo: boolEnv(env, 'ENABLE_OPEN_METEO', true),
    geocoderUrl,
    contactEmail: (env.CONTACT_EMAIL || '').trim() || null,
    geminiDailyBudget: intEnv(env, 'GEMINI_DAILY_BUDGET', 300, 0, 1_000_000),
    rateLimits: {
      apiPerMin: intEnv(env, 'RATE_API_PER_MIN', 120, 1, 100_000),
      riskPerMin: intEnv(env, 'RATE_RISK_PER_MIN', 20, 1, 100_000),
      briefPerMin: intEnv(env, 'RATE_BRIEF_PER_MIN', 6, 1, 100_000),
      framePerMin: intEnv(env, 'RATE_FRAME_PER_MIN', 4, 1, 100_000),
    },
    distDir: env.DIST_DIR || 'dist',
  };
  if (!/^[\w.:\-\[\]]+$/.test(cfg.host)) throw new Error('Invalid HOST');
  return cfg;
}

/** Safe-to-log summary: never includes secret values. */
export function describeConfig(c: Config): Record<string, unknown> {
  return {
    mode: c.isProd ? 'production' : 'development',
    host: c.host,
    port: c.port,
    gemini: c.geminiApiKey ? 'configured' : 'not configured (rule-based briefings only)',
    firms: c.firmsMapKey ? 'configured' : 'not configured (EONET fire events only)',
    openMeteo: c.enableOpenMeteo,
    trustProxyHops: c.trustProxyHops,
    allowedOrigins: c.allowedOrigins.length,
  };
}
