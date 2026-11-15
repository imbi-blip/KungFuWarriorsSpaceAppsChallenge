import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampViewport,
  DEFAULT_VIEWPORT,
  getSourceRect,
  interpolateViewport,
  lonLatToScreen,
  screenToLonLat,
} from './mapProjection';

test('screenToLonLat and lonLatToScreen round-trip at zoom 1', () => {
  const { lon, lat } = screenToLonLat(0.5, 0.5, DEFAULT_VIEWPORT);
  assert.equal(lon, 0);
  assert.equal(lat, 0);

  const back = lonLatToScreen(lon, lat, DEFAULT_VIEWPORT);
  assert.equal(back.normX, 0.5);
  assert.equal(back.normY, 0.5);
  assert.equal(back.inView, true);
});

test('clampViewport keeps zoomed window inside globe bounds', () => {
  const clamped = clampViewport({ zoom: 3, centerLon: -179, centerLat: 88 });
  assert.ok(clamped.centerLon > -180 && clamped.centerLon <= -120);
  assert.ok(clamped.centerLat < 90 && clamped.centerLat >= 60);
});

test('screenToLonLat respects zoomed center and magnification', () => {
  const vp = clampViewport({ zoom: 2, centerLon: 90, centerLat: 20 });
  const center = screenToLonLat(0.5, 0.5, vp);
  assert.ok(Math.abs(center.lon - vp.centerLon) < 0.01);
  assert.ok(Math.abs(center.lat - vp.centerLat) < 0.01);

  const edgeLeft = screenToLonLat(0, 0.5, vp);
  assert.ok(Math.abs(edgeLeft.lon - (vp.centerLon - 90)) < 0.1);
});

test('getSourceRect returns full image at zoom 1 and quarter area at zoom 2', () => {
  const full = getSourceRect(320, 160, DEFAULT_VIEWPORT);
  assert.deepEqual(full, { sx: 0, sy: 0, sw: 320, sh: 160 });

  const zoomed = getSourceRect(320, 160, { zoom: 2, centerLon: 0, centerLat: 0 });
  assert.equal(zoomed.sw, 160);
  assert.equal(zoomed.sh, 80);
  assert.equal(zoomed.sx, 80);
  assert.equal(zoomed.sy, 40);
});

test('interpolateViewport converges smoothly toward target', () => {
  const mid = interpolateViewport(DEFAULT_VIEWPORT, { zoom: 3, centerLon: 100, centerLat: 30 }, 0.5);
  assert.equal(mid.zoom, 2);
  assert.equal(mid.centerLon, 50);
  assert.equal(mid.centerLat, 15);
});
