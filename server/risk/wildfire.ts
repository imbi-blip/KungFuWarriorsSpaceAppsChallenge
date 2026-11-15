import { HORIZON_DAYS, type Confidence, type DailyRisk, type Driver, type HazardAssessment, type NearbyEvent } from '../../shared/types.ts';
import type { FireSummary } from '../providers/nasaFirms.ts';
import type { PowerClimatology, PowerDay } from '../providers/nasaPower.ts';
import type { WeatherDay } from './weather.ts';
import { bandHalfWidth, clamp01, round, tierFor } from './util.ts';

export interface WildfireInput {
  obs: PowerDay[];
  clim: PowerClimatology | null;
  timeline: WeatherDay[];
  firms: FireSummary | null;
  nearbyFireEvents: NearbyEvent[];
  onLand: boolean | null;
  hasForecast: boolean;
  today: string;
}

const meanOf = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/**
 * Transparent fire-danger index (0-100), NOT a probability. See docs/METHODOLOGY.md.
 * score = 100 * (0.45*weather + 0.35*fuelDryness + 0.20*ignition) * (0.35 + 0.65*fuelAvailability)
 */
export function assessWildfire(i: WildfireInput): HazardAssessment {
  const base = { hazard: 'wildfire' as const };
  if (i.onLand === false) {
    return { ...base, available: false, unavailableReason: 'Open water - wildfire risk not applicable.', tier: 'Low', peakScore: 0, peakDate: i.today, todayScore: 0, confidence: 'high', summary: 'This point is over open water.', daily: [], drivers: [], caveats: [] };
  }
  if (!i.timeline.length || (!i.obs.length && !i.clim && !i.hasForecast)) {
    return { ...base, available: false, unavailableReason: 'Weather and land-surface data were unavailable.', tier: 'Low', peakScore: 0, peakDate: i.today, todayScore: 0, confidence: 'low', summary: 'Not enough data to assess wildfire danger right now.', daily: [], drivers: [], caveats: [] };
  }

  const monthIdx = Number(i.today.slice(5, 7)) - 1;
  const climP = i.clim?.precipMmDay[monthIdx] ?? null;

  // Fuel availability: arid land (<100 mm/yr) cannot sustain large fires; >=500 mm/yr is fully fuel-rich.
  const annual = i.clim?.annualPrecipMm ?? null;
  const fuelAvail = annual === null ? 0.7 : clamp01((annual - 100) / 400);

  // Antecedent dryness from observed soil wetness and 30-day rainfall deficit.
  const soilVals = i.obs.slice(-10).map((d) => (d.soilTop !== null && d.soilRoot !== null ? 0.5 * d.soilTop + 0.5 * d.soilRoot : d.soilRoot ?? d.soilTop));
  const soilWet = meanOf(soilVals);
  const precipDays = i.obs.map((d) => d.precip).filter((x): x is number => x !== null);
  const p30 = precipDays.length >= 10 ? (precipDays.reduce((a, b) => a + b, 0) * 30) / precipDays.length : null;
  const expected30 = climP !== null ? Math.max(5, climP * 30) : null;
  const deficit = p30 !== null && expected30 !== null ? clamp01(1 - p30 / expected30) : null;
  const parts: number[] = [];
  const weights: number[] = [];
  if (soilWet !== null) { parts.push(1 - soilWet); weights.push(0.55); }
  if (deficit !== null) { parts.push(deficit); weights.push(0.45); }
  const wsum = weights.reduce((a, b) => a + b, 0);
  let dryness = wsum ? parts.reduce((a, p, k) => a + p * weights[k], 0) / wsum : 0.5;

  // Ignition pressure from satellite fire detections and open NASA EONET wildfire events.
  let ignition = 0;
  if (i.firms) ignition = clamp01(Math.log10(1 + i.firms.count) / 2);
  const nearestEvent = i.nearbyFireEvents.length ? Math.min(...i.nearbyFireEvents.map((e) => e.distanceKm)) : null;
  if (nearestEvent !== null) ignition = Math.max(ignition, nearestEvent <= 25 ? 1 : nearestEvent <= 100 ? 0.6 : 0.3);

  const daily: DailyRisk[] = [];
  let peakWeather = { tmax: -Infinity, rh: Infinity, wind: 0 };
  i.timeline.forEach((w, idx) => {
    const heat = w.tmax === null ? 0.3 : clamp01((w.tmax - 15) / 25);
    const dryAir = w.rh === null ? 0.3 : clamp01((65 - w.rh) / 45);
    const wind = w.wind === null ? 0.2 : clamp01(w.wind / 12);
    let weather = 0.4 * dryAir + 0.35 * heat + 0.25 * wind;
    if (w.precip >= 10) weather *= 0.25;
    else if (w.precip >= 5) weather *= 0.5;
    // Fuel dries with heat, wets with rain.
    dryness = clamp01(dryness + 0.01 * heat - Math.min(0.5, 0.025 * w.precip));
    const ign = ignition * Math.exp(-idx / 10);
    const raw = (0.45 * weather + 0.35 * dryness + 0.2 * ign) * (0.35 + 0.65 * fuelAvail);
    const score = round(100 * clamp01(raw));
    const half = bandHalfWidth(w.skill);
    daily.push({ date: w.date, score, low: Math.max(0, round(score - half)), high: Math.min(100, round(score + half)) });
    if (w.tmax !== null) peakWeather.tmax = Math.max(peakWeather.tmax, w.tmax);
    if (w.rh !== null) peakWeather.rh = Math.min(peakWeather.rh, w.rh);
    if (w.wind !== null) peakWeather.wind = Math.max(peakWeather.wind, w.wind);
  });

  const peak = daily.reduce((a, b) => (b.score > a.score ? b : a), daily[0]);
  const drivers: Driver[] = [];
  if (p30 !== null && expected30 !== null) drivers.push({ label: '30-day rainfall vs normal', value: `${Math.round(p30)} mm of ~${Math.round(expected30)} mm (${Math.round((p30 / expected30) * 100)}%)`, source: 'NASA POWER' });
  if (soilWet !== null) drivers.push({ label: 'Soil wetness (surface + root zone)', value: `${Math.round(soilWet * 100)}%`, source: 'NASA POWER' });
  if (Number.isFinite(peakWeather.tmax)) drivers.push({ label: 'Hottest day in outlook', value: `${round(peakWeather.tmax)} °C`, source: i.hasForecast ? 'Open-Meteo forecast + NASA POWER climatology' : 'NASA POWER climatology' });
  if (Number.isFinite(peakWeather.rh)) drivers.push({ label: 'Driest-air day in outlook', value: `${Math.round(peakWeather.rh)}% mean RH`, source: i.hasForecast ? 'Open-Meteo forecast' : 'NASA POWER' });
  if (i.firms) drivers.push({ label: `Satellite fire detections within ${i.firms.radiusKm} km (${i.firms.days} d)`, value: `${i.firms.count}${i.firms.nearestKm !== null ? `, nearest ${i.firms.nearestKm} km` : ''}`, source: 'NASA FIRMS VIIRS' });
  if (nearestEvent !== null) drivers.push({ label: 'Open wildfire events nearby', value: `${i.nearbyFireEvents.length} within 500 km, nearest ${nearestEvent} km`, source: 'NASA EONET' });
  if (annual !== null) drivers.push({ label: 'Fuel availability proxy (annual rainfall)', value: `${Math.round(annual)} mm/yr -> ${Math.round(fuelAvail * 100)}%`, source: 'NASA POWER climatology' });

  const caveats = [
    'Index of fire-weather danger, not a probability of ignition or burned area.',
    'No land-cover or vegetation-moisture data: fuel is approximated from rainfall climatology.',
  ];
  if (!i.hasForecast) caveats.push('Numerical forecast unavailable: days beyond today rely on NASA climatology and recent anomalies.');
  if (i.firms === null) caveats.push('Satellite fire-detection (FIRMS) data not included; set FIRMS_MAP_KEY for ignition pressure.');

  const conf: Confidence = i.obs.length && i.hasForecast ? 'medium' : i.obs.length || i.hasForecast ? 'medium' : 'low';
  const confidence: Confidence = i.obs.length && i.hasForecast && i.firms ? 'high' : conf;
  const tier = tierFor(peak.score);
  return {
    ...base,
    available: true,
    tier,
    peakScore: peak.score,
    peakDate: peak.date,
    todayScore: daily[0].score,
    confidence,
    summary: `${tier} wildfire danger; highest on ${peak.date} (${peak.score}/100). ${ignition > 0.5 ? 'Active fires are already burning nearby. ' : ''}${dryness > 0.6 ? 'Vegetation is likely dry.' : ''}`.trim(),
    daily,
    drivers,
    caveats,
  };
}

export { HORIZON_DAYS };
