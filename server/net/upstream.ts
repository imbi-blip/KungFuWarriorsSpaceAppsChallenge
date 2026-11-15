export type UpstreamErrorKind = 'blocked' | 'timeout' | 'http' | 'too_large' | 'network' | 'parse' | 'auth';

/** Carries provider + kind + status only. Never the URL (FIRMS keys live in the URL path). */
export class UpstreamError extends Error {
  provider: string;
  kind: UpstreamErrorKind;
  status?: number;
  constructor(provider: string, kind: UpstreamErrorKind, status?: number) {
    super(`${provider}: ${kind}${status ? ` (${status})` : ''}`);
    this.provider = provider;
    this.kind = kind;
    this.status = status;
  }
}

export const UPSTREAM_HOSTS = [
  'power.larc.nasa.gov',
  'eonet.gsfc.nasa.gov',
  'firms.modaps.eosdis.nasa.gov',
  'earthquake.usgs.gov',
  'api.open-meteo.com',
  'flood-api.open-meteo.com',
  'nominatim.openstreetmap.org',
] as const;

export interface UpstreamClientOptions {
  allowedHosts: readonly string[];
  userAgent: string;
  fetchImpl?: typeof fetch;
  defaultTimeoutMs?: number;
  defaultMaxBytes?: number;
}

export class UpstreamClient {
  private readonly o: UpstreamClientOptions;
  constructor(o: UpstreamClientOptions) {
    this.o = o;
  }

  async text(provider: string, url: string, opts: { timeoutMs?: number; maxBytes?: number; accept?: string } = {}): Promise<string> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new UpstreamError(provider, 'blocked');
    }
    // SSRF guard: https only, exact-host allowlist, no credentials, default port.
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !this.o.allowedHosts.includes(u.hostname)) {
      throw new UpstreamError(provider, 'blocked');
    }
    const maxBytes = opts.maxBytes ?? this.o.defaultMaxBytes ?? 5_000_000;
    const f = this.o.fetchImpl ?? fetch;
    let res: Response;
    try {
      res = await f(u, {
        method: 'GET',
        redirect: 'error',
        headers: { 'User-Agent': this.o.userAgent, Accept: opts.accept ?? 'application/json, text/csv, */*' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.o.defaultTimeoutMs ?? 12_000),
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      throw new UpstreamError(provider, name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network');
    }
    if (res.status === 401 || res.status === 403) throw new UpstreamError(provider, 'auth', res.status);
    if (!res.ok) throw new UpstreamError(provider, 'http', res.status);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw new UpstreamError(provider, 'too_large');
    if (!res.body) return '';
    const reader = res.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new UpstreamError(provider, 'too_large');
        }
        parts.push(value);
      }
    } catch (e) {
      if (e instanceof UpstreamError) throw e;
      throw new UpstreamError(provider, 'network');
    }
    return Buffer.concat(parts).toString('utf8');
  }

  async json(provider: string, url: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<unknown> {
    const t = await this.text(provider, url, opts);
    try {
      return JSON.parse(t);
    } catch {
      throw new UpstreamError(provider, 'parse');
    }
  }
}

export type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

export async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e instanceof UpstreamError ? e.kind : 'error' };
  }
}
