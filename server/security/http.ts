import type { IncomingMessage, ServerResponse } from 'node:http';

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, publicMessage: string) {
    super(publicMessage);
    this.status = status;
    this.code = code;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(payload);
}

/** Client IP. Only trusts X-Forwarded-For when TRUST_PROXY_HOPS > 0 (taking the entry set by our own proxy). */
export function clientIp(req: IncomingMessage, trustProxyHops: number): string {
  if (trustProxyHops > 0) {
    const xff = String(req.headers['x-forwarded-for'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const idx = xff.length - trustProxyHops;
    if (idx >= 0 && xff[idx]) return xff[idx].slice(0, 64);
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function isSecureRequest(req: IncomingMessage, trustProxyHops: number): boolean {
  if ((req.socket as { encrypted?: boolean }).encrypted) return true;
  return trustProxyHops > 0 && String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https';
}

export async function readJsonBody(req: IncomingMessage, maxBytes: number, timeoutMs = 10_000): Promise<unknown> {
  const ct = String(req.headers['content-type'] ?? '').toLowerCase();
  if (!ct.startsWith('application/json')) throw new ApiError(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError(413, 'payload_too_large', 'Request body too large.');

  const chunks: Buffer[] = [];
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError(408, 'timeout', 'Request body timed out.')), timeoutMs);
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        clearTimeout(timer);
        reject(new ApiError(413, 'payload_too_large', 'Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      clearTimeout(timer);
      resolve();
    });
    req.on('error', () => {
      clearTimeout(timer);
      reject(new ApiError(400, 'bad_request', 'Malformed request.'));
    });
  });
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw new ApiError(400, 'invalid_json', 'Body must be a JSON object.');
  }
}

/**
 * Block cross-site use of our API (CSRF + quota theft from other websites).
 * Browsers always send Sec-Fetch-Site / Origin; non-browser clients are governed by rate limits instead.
 */
export function checkOrigin(req: IncomingMessage, allowedOrigins: string[]): void {
  const site = String(req.headers['sec-fetch-site'] ?? '');
  const origin = req.headers.origin ? String(req.headers.origin) : null;
  const host = String(req.headers.host ?? '');

  if (origin) {
    let o: URL | null = null;
    try {
      o = new URL(origin);
    } catch {
      /* fallthrough */
    }
    const sameHost = !!o && o.host === host;
    const listed = !!o && allowedOrigins.includes(o.origin);
    if (!sameHost && !listed) throw new ApiError(403, 'forbidden_origin', 'Cross-origin requests are not allowed.');
    return;
  }
  if (site && site !== 'same-origin' && site !== 'none') {
    throw new ApiError(403, 'forbidden_origin', 'Cross-site requests are not allowed.');
  }
}
