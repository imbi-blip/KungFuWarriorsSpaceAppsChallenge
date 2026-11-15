import { UpstreamClient, UpstreamError } from '../net/upstream.ts';
import { haversineKm } from '../risk/util.ts';

export interface FireSummary {
  count: number; // credible detections inside radius
  totalFrpMw: number;
  maxFrpMw: number;
  nearestKm: number | null;
  radiusKm: number;
  days: number;
}

/** Parses a FIRMS area CSV and summarises detections within radiusKm of the point. Low-confidence pixels are ignored. */
export function summariseFirmsCsv(csv: string, lat: number, lon: number, radiusKm: number, days: number): FireSummary {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
  const iLat = header.indexOf('latitude');
  const iLon = header.indexOf('longitude');
  if (iLat < 0 || iLon < 0) throw new UpstreamError('NASA FIRMS', 'parse'); // e.g. "Invalid MAP_KEY" text
  const iFrp = header.indexOf('frp');
  const iConf = header.indexOf('confidence');
  let count = 0;
  let total = 0;
  let max = 0;
  let nearest: number | null = null;
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(',');
    const la = Number(f[iLat]);
    const lo = Number(f[iLon]);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    const conf = iConf >= 0 ? (f[iConf] ?? '').trim().toLowerCase() : 'n';
    if (conf === 'l' || conf === 'low' || (/^\d+$/.test(conf) && Number(conf) < 30)) continue;
    const d = haversineKm(lat, lon, la, lo);
    if (d > radiusKm) continue;
    const frp = iFrp >= 0 && Number.isFinite(Number(f[iFrp])) ? Number(f[iFrp]) : 0;
    count++;
    total += frp;
    max = Math.max(max, frp);
    nearest = nearest === null ? d : Math.min(nearest, d);
  }
  return { count, totalFrpMw: Math.round(total), maxFrpMw: Math.round(max), nearestKm: nearest === null ? null : Math.round(nearest), radiusKm, days };
}

export class NasaFirmsProvider {
  private readonly c: UpstreamClient;
  private readonly key: string;
  constructor(c: UpstreamClient, mapKey: string) {
    if (!/^[A-Za-z0-9]{16,64}$/.test(mapKey)) throw new Error('FIRMS_MAP_KEY has an unexpected format');
    this.c = c;
    this.key = mapKey;
  }

  async fires(lat: number, lon: number, radiusKm = 50, days = 3): Promise<FireSummary> {
    const dLat = radiusKm / 111;
    const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const w = Math.max(-180, lon - dLon).toFixed(3);
    const e = Math.min(180, lon + dLon).toFixed(3);
    const s = Math.max(-90, lat - dLat).toFixed(3);
    const n = Math.min(90, lat + dLat).toFixed(3);
    // The key is part of the URL path (FIRMS API design) - it stays server-side and UpstreamError never prints URLs.
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${this.key}/VIIRS_SNPP_NRT/${w},${s},${e},${n}/${days}`;
    const csv = await this.c.text('NASA FIRMS', url, { accept: 'text/csv', maxBytes: 3_000_000 });
    return summariseFirmsCsv(csv, lat, lon, radiusKm, days);
  }
}
