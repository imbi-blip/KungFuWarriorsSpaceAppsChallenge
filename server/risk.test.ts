import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from './risk/weather.ts';
import { assessWildfire } from './risk/wildfire.ts';
import { assessFlood } from './risk/flood.ts';
import { assessTsunami, rjExpected, elevationExposure } from './risk/tsunami.ts';
import { addDays, tierFor, maxTier } from './risk/util.ts';
import type { PowerClimatology, PowerDay } from './providers/nasaPower.ts';
import type { ForecastDay } from './providers/openMeteo.ts';
import type { QuakeBrief } from '../shared/types.ts';

const today = '2026-08-10';
const clim = (precipMmDay: number, tmax: number, rh: number, annual: number): PowerClimatology => ({
  precipMmDay: Array(12).fill(precipMmDay), tmax: Array(12).fill(tmax), rh: Array(12).fill(rh), wind: Array(12).fill(3), annualPrecipMm: annual,
});
const obsDays = (n: number, f: (i: number) => Partial<PowerDay>): PowerDay[] =>
  Array.from({ length: n }, (_, i) => ({ date: addDays(today, i - n), precip: 0, tmax: 30, rh: 40, wind: 3, soilTop: 0.5, soilRoot: 0.5, ...f(i) }));
const fcDays = (f: (i: number) => Partial<ForecastDay>): ForecastDay[] =>
  Array.from({ length: 16 }, (_, i) => ({ date: addDays(today, i), tmax: 30, rh: 40, wind: 5, precip: 0, ...f(i) }));

test('timeline: forecast days then climatology, 20 rows, skill decays', () => {
  const t = buildTimeline({ today, obs: obsDays(10, () => ({})), forecast: fcDays(() => ({})), clim: clim(2, 25, 60, 800) });
  assert.equal(t.length, 20);
  assert.equal(t[0].basis, 'forecast');
  assert.equal(t[15].basis, 'forecast');
  assert.equal(t[16].basis, 'climatology');
  assert.ok(t[0].skill > t[15].skill && t[15].skill > t[19].skill);
});

const wildfire = (o: { obs: PowerDay[]; fc: ForecastDay[] | null; c: PowerClimatology | null; firmsCount?: number }) =>
  assessWildfire({ obs: o.obs, clim: o.c, timeline: buildTimeline({ today, obs: o.obs, forecast: o.fc, clim: o.c }), firms: o.firmsCount === undefined ? null : { count: o.firmsCount, totalFrpMw: 0, maxFrpMw: 0, nearestKm: 3, radiusKm: 50, days: 3 }, nearbyFireEvents: [], onLand: true, hasForecast: !!o.fc, today });

test('wildfire: hot, dry, windy, rainless, fuel-rich land with active fires scores High+', () => {
  const r = wildfire({ obs: obsDays(30, () => ({ soilTop: 0.08, soilRoot: 0.12, tmax: 36, rh: 22 })), fc: fcDays(() => ({ tmax: 38, rh: 18, wind: 14 })), c: clim(1.5, 30, 45, 600), firmsCount: 80 });
  assert.ok(r.peakScore >= 60, `score ${r.peakScore}`);
  assert.equal(r.daily.length, 20);
});

test('wildfire: cool rainy wet landscape scores Low', () => {
  const r = wildfire({ obs: obsDays(30, () => ({ precip: 8, soilTop: 0.9, soilRoot: 0.85, tmax: 12, rh: 85 })), fc: fcDays(() => ({ tmax: 11, rh: 88, wind: 3, precip: 7 })), c: clim(4, 12, 80, 1500) });
  assert.equal(r.tier, 'Low');
});

test('wildfire: desert is damped by fuel availability; rain suppresses risk', () => {
  const hot = { obs: obsDays(30, () => ({ soilTop: 0.05, soilRoot: 0.05, tmax: 42, rh: 12 })), fc: fcDays(() => ({ tmax: 43, rh: 10, wind: 10 })) };
  const desert = wildfire({ ...hot, c: clim(0.1, 40, 15, 40) });
  const forest = wildfire({ ...hot, c: clim(1.5, 30, 45, 800) });
  assert.ok(desert.peakScore < forest.peakScore - 20, `${desert.peakScore} vs ${forest.peakScore}`);
  const rainy = wildfire({ ...hot, fc: fcDays(() => ({ tmax: 43, rh: 10, wind: 10, precip: 15 })), c: clim(1.5, 30, 45, 800) });
  assert.ok(rainy.peakScore < forest.peakScore);
});

test('wildfire: ocean and no-data cases are marked unavailable, not zero-risk', () => {
  const t = buildTimeline({ today, obs: [], forecast: null, clim: null });
  const ocean = assessWildfire({ obs: [], clim: null, timeline: t, firms: null, nearbyFireEvents: [], onLand: false, hasForecast: false, today });
  assert.equal(ocean.available, false);
  const nodata = assessWildfire({ obs: [], clim: null, timeline: t, firms: null, nearbyFireEvents: [], onLand: true, hasForecast: false, today });
  assert.equal(nodata.available, false);
  assert.equal(nodata.confidence, 'low');
});

const flood = (o: { obs: PowerDay[]; fc: ForecastDay[] | null; c: PowerClimatology | null; dis?: { date: string; q: number | null }[] | null; evt?: number }) =>
  assessFlood({ obs: o.obs, clim: o.c, timeline: buildTimeline({ today, obs: o.obs, forecast: o.fc, clim: o.c }), discharge: o.dis ?? null, nearbyFloodEvents: o.evt === undefined ? [] : [{ id: 'e', title: 't', category: 'floods', lat: 0, lon: 0, date: today, distanceKm: o.evt, url: null }], onLand: true, hasForecast: !!o.fc, today });

test('flood: extreme forecast rain on saturated soil is Extreme; same rain on dry soil is lower', () => {
  const storm = fcDays((i) => ({ precip: i === 3 || i === 4 ? 70 : 0 }));
  const wet = flood({ obs: obsDays(30, () => ({ soilTop: 0.95, soilRoot: 0.9, precip: 6 })), fc: storm, c: clim(2.5, 25, 60, 900) });
  const dry = flood({ obs: obsDays(30, () => ({ soilTop: 0.1, soilRoot: 0.1 })), fc: storm, c: clim(2.5, 25, 60, 900) });
  assert.equal(wet.tier, 'Extreme');
  assert.ok(dry.peakScore < wet.peakScore || dry.peakScore === 100);
  assert.ok(['3', '4', '5'].some((d) => wet.peakDate.endsWith(`-${String(10 + Number(d)).padStart(2, '0')}`)), wet.peakDate);
});

test('flood: no rain is Low; rising river discharge and nearby events raise score', () => {
  const quiet = flood({ obs: obsDays(30, () => ({ soilTop: 0.4, soilRoot: 0.4 })), fc: fcDays(() => ({})), c: clim(1, 25, 60, 500) });
  assert.equal(quiet.tier, 'Low');
  const dis = Array.from({ length: 50 }, (_, i) => ({ date: addDays(today, i - 30), q: i < 30 ? 100 : i === 33 ? 900 : 120 }));
  const rising = flood({ obs: obsDays(30, () => ({ soilTop: 0.4, soilRoot: 0.4 })), fc: fcDays(() => ({})), c: clim(1, 25, 60, 500), dis });
  assert.ok(rising.peakScore > quiet.peakScore + 30);
  const evt = flood({ obs: obsDays(30, () => ({ soilTop: 0.4, soilRoot: 0.4 })), fc: fcDays(() => ({})), c: clim(1, 25, 60, 500), evt: 40 });
  assert.ok(evt.todayScore > quiet.todayScore + 30);
});

test('Reasenberg-Jones: matches closed form and decays with time', () => {
  // N = 10^(a+b(Mm-M)) * ((t2+c)^(1-p)-(t1+c)^(1-p))/(1-p)
  const manual = 10 ** (-1.67 + 0.91 * 0.8) * (((20.05) ** -0.08 - (0.05) ** -0.08) / -0.08);
  assert.ok(Math.abs(rjExpected(7.8, 7, 0, 20) - manual) < 1e-9);
  assert.ok(rjExpected(7.8, 7, 0, 1) > rjExpected(7.8, 7, 10, 11));
  assert.ok(rjExpected(7.8, 7, 0, 20) > rjExpected(7, 7, 0, 20));
  const p = 1 - Math.exp(-rjExpected(7.8, 7, 0.5, 20.5));
  assert.ok(p > 0.15 && p < 0.9, `P=${p}`); // plausible aftershock probability for a fresh M7.8
});

const now = new Date('2026-08-10T12:00:00Z');
const quake = (mag: number, hoursAgo: number, distanceKm: number, extra: Partial<QuakeBrief> = {}): QuakeBrief => ({ id: 'q', mag, place: 'Offshore', time: new Date(now.getTime() - hoursAgo * 3600_000).toISOString(), depthKm: 20, distanceKm, tsunamiFlag: false, url: null, ...extra });
const tsu = (o: Partial<Parameters<typeof assessTsunami>[0]>) => assessTsunami({ recentQuakes: [], bgCount: 20, bgSinceYear: 1990, elevationM: 5, onLand: true, now, today, ...o });

test('tsunami: fresh large offshore quake flags official-alert hint, high tier and decaying curve', () => {
  const r = tsu({ recentQuakes: [quake(7.8, 5, 150, { tsunamiFlag: true })] });
  assert.equal(r.tsunami!.officialAlertHint, true);
  assert.ok(['High', 'Extreme'].includes(r.tier));
  assert.ok(r.daily[0].score >= r.daily[19].score);
  assert.ok(r.tsunami!.sequenceProb20d > 0.05);
});

test('tsunami: elevation and distance scale the score; inland high ground is Low', () => {
  const q = [quake(7.2, 48, 100)];
  const coast = tsu({ recentQuakes: q, elevationM: 3 });
  const hills = tsu({ recentQuakes: q, elevationM: 400 });
  assert.ok(coast.peakScore > hills.peakScore * 5);
  assert.equal(hills.tier, 'Low');
  const far = tsu({ recentQuakes: [quake(7.2, 48, 1400)], elevationM: 3 });
  assert.ok(far.tsunami!.sequenceProb20d < coast.tsunami!.sequenceProb20d);
  assert.ok(elevationExposure(null, null) > 0 && elevationExposure(true, 5) === 1);
});

test('tsunami: quiet region -> Low; deep quakes do not count; missing data degrades gracefully', () => {
  assert.equal(tsu({ recentQuakes: [], bgCount: 0 }).tier, 'Low');
  const deep = tsu({ recentQuakes: [quake(7.5, 24, 100, { depthKm: 400 })], bgCount: 0 });
  assert.equal(deep.tsunami!.sequenceProb20d, 0);
  const partial = tsu({ recentQuakes: null });
  assert.equal(partial.available, true);
  assert.equal(partial.confidence, 'low');
  assert.equal(tsu({ recentQuakes: null, bgCount: null }).available, false);
});

test('tier helpers', () => {
  assert.equal(tierFor(0), 'Low');
  assert.equal(tierFor(39.9), 'Moderate');
  assert.equal(tierFor(80), 'Extreme');
  assert.equal(maxTier(['Low', 'High', 'Moderate']), 'High');
});
