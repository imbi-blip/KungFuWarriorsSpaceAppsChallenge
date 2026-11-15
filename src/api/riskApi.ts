import type { LiveEvent, RiskReport } from '../../shared/types';

export class ApiRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit, signal?: AbortSignal, timeoutMs = 45_000): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(path, { ...init, signal: combined, credentials: 'same-origin', cache: 'no-store' });
  } catch (e) {
    if (signal?.aborted) throw e; // caller cancelled: let it propagate untouched
    throw new ApiRequestError('Could not reach the server. Check your connection and try again.', 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const msg = (body as { error?: { message?: unknown } } | null)?.error?.message;
    throw new ApiRequestError(typeof msg === 'string' ? msg : `Request failed (${res.status}).`, res.status);
  }
  return body as T;
}

const coord = (n: number) => n.toFixed(2);

export function fetchRisk(lat: number, lon: number, signal?: AbortSignal): Promise<RiskReport> {
  const r = request<RiskReport>(`/api/risk?lat=${coord(lat)}&lon=${coord(lon)}`, { method: 'GET' }, signal);
  return r.then((rep) => {
    if (!rep || !Array.isArray(rep.hazards) || !rep.safety) throw new ApiRequestError('Unexpected server response.', 502);
    return rep;
  });
}

export function fetchBrief(lat: number, lon: number, signal?: AbortSignal): Promise<{ text: string; source: 'ai' }> {
  return request('/api/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lat, lon }) }, signal, 30_000);
}

export async function fetchLiveEvents(signal?: AbortSignal): Promise<LiveEvent[]> {
  const j = await request<{ events?: LiveEvent[] }>('/api/events', { method: 'GET' }, signal, 30_000);
  return Array.isArray(j.events) ? j.events : [];
}

/** Only render links that are https; all URLs originate from our own server data, this is defence in depth. */
export const safeHref = (url: string | null | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
};
