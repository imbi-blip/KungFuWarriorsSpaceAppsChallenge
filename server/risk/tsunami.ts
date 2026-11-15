import { HORIZON_DAYS, type DailyRisk, type Driver, type HazardAssessment, type QuakeBrief } from '../../shared/types.ts';
import { addDays, bandHalfWidth, clamp01, round, tierFor } from './util.ts';

// Generic Reasenberg & Jones (1989) aftershock parameters.
export const RJ = { a: -1.67, b: 0.91, p: 1.08, c: 0.05 } as const;

/** Expected number of aftershocks >= targetMag between t1 and t2 days after a mainshock of magnitude mainMag. */
export function rjExpected(mainMag: number, targetMag: number, t1: number, t2: number): number {
  const { a, b, p, c } = RJ;
  const integral = ((t2 + c) ** (1 - p) - (t1 + c) ** (1 - p)) / (1 - p);
  return 10 ** (a + b * (mainMag - targetMag)) * integral;
}

export function elevationExposure(onLand: boolean | null, elevationM: number | null): number {
  if (onLand === false) return 0.6; // offshore: waves small in deep water but dangerous near coast
  if (elevationM === null) return 0.6;
  if (elevationM <= 10) return 1;
  if (elevationM <= 30) return 0.75;
  if (elevationM <= 60) return 0.45;
  if (elevationM <= 120) return 0.2;
  return 0.05;
}

const probToScore = (p: number): number => {
  const lo = Math.log10(0.002);
  const hi = Math.log10(0.15);
  return 100 * clamp01((Math.log10(Math.max(p, 1e-9)) - lo) / (hi - lo));
};

export interface TsunamiInput {
  recentQuakes: QuakeBrief[] | null; // within 1500 km, last 30 days, M>=5.5
  bgCount: number | null; // M>=7 within 1000 km since bgSinceYear
  bgSinceYear: number;
  elevationM: number | null;
  onLand: boolean | null;
  now: Date;
  today: string;
}

export function assessTsunami(i: TsunamiInput): HazardAssessment {
  const base = { hazard: 'tsunami' as const };
  if (i.recentQuakes === null && i.bgCount === null) {
    return { ...base, available: false, unavailableReason: 'Earthquake catalogue unavailable.', tier: 'Low', peakScore: 0, peakDate: i.today, todayScore: 0, confidence: 'low', summary: 'Not enough data to assess tsunami exposure right now.', daily: [], drivers: [], caveats: [] };
  }
  const exposure = elevationExposure(i.onLand, i.elevationM);
  const years = Math.max(1, (i.now.getTime() - Date.UTC(i.bgSinceYear, 0, 1)) / (365.25 * 86400000));
  const bgPerDay = i.bgCount !== null ? i.bgCount / years / 365.25 : 0;

  const seq = (i.recentQuakes ?? []).filter((q) => q.mag >= 6 && q.depthKm <= 100);
  const tNow = i.now.getTime();
  const dailyN: number[] = [];
  const dailySeqN: number[] = [];
  for (let d = 0; d < HORIZON_DAYS; d++) {
    let nSeq = 0;
    for (const q of seq) {
      const age = Math.max(0.0007, (tNow - Date.parse(q.time)) / 86400000);
      const weight = Math.exp(-q.distanceKm / 600);
      nSeq += weight * rjExpected(q.mag, 7, age + d, age + d + 1);
    }
    dailySeqN.push(nSeq);
    dailyN.push(bgPerDay + nSeq);
  }
  const prob = (n: number) => 1 - Math.exp(-n);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const prob20 = prob(sum(dailyN));
  const bgProb20 = prob(bgPerDay * HORIZON_DAYS);
  const seqProb20 = prob(sum(dailySeqN));

  const recentTsunamiFlag = (i.recentQuakes ?? []).some((q) => q.tsunamiFlag && q.mag >= 6.5 && tNow - Date.parse(q.time) < 3 * 86400000);
  const immediate = (i.recentQuakes ?? []).some((q) => q.mag >= 7 && q.depthKm <= 100 && q.distanceKm <= 600 && tNow - Date.parse(q.time) < 86400000);
  const officialAlertHint = recentTsunamiFlag || immediate;

  const daily: DailyRisk[] = dailyN.map((n, d) => {
    const score = round(100 * exposure * (probToScore(prob(n * HORIZON_DAYS)) / 100));
    const half = bandHalfWidth(d < 3 ? 0.7 : 0.35);
    return { date: addDays(i.today, d), score, low: Math.max(0, round(score - half)), high: Math.min(100, round(score + half)) };
  });
  if (officialAlertHint) {
    // Floor the first days: an official message may be in force.
    for (let d = 0; d < Math.min(3, daily.length); d++) daily[d] = { ...daily[d], score: Math.max(daily[d].score, 70), high: 100 };
  }
  const peak = daily.reduce((a, b) => (b.score > a.score ? b : a), daily[0]);

  const drivers: Driver[] = [
    { label: 'Chance of an M7+ quake within 1000 km (20 d)', value: `${round(prob20 * 100, prob20 < 0.1 ? 1 : 0)}%`, source: 'USGS catalogue + Reasenberg-Jones model' },
    { label: 'Long-term background component', value: `${round(bgProb20 * 100, 1)}% (since ${i.bgSinceYear})`, source: 'USGS catalogue' },
    { label: 'Recent-sequence (aftershock) component', value: `${round(seqProb20 * 100, 1)}%`, source: 'USGS catalogue + Reasenberg-Jones model' },
    { label: 'Elevation / coastal exposure factor', value: `${Math.round(exposure * 100)}%${i.elevationM !== null ? ` (${Math.round(i.elevationM)} m elevation)` : ''}`, source: 'Open-Meteo elevation (SRTM-derived)' },
  ];
  const strong = (i.recentQuakes ?? []).filter((q) => q.mag >= 6.5).slice(0, 3);
  for (const q of strong) drivers.push({ label: `Recent M${q.mag} ${q.place || 'earthquake'}`, value: `${q.distanceKm} km away, ${q.time.slice(0, 10)}`, source: 'USGS' });

  const caveats = [
    'Tsunamis cannot be predicted days ahead. This estimates the chance of a large nearby earthquake (the usual trigger) and scales it by elevation exposure.',
    'NASA publishes no open real-time tsunami feed; this layer uses the USGS earthquake catalogue. Landslide, volcanic and distant-source tsunamis are not modelled.',
    'Elevation is a proxy for coastal exposure: confirm with your national tsunami hazard-zone map. Official warnings always override this estimate.',
  ];
  if (i.recentQuakes === null) caveats.push('Recent-earthquake data unavailable; only long-term rates used.');
  if (i.bgCount === null) caveats.push('Long-term seismicity rate unavailable; only recent sequences used.');
  let tier = tierFor(peak.score);
  if (officialAlertHint && (tier === 'Low' || tier === 'Moderate' || tier === 'Elevated')) tier = 'High';
  return {
    ...base,
    available: true,
    tier,
    peakScore: peak.score,
    peakDate: peak.date,
    todayScore: daily[0].score,
    confidence: i.recentQuakes !== null && i.bgCount !== null ? 'medium' : 'low',
    summary: officialAlertHint
      ? 'A large, shallow earthquake occurred recently nearby. Check official tsunami warnings immediately.'
      : `${tier} tsunami exposure: ~${round(prob20 * 100, prob20 < 0.1 ? 1 : 0)}% chance of an M7+ quake within 1000 km in the next 20 days.`,
    daily,
    drivers,
    caveats,
    tsunami: {
      exposure,
      elevationM: i.elevationM,
      prob20d: prob20,
      backgroundProb20d: bgProb20,
      sequenceProb20d: seqProb20,
      recentQuakes: (i.recentQuakes ?? []).slice(0, 5),
      officialAlertHint,
    },
  };
}
