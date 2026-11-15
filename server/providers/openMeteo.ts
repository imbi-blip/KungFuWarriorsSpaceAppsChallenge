import { UpstreamClient, UpstreamError } from '../net/upstream.ts';

export interface ForecastDay {
  date: string;
  tmax: number | null;
  rh: number | null; // daily mean from hourly
  wind: number | null; // m/s at 10 m
  precip: number | null; // mm
}
export interface DischargePoint {
  date: string;
  q: number | null; // m3/s
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function parseForecast(json: unknown): ForecastDay[] {
  const j = json as { daily?: Record<string, unknown>; hourly?: Record<string, unknown> };
  const times = arr(j?.daily?.time);
  if (!times.length) throw new UpstreamError('Open-Meteo', 'parse');
  const rhByDay = new Map<string, number[]>();
  const ht = arr(j.hourly?.time);
  const hr = arr(j.hourly?.relative_humidity_2m);
  ht.forEach((t, i) => {
    const v = n(hr[i]);
    if (typeof t === 'string' && v !== null) {
      const d = t.slice(0, 10);
      (rhByDay.get(d) ?? rhByDay.set(d, []).get(d)!).push(v);
    }
  });
  return times
    .map((t, i) => {
      const date = String(t).slice(0, 10);
      const rhs = rhByDay.get(date);
      return {
        date,
        tmax: n(arr(j.daily!.temperature_2m_max)[i]),
        wind: n(arr(j.daily!.wind_speed_10m_max)[i]),
        precip: n(arr(j.daily!.precipitation_sum)[i]),
        rh: rhs && rhs.length ? rhs.reduce((a, b) => a + b, 0) / rhs.length : null,
      };
    })
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date));
}

export function parseDischarge(json: unknown): DischargePoint[] {
  const d = (json as { daily?: Record<string, unknown> })?.daily;
  const times = arr(d?.time);
  if (!times.length) throw new UpstreamError('Open-Meteo Flood', 'parse');
  const q = arr(d!.river_discharge);
  return times.map((t, i) => ({ date: String(t).slice(0, 10), q: n(q[i]) }));
}

export function parseElevation(json: unknown): number | null {
  const e = (json as { elevation?: unknown })?.elevation;
  return Array.isArray(e) ? n(e[0]) : n(e);
}

export class OpenMeteoProvider {
  private readonly c: UpstreamClient;
  constructor(c: UpstreamClient) {
    this.c = c;
  }
  async forecast(lat: number, lon: number): Promise<ForecastDay[]> {
    const q = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      daily: 'temperature_2m_max,wind_speed_10m_max,precipitation_sum',
      hourly: 'relative_humidity_2m',
      forecast_days: '16',
      timezone: 'UTC',
      wind_speed_unit: 'ms',
    });
    return parseForecast(await this.c.json('Open-Meteo', `https://api.open-meteo.com/v1/forecast?${q}`));
  }
  async discharge(lat: number, lon: number): Promise<DischargePoint[]> {
    const q = new URLSearchParams({ latitude: String(lat), longitude: String(lon), daily: 'river_discharge', past_days: '30', forecast_days: '20' });
    return parseDischarge(await this.c.json('Open-Meteo Flood', `https://flood-api.open-meteo.com/v1/flood?${q}`));
  }
  async elevation(lat: number, lon: number): Promise<number | null> {
    const q = new URLSearchParams({ latitude: String(lat), longitude: String(lon) });
    return parseElevation(await this.c.json('Open-Meteo', `https://api.open-meteo.com/v1/elevation?${q}`));
  }
}
