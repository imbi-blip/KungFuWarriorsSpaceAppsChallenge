// Live smoke test of every upstream. Run on a machine with internet: `npm run check:providers`
// Validates that real NASA/USGS/Open-Meteo/Nominatim responses still match what the parsers expect.
import { loadEnvFiles, loadConfig } from '../server/config.ts';
import { UpstreamClient, UPSTREAM_HOSTS } from '../server/net/upstream.ts';
import { NasaPowerProvider } from '../server/providers/nasaPower.ts';
import { NasaEonetProvider } from '../server/providers/nasaEonet.ts';
import { NasaFirmsProvider } from '../server/providers/nasaFirms.ts';
import { UsgsProvider } from '../server/providers/usgs.ts';
import { OpenMeteoProvider } from '../server/providers/openMeteo.ts';
import { GeocodeProvider } from '../server/providers/geocode.ts';
import { isoDate } from '../server/risk/util.ts';

loadEnvFiles();
const cfg = loadConfig();
const up = new UpstreamClient({ allowedHosts: [...UPSTREAM_HOSTS], userAgent: 'EarthJukebox-check/1.0' });
const [lat, lon] = [35.68, 139.69]; // Tokyo: land, coast, seismically active
const today = isoDate(new Date());
let failed = 0;
const run = async (name: string, f: () => Promise<unknown>, detail: (r: any) => string) => {
  try {
    console.log(`PASS ${name}: ${detail(await f())}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : e}`);
  }
};
const power = new NasaPowerProvider(up);
const meteo = new OpenMeteoProvider(up);
const usgs = new UsgsProvider(up);
await run('NASA POWER daily', () => power.dailyObservations(lat, lon, today), (r) => `${r.length} days, last precip=${r.at(-3)?.precip}`);
await run('NASA POWER climatology', () => power.climatology(lat, lon), (r) => `annual precip ${Math.round(r.annualPrecipMm)} mm`);
await run('NASA EONET', () => new NasaEonetProvider(up).openEvents(), (r) => `${r.length} open events`);
if (cfg.firmsMapKey) await run('NASA FIRMS', () => new NasaFirmsProvider(up, cfg.firmsMapKey!).fires(lat, lon, 200, 3), (r) => `${r.count} detections within ${r.radiusKm} km`);
else console.log('SKIP NASA FIRMS (no FIRMS_MAP_KEY)');
await run('USGS recent', () => usgs.recent(lat, lon, 1500, isoDate(new Date(Date.now() - 30 * 864e5)), 5.5), (r) => `${r.length} quakes M5.5+ in 30 d`);
await run('USGS count', () => usgs.count(lat, lon, 1000, '1990-01-01', 7), (r) => `${r} M7+ since 1990`);
await run('Open-Meteo forecast', () => meteo.forecast(lat, lon), (r) => `${r.length} days, rh0=${r[0]?.rh?.toFixed(0)}`);
await run('Open-Meteo flood', () => meteo.discharge(lat, lon), (r) => `${r.length} points`);
await run('Open-Meteo elevation', () => meteo.elevation(lat, lon), (r) => `${r} m`);
await run('Geocoder', () => new GeocodeProvider(up, cfg.geocoderUrl).reverse(lat, lon), (r) => `${r.place} (${r.countryCode})`);
process.exit(failed ? 1 : 0);
