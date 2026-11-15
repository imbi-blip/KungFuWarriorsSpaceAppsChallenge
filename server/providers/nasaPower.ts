import { UpstreamClient, UpstreamError } from '../net/upstream.ts';
import { addDays } from '../risk/util.ts';

export interface PowerDay {
  date: string;
  precip: number | null; // mm/day
  tmax: number | null; // °C
  rh: number | null; // % (daily mean)
  wind: number | null; // m/s at 2 m
  soilTop: number | null; // 0..1 surface soil wetness
  soilRoot: number | null; // 0..1 root-zone soil wetness
}

export interface PowerClimatology {
  precipMmDay: Array<number | null>; // 12 months
  tmax: Array<number | null>;
  rh: Array<number | null>;
  wind: Array<number | null>;
  annualPrecipMm: number | null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > -900 ? v : null);

function paramObject(json: unknown): Record<string, Record<string, unknown>> {
  const p = (json as { properties?: { parameter?: unknown } })?.properties?.parameter;
  if (!p || typeof p !== 'object') throw new UpstreamError('NASA POWER', 'parse');
  return p as Record<string, Record<string, unknown>>;
}

export function parsePowerDaily(json: unknown): PowerDay[] {
  const p = paramObject(json);
  const dates = new Set<string>();
  for (const series of Object.values(p)) {
    if (series && typeof series === 'object') for (const d of Object.keys(series)) if (/^\d{8}$/.test(d)) dates.add(d);
  }
  return [...dates].sort().map((d) => ({
    date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
    precip: num(p.PRECTOTCORR?.[d]),
    tmax: num(p.T2M_MAX?.[d]),
    rh: num(p.RH2M?.[d]),
    wind: num(p.WS2M?.[d]),
    soilTop: num(p.GWETTOP?.[d]),
    soilRoot: num(p.GWETROOT?.[d]),
  }));
}

export function parsePowerClimatology(json: unknown): PowerClimatology {
  const p = paramObject(json);
  const arr = (name: string) => MONTHS.map((m) => num(p[name]?.[m]));
  const precip = arr('PRECTOTCORR');
  if (precip.every((x) => x === null)) throw new UpstreamError('NASA POWER', 'parse');
  const ann = num(p.PRECTOTCORR?.ANN);
  const annualPrecipMm = ann !== null ? ann * 365 : precip.every((x) => x !== null) ? (precip as number[]).reduce((a, b) => a + b * 30.4, 0) : null;
  return { precipMmDay: precip, tmax: arr('T2M_MAX'), rh: arr('RH2M'), wind: arr('WS2M'), annualPrecipMm };
}

const ymd = (iso: string) => iso.replaceAll('-', '');

export class NasaPowerProvider {
  private readonly c: UpstreamClient;
  constructor(c: UpstreamClient) {
    this.c = c;
  }

  async dailyObservations(lat: number, lon: number, today: string, days = 30): Promise<PowerDay[]> {
    const q = new URLSearchParams({
      parameters: 'PRECTOTCORR,T2M_MAX,RH2M,WS2M,GWETTOP,GWETROOT',
      community: 'AG',
      longitude: String(lon),
      latitude: String(lat),
      start: ymd(addDays(today, -days)),
      end: ymd(today),
      format: 'JSON',
    });
    return parsePowerDaily(await this.c.json('NASA POWER', `https://power.larc.nasa.gov/api/temporal/daily/point?${q}`, { timeoutMs: 20_000 }));
  }

  async climatology(lat: number, lon: number): Promise<PowerClimatology> {
    const q = new URLSearchParams({
      parameters: 'PRECTOTCORR,T2M_MAX,RH2M,WS2M',
      community: 'AG',
      longitude: String(lon),
      latitude: String(lat),
      format: 'JSON',
    });
    return parsePowerClimatology(await this.c.json('NASA POWER', `https://power.larc.nasa.gov/api/temporal/climatology/point?${q}`, { timeoutMs: 20_000 }));
  }
}
