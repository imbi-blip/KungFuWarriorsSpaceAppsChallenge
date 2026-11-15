import type { Confidence, DailyRisk, Driver, HazardAssessment, NearbyEvent } from '../../shared/types.ts';
import type { PowerClimatology, PowerDay } from '../providers/nasaPower.ts';
import type { DischargePoint } from '../providers/openMeteo.ts';
import type { WeatherDay } from './weather.ts';
import { bandHalfWidth, clamp, clamp01, round, tierFor } from './util.ts';

export interface FloodInput {
  obs: PowerDay[];
  clim: PowerClimatology | null;
  timeline: WeatherDay[];
  discharge: DischargePoint[] | null;
  nearbyFloodEvents: NearbyEvent[];
  onLand: boolean | null;
  hasForecast: boolean;
  today: string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Flood-potential index (0-100): rainfall vs local threshold, amplified by soil saturation; river-discharge growth and open flood events combine as noisy-OR. */
export function assessFlood(i: FloodInput): HazardAssessment {
  const base = { hazard: 'flood' as const };
  if (i.onLand === false) {
    return { ...base, available: false, unavailableReason: 'Open water - riverine/pluvial flood risk not applicable.', tier: 'Low', peakScore: 0, peakDate: i.today, todayScore: 0, confidence: 'high', summary: 'This point is over open water.', daily: [], drivers: [], caveats: [] };
  }
  if (!i.timeline.length || (!i.obs.length && !i.clim && !i.hasForecast)) {
    return { ...base, available: false, unavailableReason: 'Rainfall and soil data were unavailable.', tier: 'Low', peakScore: 0, peakDate: i.today, todayScore: 0, confidence: 'low', summary: 'Not enough data to assess flood potential right now.', daily: [], drivers: [], caveats: [] };
  }
  const m = Number(i.today.slice(5, 7)) - 1;
  const climP = i.clim?.precipMmDay[m] ?? 2.5;
  const H3 = clamp(25 + 6 * climP, 30, 110); // 3-day rainfall (mm) considered flood-producing locally

  const soilRecent = i.obs.slice(-5).map((d) => (d.soilTop !== null && d.soilRoot !== null ? 0.5 * d.soilTop + 0.5 * d.soilRoot : d.soilRoot ?? d.soilTop)).filter((x): x is number => x !== null);
  let soil = soilRecent.length ? soilRecent.reduce((a, b) => a + b, 0) / soilRecent.length : 0.5;
  const soil0 = soil;

  const past = i.obs.slice(-2).map((d) => d.precip ?? 0);
  const rain = [...past, ...i.timeline.map((d) => d.precip)];

  // River discharge growth versus the recent 30-day median.
  const dis = i.discharge ?? [];
  const hist = dis.filter((p) => p.date < i.today && p.q !== null).map((p) => p.q as number);
  const baseQ = hist.length >= 10 ? median(hist) : null;
  const qByDate = new Map(dis.map((p) => [p.date, p.q]));

  const nearestEvt = i.nearbyFloodEvents.length ? Math.min(...i.nearbyFloodEvents.map((e) => e.distanceKm)) : null;
  const evt0 = nearestEvt === null ? 0 : nearestEvt <= 100 ? 0.55 : nearestEvt <= 300 ? 0.3 : 0;

  const daily: DailyRisk[] = [];
  let peak3 = 0;
  let peakRatio = 0;
  i.timeline.forEach((w, idx) => {
    const p1 = rain[idx + 2];
    const p3 = rain[idx] + rain[idx + 1] + rain[idx + 2];
    peak3 = Math.max(peak3, p3);
    const rainTerm = clamp01(Math.max(p3 / H3, p1 / (0.7 * H3)));
    soil = clamp01(soil + 0.02 * w.precip - 0.025);
    const baseTerm = clamp01(rainTerm * (0.65 + 0.7 * soil));
    let river = 0;
    const q = qByDate.get(w.date);
    if (baseQ !== null && baseQ > 0 && typeof q === 'number') {
      const ratio = q / baseQ;
      peakRatio = Math.max(peakRatio, ratio);
      river = clamp01((ratio - 1.5) / 4);
    }
    const evt = evt0 * Math.exp(-idx / 8);
    const score = round(100 * (1 - (1 - baseTerm) * (1 - 0.75 * river) * (1 - evt)));
    const half = bandHalfWidth(w.skill);
    daily.push({ date: w.date, score, low: Math.max(0, round(score - half)), high: Math.min(100, round(score + half)) });
  });

  const peak = daily.reduce((a, b) => (b.score > a.score ? b : a), daily[0]);
  const drivers: Driver[] = [
    { label: 'Peak 3-day rainfall in outlook', value: `${Math.round(peak3)} mm (local flood-producing threshold ~${Math.round(H3)} mm)`, source: i.hasForecast ? 'Open-Meteo forecast + NASA POWER climatology' : 'NASA POWER climatology' },
    { label: 'Current soil wetness', value: `${Math.round(soil0 * 100)}%`, source: soilRecent.length ? 'NASA POWER' : 'assumed (no data)' },
  ];
  if (baseQ !== null && peakRatio > 0) drivers.push({ label: 'Peak river discharge vs 30-day median', value: `${round(peakRatio, 1)}x`, source: 'Open-Meteo Flood (GloFAS)' });
  if (nearestEvt !== null) drivers.push({ label: 'Open flood events nearby', value: `${i.nearbyFloodEvents.length}, nearest ${nearestEvt} km`, source: 'NASA EONET' });

  const caveats = [
    'Regional index from rainfall, soil moisture and river-flow trends; it does not model local drainage, terrain, dams or levees.',
    'Rainfall beyond ~day 10 is only climatological: the later part of the 20 days shows background risk, not a forecast storm.',
  ];
  if (!i.hasForecast) caveats.push('Numerical rainfall forecast unavailable; results lean on NASA climatology.');
  if (i.discharge === null) caveats.push('River discharge data unavailable.');
  const confidence: Confidence = i.hasForecast && i.obs.length ? 'medium' : 'low';
  const tier = tierFor(peak.score);
  return {
    ...base,
    available: true,
    tier,
    peakScore: peak.score,
    peakDate: peak.date,
    todayScore: daily[0].score,
    confidence,
    summary: `${tier} flood potential; highest on ${peak.date} (${peak.score}/100).${nearestEvt !== null && nearestEvt <= 300 ? ' Flooding is already reported nearby.' : ''}`,
    daily,
    drivers,
    caveats,
  };
}
