import type { LocationInfo } from '../../shared/types.ts';
import { UpstreamClient, UpstreamError } from '../net/upstream.ts';
import { cleanText } from '../risk/util.ts';

export function parseReverseGeocode(json: unknown, lat: number, lon: number): LocationInfo {
  const j = json as { error?: unknown; address?: Record<string, unknown> };
  if (j && typeof j === 'object' && j.error) {
    // Nominatim answers "Unable to geocode" for open water.
    return { lat, lon, countryCode: null, country: null, place: null, onLand: false };
  }
  const a = j?.address;
  if (!a || typeof a !== 'object') throw new UpstreamError('Geocoder', 'parse');
  const cc = typeof a.country_code === 'string' && /^[a-z]{2}$/i.test(a.country_code) ? a.country_code.toUpperCase() : null;
  const local = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state_district;
  const place = [local, a.state, a.country].map((x) => cleanText(x, 60)).filter(Boolean).join(', ') || null;
  return { lat, lon, countryCode: cc, country: cleanText(a.country, 60) || null, place, onLand: cc !== null };
}

/** Reverse geocoder with a hard 1 req/s politeness throttle (Nominatim policy). Fails fast instead of queueing long. */
export class GeocodeProvider {
  private readonly c: UpstreamClient;
  private readonly base: string;
  private nextSlot = 0;
  constructor(c: UpstreamClient, base: string) {
    this.c = c;
    this.base = base;
  }
  async reverse(lat: number, lon: number): Promise<LocationInfo> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    if (slot - now > 3000) throw new UpstreamError('Geocoder', 'http', 429);
    this.nextSlot = slot + 1100;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
    const q = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lon), zoom: '10', addressdetails: '1', 'accept-language': 'en' });
    return parseReverseGeocode(await this.c.json('Geocoder', `${this.base}?${q}`, { timeoutMs: 8000 }), lat, lon);
  }
}
