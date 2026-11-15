import { RiskService } from '../assess.ts';
import { UpstreamClient, UPSTREAM_HOSTS } from '../net/upstream.ts';
import { GeocodeProvider } from '../providers/geocode.ts';
import { NasaEonetProvider } from '../providers/nasaEonet.ts';
import { NasaFirmsProvider } from '../providers/nasaFirms.ts';
import { NasaPowerProvider } from '../providers/nasaPower.ts';
import { OpenMeteoProvider } from '../providers/openMeteo.ts';
import { UsgsProvider } from '../providers/usgs.ts';

// Offline fixtures that mimic the response shapes of NASA POWER / EONET / FIRMS, USGS, Open-Meteo and Nominatim.
// Used by the test-suite and by `npm run demo:offline`.
export const NOW = new Date('2026-11-13T12:00:00Z');
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const monthly = (v: number) => ({ ...Object.fromEntries(MONTHS.map((m) => [m, v])), ANN: v });
const compact = (d: string) => d.replaceAll('-', '');

/** Fake upstream world: routes by hostname and returns shapes matching the real APIs. Records every requested URL. */
export function fakeWorld(opts: { failHosts?: string[]; firmsCsv?: string } = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (input: URL | string) => {
    const u = new URL(String(input));
    urls.push(String(input));
    if (opts.failHosts?.includes(u.hostname)) return new Response('boom', { status: 503 });
    const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
    if (u.hostname === 'power.larc.nasa.gov') {
      if (u.pathname.includes('climatology')) return json({ properties: { parameter: { PRECTOTCORR: monthly(1.2), T2M_MAX: monthly(24), RH2M: monthly(55), WS2M: monthly(3) } } });
      const days = Array.from({ length: 31 }, (_, i) => new Date(NOW.getTime() - (30 - i) * 86400000).toISOString().slice(0, 10));
      const p = (v: number) => Object.fromEntries(days.map((d) => [compact(d), v]));
      return json({ properties: { parameter: { PRECTOTCORR: p(0.1), T2M_MAX: p(33), RH2M: p(25), WS2M: p(4), GWETTOP: p(0.1), GWETROOT: p(0.15) } } });
    }
    if (u.hostname === 'eonet.gsfc.nasa.gov') return json({ events: [{ id: 'EONET_9', title: 'Test Fire', categories: [{ id: 'wildfires' }], geometry: [{ date: '2026-11-12T00:00:00Z', type: 'Point', coordinates: [73.1, 33.7] }] }] });
    if (u.hostname === 'firms.modaps.eosdis.nasa.gov') return new Response(opts.firmsCsv ?? 'latitude,longitude,frp,confidence\n33.70,73.05,20,h\n');
    if (u.hostname === 'earthquake.usgs.gov') return u.pathname.endsWith('/count') ? json({ count: 14, maxAllowed: 20000 }) : json({ features: [] });
    if (u.hostname === 'api.open-meteo.com') {
      if (u.pathname.includes('elevation')) return json({ elevation: [540] });
      const dates = Array.from({ length: 16 }, (_, i) => new Date(NOW.getTime() + i * 86400000).toISOString().slice(0, 10));
      return json({ daily: { time: dates, temperature_2m_max: dates.map(() => 34), wind_speed_10m_max: dates.map(() => 9), precipitation_sum: dates.map(() => 0) }, hourly: { time: dates.map((d) => `${d}T12:00`), relative_humidity_2m: dates.map(() => 20) } });
    }
    if (u.hostname === 'flood-api.open-meteo.com') return json({ daily: { time: ['2026-11-13'], river_discharge: [5] } });
    if (u.hostname === 'nominatim.openstreetmap.org') return json({ address: { city: 'Islamabad', state: 'Islamabad Capital Territory', country: 'Pakistan', country_code: 'pk' } });
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, urls };
}

export function buildRisk(world: ReturnType<typeof fakeWorld>) {
  const up = new UpstreamClient({ allowedHosts: UPSTREAM_HOSTS, userAgent: 'test', fetchImpl: world.fetchImpl });
  const geo = new GeocodeProvider(up, 'https://nominatim.openstreetmap.org/reverse');
  return new RiskService({ power: new NasaPowerProvider(up), eonet: new NasaEonetProvider(up), firms: new NasaFirmsProvider(up, 'abcdefabcdefabcdefabcdef'), usgs: new UsgsProvider(up), meteo: new OpenMeteoProvider(up), geocoder: geo }, () => NOW);
}

