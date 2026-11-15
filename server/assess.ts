import { HORIZON_DAYS, type DataSource, type LocationInfo, type NearbyEvent, type RiskReport, type LiveEvent } from '../shared/types.ts';
import { ruleBasedBriefing } from './agent/briefing.ts';
import { TtlCache } from './net/cache.ts';
import { settle, type Settled } from './net/upstream.ts';
import type { GeocodeProvider } from './providers/geocode.ts';
import { eonetUrl, type NasaEonetProvider } from './providers/nasaEonet.ts';
import type { NasaFirmsProvider } from './providers/nasaFirms.ts';
import type { NasaPowerProvider } from './providers/nasaPower.ts';
import type { OpenMeteoProvider } from './providers/openMeteo.ts';
import type { UsgsProvider } from './providers/usgs.ts';
import { assessFlood } from './risk/flood.ts';
import { assessTsunami } from './risk/tsunami.ts';
import { assessWildfire } from './risk/wildfire.ts';
import { buildTimeline } from './risk/weather.ts';
import { haversineKm, isoDate, maxTier } from './risk/util.ts';
import { getGuidance } from './safety/guidance.ts';
import { getSafetyInfo } from './safety/emergencyDirectory.ts';

export interface Providers {
  power: NasaPowerProvider;
  eonet: NasaEonetProvider;
  firms: NasaFirmsProvider | null;
  usgs: UsgsProvider;
  meteo: OpenMeteoProvider | null;
  geocoder: GeocodeProvider;
}

export const DISCLAIMER =
  'Experimental risk outlook built from satellite, weather and earthquake data. It is NOT an official forecast or warning. Always follow instructions from your local emergency authorities.';

const HOUR = 3600_000;
const BG_SINCE = 1990;

export class RiskService {
  private readonly p: Providers;
  private readonly now: () => Date;
  private readonly reports = new TtlCache<Omit<RiskReport, 'briefing' | 'aiAvailable'>>(500);
  private readonly geo = new TtlCache<LocationInfo>(5000);
  private readonly events = new TtlCache<LiveEvent[]>(4);
  private readonly counts = new TtlCache<number>(2000);

  constructor(p: Providers, now: () => Date = () => new Date()) {
    this.p = p;
    this.now = now;
  }

  liveEvents(): Promise<LiveEvent[]> {
    return this.events.getOrLoad('open', 30 * 60_000, () => this.p.eonet.openEvents(), 60_000);
  }

  /** Core pipeline: gather upstream data in parallel, tolerate partial failure, run the three models. */
  async assess(lat: number, lon: number): Promise<Omit<RiskReport, 'briefing' | 'aiAvailable'>> {
    const key = `${(Math.round(lat * 20) / 20).toFixed(2)},${(Math.round(lon * 20) / 20).toFixed(2)}`;
    return this.reports.getOrLoad(key, 30 * 60_000, () => this.compute(lat, lon), 20_000);
  }

  private async compute(lat: number, lon: number): Promise<Omit<RiskReport, 'briefing' | 'aiAvailable'>> {
    const now = this.now();
    const today = isoDate(now);
    const p = this.p;
    const geoKey = `${Math.round(lat * 20) / 20},${Math.round(lon * 20) / 20}`;
    const bgKey = `${Math.round(lat)},${Math.round(lon)}`;
    const since30 = isoDate(new Date(now.getTime() - 30 * 86400000));

    const [geo, obs, clim, fc, dis, elev, evts, firms, recentQ, bg] = await Promise.all([
      settle(this.geo.getOrLoad(geoKey, 30 * 24 * HOUR, () => p.geocoder.reverse(lat, lon), 120_000)),
      settle(p.power.dailyObservations(lat, lon, today)),
      settle(p.power.climatology(lat, lon)),
      p.meteo ? settle(p.meteo.forecast(lat, lon)) : Promise.resolve<Settled<never>>({ ok: false, error: 'skipped' }),
      p.meteo ? settle(p.meteo.discharge(lat, lon)) : Promise.resolve<Settled<never>>({ ok: false, error: 'skipped' }),
      p.meteo ? settle(p.meteo.elevation(lat, lon)) : Promise.resolve<Settled<never>>({ ok: false, error: 'skipped' }),
      settle(this.liveEvents()),
      p.firms ? settle(p.firms.fires(lat, lon)) : Promise.resolve<Settled<never>>({ ok: false, error: 'skipped' }),
      settle(p.usgs.recent(lat, lon, 1500, since30, 5.5)),
      settle(this.counts.getOrLoad(bgKey, 24 * HOUR, () => p.usgs.count(lat, lon, 1000, `${BG_SINCE}-01-01`, 7), 120_000)),
    ]);

    const location: LocationInfo = geo.ok ? { ...geo.value, lat, lon } : { lat, lon, countryCode: null, country: null, place: null, onLand: null };
    const obsDays = obs.ok ? obs.value : [];
    const climV = clim.ok ? clim.value : null;
    const forecast = fc.ok ? fc.value : null;
    const timeline = buildTimeline({ today, obs: obsDays, forecast, clim: climV });
    const hasForecast = !!forecast && forecast.length > 0;

    const nearby: NearbyEvent[] = (evts.ok ? evts.value : [])
      .map((e) => ({ id: e.id, title: e.title, category: e.category, lat: e.lat, lon: e.lon, date: e.date, distanceKm: Math.round(haversineKm(lat, lon, e.lat, e.lon)), url: eonetUrl(e.id) }))
      .filter((e) => e.distanceKm <= 500)
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, 12);

    const wildfire = assessWildfire({ obs: obsDays, clim: climV, timeline, firms: firms.ok ? firms.value : null, nearbyFireEvents: nearby.filter((e) => e.category === 'wildfires'), onLand: location.onLand, hasForecast, today });
    const flood = assessFlood({ obs: obsDays, clim: climV, timeline, discharge: dis.ok ? dis.value : null, nearbyFloodEvents: nearby.filter((e) => e.category === 'floods'), onLand: location.onLand, hasForecast, today });
    const tsunami = assessTsunami({ recentQuakes: recentQ.ok ? recentQ.value : null, bgCount: bg.ok ? bg.value : null, bgSinceYear: BG_SINCE, elevationM: elev.ok ? elev.value : null, onLand: location.onLand, now, today });
    const hazards = [wildfire, flood, tsunami];

    const st = (s: Settled<unknown>, nasa: boolean, name: string, provider: string, note?: string): DataSource => ({
      name,
      provider,
      nasa,
      status: s.ok ? 'ok' : s.error === 'skipped' ? 'skipped' : 'unavailable',
      note: s.ok ? undefined : s.error === 'skipped' ? note : `failed (${s.error})`,
    });
    const dataSources: DataSource[] = [
      st(obs, true, 'Daily rainfall, soil wetness, temperature, humidity, wind (past 30 d)', 'NASA POWER'),
      st(clim, true, '1991-2020 climatology', 'NASA POWER'),
      st(evts, true, 'Open wildfire / flood / storm / volcano events', 'NASA EONET'),
      st(firms, true, 'Active-fire detections (VIIRS)', 'NASA FIRMS', 'Set FIRMS_MAP_KEY to enable'),
      st(fc, false, '16-day weather forecast', 'Open-Meteo', 'Disabled'),
      st(dis, false, 'River discharge forecast (GloFAS)', 'Open-Meteo Flood', 'Disabled'),
      st(elev, false, 'Elevation', 'Open-Meteo', 'Disabled'),
      st(recentQ, false, 'Recent earthquakes (30 d)', 'USGS'),
      st(bg, false, 'Long-term seismicity rate', 'USGS'),
      st(geo, false, 'Place and country lookup', 'OpenStreetMap Nominatim'),
    ];

    const safety = getSafetyInfo(location.countryCode);
    const guidance = [...hazards].filter((h) => h.available).sort((a, b) => b.peakScore - a.peakScore).map((h) => getGuidance(h.hazard, h.tier));

    return {
      generatedAt: now.toISOString(),
      horizonDays: HORIZON_DAYS,
      location,
      overallTier: maxTier(hazards.filter((h) => h.available).map((h) => h.tier)),
      hazards,
      nearbyEvents: nearby,
      safety,
      guidance,
      dataSources,
      disclaimer: DISCLAIMER,
    };
  }

  static withBriefing(r: Omit<RiskReport, 'briefing' | 'aiAvailable'>, aiAvailable: boolean): RiskReport {
    return { ...r, briefing: { text: ruleBasedBriefing(r), source: 'rules' }, aiAvailable };
  }
}
