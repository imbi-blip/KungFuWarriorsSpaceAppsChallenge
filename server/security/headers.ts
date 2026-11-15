import type { ServerResponse } from 'node:http';
import type { Config } from '../config.ts';

export function buildCsp(cfg: Pick<Config, 'isProd' | 'frameAncestors'>): string {
  const d = [
    "default-src 'self'",
    // Dev needs inline preamble from Vite's React refresh; production is strict.
    cfg.isProd ? "script-src 'self'" : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    cfg.isProd ? "connect-src 'self'" : "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${cfg.frameAncestors}`,
  ];
  if (cfg.isProd) d.push('upgrade-insecure-requests');
  return d.join('; ');
}

export function applySecurityHeaders(res: ServerResponse, cfg: Config, secureRequest: boolean): void {
  res.setHeader('Content-Security-Policy', buildCsp(cfg));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  if (cfg.frameAncestors === "'none'") res.setHeader('X-Frame-Options', 'DENY');
  if (cfg.isProd && secureRequest) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}
