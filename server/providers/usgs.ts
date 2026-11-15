import type { QuakeBrief } from '../../shared/types.ts';
import { UpstreamClient, UpstreamError } from '../net/upstream.ts';
import { cleanText, haversineKm, round } from '../risk/util.ts';

export function parseQuakes(json: unknown, lat: number, lon: number): QuakeBrief[] {
  const feats = (json as { features?: unknown })?.features;
  if (!Array.isArray(feats)) throw new UpstreamError('USGS', 'parse');
  const out: QuakeBrief[] = [];
  for (const f of feats) {
    const p = (f as { properties?: Record<string, unknown> }).properties ?? {};
    const c = (f as { geometry?: { coordinates?: unknown } }).geometry?.coordinates;
    if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
    if (typeof p.mag !== 'number' || typeof p.time !== 'number') continue;
    if (p.type !== undefined && p.type !== 'earthquake') continue;
    const url = typeof p.url === 'string' && p.url.startsWith('https://earthquake.usgs.gov/') ? p.url : null;
    out.push({
      id: cleanText(String((f as { id?: unknown }).id ?? ''), 40),
      mag: round(p.mag, 1),
      place: cleanText(p.place, 100),
      time: new Date(p.time).toISOString(),
      depthKm: typeof c[2] === 'number' ? round(c[2], 0) : 0,
      distanceKm: Math.round(haversineKm(lat, lon, c[1], c[0])),
      tsunamiFlag: p.tsunami === 1,
      url,
    });
  }
  return out;
}

export function parseCount(json: unknown): number {
  const n = (json as { count?: unknown })?.count;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new UpstreamError('USGS', 'parse');
  return n;
}

export class UsgsProvider {
  private readonly c: UpstreamClient;
  constructor(c: UpstreamClient) {
    this.c = c;
  }

  async recent(lat: number, lon: number, radiusKm: number, sinceIso: string, minMag: number): Promise<QuakeBrief[]> {
    const q = new URLSearchParams({
      format: 'geojson',
      latitude: String(lat),
      longitude: String(lon),
      maxradiuskm: String(radiusKm),
      starttime: sinceIso,
      minmagnitude: String(minMag),
      orderby: 'magnitude',
      limit: '200',
    });
    return parseQuakes(await this.c.json('USGS', `https://earthquake.usgs.gov/fdsnws/event/1/query?${q}`), lat, lon);
  }

  async count(lat: number, lon: number, radiusKm: number, sinceIso: string, minMag: number): Promise<number> {
    const q = new URLSearchParams({
      format: 'geojson',
      latitude: String(lat),
      longitude: String(lon),
      maxradiuskm: String(radiusKm),
      starttime: sinceIso,
      minmagnitude: String(minMag),
    });
    return parseCount(await this.c.json('USGS', `https://earthquake.usgs.gov/fdsnws/event/1/count?${q}`));
  }
}
