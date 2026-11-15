import type { PowerClimatology, PowerDay } from '../providers/nasaPower.ts';
import type { ForecastDay } from '../providers/openMeteo.ts';
import { HORIZON_DAYS } from '../../shared/types.ts';
import { addDays } from './util.ts';

export interface WeatherDay {
  date: string;
  tmax: number | null;
  rh: number | null;
  wind: number | null; // m/s
  precip: number; // mm
  basis: 'forecast' | 'climatology';
  skill: number; // 0..1 (confidence in the day's weather)
}

const monthIdx = (iso: string) => Number(iso.slice(5, 7)) - 1;
const mean = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * 20 daily weather rows. Days covered by a numerical forecast use it (skill falls with lead time);
 * the rest use NASA POWER 1991-2020 climatology plus a decaying persistence of the recent observed anomaly.
 */
export function buildTimeline(opts: {
  today: string;
  obs: PowerDay[];
  forecast: ForecastDay[] | null;
  clim: PowerClimatology | null;
}): WeatherDay[] {
  const { today, obs, forecast, clim } = opts;
  const recent = obs.slice(-10);
  const fcByDate = new Map((forecast ?? []).map((f) => [f.date, f]));

  const anomaly = (key: 'tmax' | 'rh' | 'wind', climKey: 'tmax' | 'rh' | 'wind'): number => {
    const o = mean(recent.map((d) => d[key]));
    const m = clim ? clim[climKey][monthIdx(today)] : null;
    return o !== null && m !== null ? o - m : 0;
  };
  const aT = anomaly('tmax', 'tmax');
  const aR = anomaly('rh', 'rh');
  const obsMean = {
    tmax: mean(obs.map((d) => d.tmax)),
    rh: mean(obs.map((d) => d.rh)),
    wind: mean(obs.map((d) => d.wind)),
    precip: mean(obs.map((d) => d.precip)),
  };

  const out: WeatherDay[] = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const date = addDays(today, i);
    const fc = fcByDate.get(date);
    const m = monthIdx(date);
    const decay = Math.exp(-i / 10);
    if (fc && (fc.tmax !== null || fc.precip !== null)) {
      out.push({
        date,
        tmax: fc.tmax ?? (clim?.tmax[m] ?? obsMean.tmax),
        rh: fc.rh ?? (clim?.rh[m] ?? obsMean.rh),
        wind: fc.wind !== null ? fc.wind * 0.6 : clim?.wind[m] ?? obsMean.wind, // 10 m max gust-ish -> sustained
        precip: fc.precip ?? clim?.precipMmDay[m] ?? obsMean.precip ?? 0,
        basis: 'forecast',
        skill: Math.max(0.45, 1 - 0.55 * (i / 15)),
      });
    } else {
      const cT = clim?.tmax[m] ?? null;
      const cR = clim?.rh[m] ?? null;
      out.push({
        date,
        tmax: cT !== null ? cT + aT * decay : obsMean.tmax,
        rh: cR !== null ? Math.max(5, Math.min(100, cR + aR * decay)) : obsMean.rh,
        wind: clim?.wind[m] ?? obsMean.wind,
        precip: clim?.precipMmDay[m] ?? obsMean.precip ?? 0,
        basis: 'climatology',
        skill: 0.25,
      });
    }
  }
  return out;
}

export const hasWeather = (t: WeatherDay[]): boolean => t.some((d) => d.tmax !== null || d.precip > 0);
