import type { LiveEvent } from '../../shared/types.ts';
import { UpstreamClient, UpstreamError } from '../net/upstream.ts';
import { cleanText } from '../risk/util.ts';

const CATEGORIES = ['wildfires', 'floods', 'severeStorms', 'volcanoes', 'landslides'] as const;

function point(geom: { type?: string; coordinates?: unknown }): { lon: number; lat: number } | null {
  const c = geom.coordinates;
  if (geom.type === 'Point' && Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
    return { lon: c[0], lat: c[1] };
  }
  if (geom.type === 'Polygon' && Array.isArray(c) && Array.isArray(c[0])) {
    const ring = c[0] as unknown[];
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const p of ring) {
      if (Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number') {
        sx += p[0];
        sy += p[1];
        n++;
      }
    }
    if (n) return { lon: sx / n, lat: sy / n };
  }
  return null;
}

export function parseEonet(json: unknown): LiveEvent[] {
  const events = (json as { events?: unknown })?.events;
  if (!Array.isArray(events)) throw new UpstreamError('NASA EONET', 'parse');
  const out: LiveEvent[] = [];
  for (const ev of events) {
    const e = ev as { id?: unknown; title?: unknown; categories?: Array<{ id?: unknown }>; geometry?: Array<{ date?: unknown; type?: string; coordinates?: unknown }> };
    const id = typeof e.id === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(e.id) ? e.id : null;
    const cat = e.categories?.[0]?.id;
    const g = Array.isArray(e.geometry) ? e.geometry[e.geometry.length - 1] : undefined;
    if (!id || typeof cat !== 'string' || !g) continue;
    const p = point(g);
    if (!p || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) continue;
    const date = typeof g.date === 'string' ? g.date.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({ id, title: cleanText(e.title, 120) || 'Untitled event', category: cleanText(cat, 32), lat: p.lat, lon: p.lon, date });
  }
  return out;
}

export const eonetUrl = (id: string): string => `https://eonet.gsfc.nasa.gov/api/v3/events/${encodeURIComponent(id)}`;

export class NasaEonetProvider {
  private readonly c: UpstreamClient;
  constructor(c: UpstreamClient) {
    this.c = c;
  }
  async openEvents(): Promise<LiveEvent[]> {
    const q = new URLSearchParams({ status: 'open', days: '20', limit: '600', category: CATEGORIES.join(',') });
    return parseEonet(await this.c.json('NASA EONET', `https://eonet.gsfc.nasa.gov/api/v3/events?${q}`, { maxBytes: 15_000_000, timeoutMs: 20_000 }));
  }
}
