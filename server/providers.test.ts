import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePowerDaily, parsePowerClimatology } from './providers/nasaPower.ts';
import { parseEonet } from './providers/nasaEonet.ts';
import { summariseFirmsCsv, NasaFirmsProvider } from './providers/nasaFirms.ts';
import { parseQuakes, parseCount } from './providers/usgs.ts';
import { parseForecast, parseDischarge, parseElevation } from './providers/openMeteo.ts';
import { parseReverseGeocode } from './providers/geocode.ts';
import { UpstreamClient } from './net/upstream.ts';

test('POWER daily: fill values become null, dates normalised', () => {
  const d = parsePowerDaily({ properties: { parameter: { PRECTOTCORR: { '20261110': 2.5, '20261111': -999 }, GWETROOT: { '20261110': 0.4, '20261111': 0.41 }, T2M_MAX: { '20261110': 30 } } } });
  assert.equal(d.length, 2);
  assert.deepEqual(d[0], { date: '2026-11-10', precip: 2.5, tmax: 30, rh: null, wind: null, soilTop: null, soilRoot: 0.4 });
  assert.equal(d[1].precip, null);
  assert.throws(() => parsePowerDaily({ nope: 1 }));
});

test('POWER climatology yields 12 months and annual precipitation', () => {
  const m = Object.fromEntries(['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].map((k) => [k, 2]));
  const c = parsePowerClimatology({ properties: { parameter: { PRECTOTCORR: { ...m, ANN: 2 }, T2M_MAX: m } } });
  assert.equal(c.precipMmDay.length, 12);
  assert.equal(c.annualPrecipMm, 730);
  assert.throws(() => parsePowerClimatology({ properties: { parameter: { T2M_MAX: m } } }));
});

test('EONET: points + polygon centroids parsed; hostile ids/titles are cleaned or dropped', () => {
  const ev = parseEonet({ events: [
    { id: 'EONET_1', title: 'Fire <img src=x onerror=alert(1)>\n', categories: [{ id: 'wildfires' }], geometry: [{ date: '2026-11-01T00:00:00Z', type: 'Point', coordinates: [-120, 38] }, { date: '2026-11-05T00:00:00Z', type: 'Point', coordinates: [-121, 39] }] },
    { id: 'EONET_2', title: 'Storm', categories: [{ id: 'severeStorms' }], geometry: [{ date: '2026-11-05T00:00:00Z', type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2]]] }] },
    { id: '../../etc', title: 'bad', categories: [{ id: 'floods' }], geometry: [{ date: '2026-11-05T00:00:00Z', type: 'Point', coordinates: [1, 1] }] },
    { id: 'EONET_4', title: 'oob', categories: [{ id: 'floods' }], geometry: [{ date: '2026-11-05T00:00:00Z', type: 'Point', coordinates: [500, 1] }] },
  ] });
  assert.equal(ev.length, 2);
  assert.deepEqual([ev[0].lon, ev[0].lat], [-121, 39]);
  assert.ok(!/[<>]/.test(ev[0].title));
  assert.deepEqual([ev[1].lon, ev[1].lat], [1, 1]);
});

test('FIRMS CSV summary: radius, confidence filter, bad-key text rejected', () => {
  const csv = ['latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight',
    '38.00,-120.00,340,0.4,0.4,2026-11-12,0912,N,VIIRS,n,2.0NRT,300,12.5,D',
    '38.05,-120.02,340,0.4,0.4,2026-11-12,0912,N,VIIRS,h,2.0NRT,300,30,D',
    '38.01,-120.01,340,0.4,0.4,2026-11-12,0912,N,VIIRS,l,2.0NRT,300,99,D',
    '45.00,-100.00,340,0.4,0.4,2026-11-12,0912,N,VIIRS,h,2.0NRT,300,50,D'].join('\n');
  const s = summariseFirmsCsv(csv, 38, -120, 50, 3);
  assert.equal(s.count, 2);
  assert.equal(s.totalFrpMw, 43);
  assert.equal(s.nearestKm, 0);
  assert.throws(() => summariseFirmsCsv('Invalid MAP_KEY.', 0, 0, 50, 3));
  assert.throws(() => new NasaFirmsProvider(new UpstreamClient({ allowedHosts: [], userAgent: 'x' }), 'bad key/../'));
});

test('USGS quakes and counts', () => {
  const q = parseQuakes({ features: [{ id: 'us1', properties: { mag: 7.84, place: 'Offshore X', time: Date.UTC(2026, 10, 12), tsunami: 1, url: 'https://earthquake.usgs.gov/e/us1', type: 'earthquake' }, geometry: { coordinates: [142, 38, 25] } }, { id: 'q2', properties: { mag: 5.6, time: 0, url: 'javascript:alert(1)', type: 'quarry blast' }, geometry: { coordinates: [0, 0, 1] } }] }, 38, 142);
  assert.equal(q.length, 1);
  assert.equal(q[0].tsunamiFlag, true);
  assert.equal(q[0].mag, 7.8);
  assert.equal(parseCount({ count: 12, maxAllowed: 20000 }), 12);
  assert.throws(() => parseCount({ count: 'x' }));
});

test('Open-Meteo forecast / discharge / elevation', () => {
  const f = parseForecast({ daily: { time: ['2026-11-14', '2026-11-15'], temperature_2m_max: [20, 21], wind_speed_10m_max: [5, 6], precipitation_sum: [0, 12] }, hourly: { time: ['2026-11-14T00:00', '2026-11-14T01:00'], relative_humidity_2m: [40, 60] } });
  assert.equal(f[0].rh, 50);
  assert.equal(f[1].rh, null);
  assert.equal(f[1].precip, 12);
  assert.equal(parseDischarge({ daily: { time: ['2026-11-14'], river_discharge: [12.5] } })[0].q, 12.5);
  assert.equal(parseElevation({ elevation: [534] }), 534);
});

test('Geocoder: land, ocean, and hostile strings', () => {
  const land = parseReverseGeocode({ address: { city: 'Islamabad<script>', state: 'ICT', country: 'Pakistan', country_code: 'pk' } }, 33.7, 73);
  assert.equal(land.countryCode, 'PK');
  assert.equal(land.onLand, true);
  assert.ok(!land.place!.includes('<'));
  const sea = parseReverseGeocode({ error: 'Unable to geocode' }, 0, -30);
  assert.equal(sea.onLand, false);
  assert.equal(parseReverseGeocode({ address: { country_code: 'zz9' } }, 0, 0).countryCode, null);
});
