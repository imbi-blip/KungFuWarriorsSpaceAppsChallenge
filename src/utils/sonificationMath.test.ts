import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRgbaFrame,
  coordsToLatLon,
  formatPanLabel,
  formatTimestamp,
  frequencyToNoteName,
  getScaleFrequencies,
  quantizeIntensityToPitch,
} from './sonificationMath';

function makeSolidRgba(width: number, height: number, r: number, g: number, b: number, a = 255): Uint8ClampedArray {
  const arr = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    arr[i * 4] = r;
    arr[i * 4 + 1] = g;
    arr[i * 4 + 2] = b;
    arr[i * 4 + 3] = a;
  }
  return arr;
}

test('getScaleFrequencies returns sorted ascending frequencies within configured range', () => {
  const freqs = getScaleFrequencies('minorPentatonic', 196, 880);
  assert.ok(freqs.length >= 6);
  for (let i = 1; i < freqs.length; i++) {
    assert.ok(freqs[i] > freqs[i - 1], 'frequencies must strictly ascend');
  }
  assert.ok(freqs[0] >= 190 && freqs[freqs.length - 1] <= 900);
});

test('quantizeIntensityToPitch maps higher intensity to higher musical pitch', () => {
  const low = quantizeIntensityToPitch(0.05, 'lydian', 150, 600);
  const high = quantizeIntensityToPitch(0.95, 'lydian', 150, 600);
  assert.ok(high.pitchHz > low.pitchHz);
  assert.match(low.noteName, /^[A-G][#b]?\d$/);
  assert.match(high.noteName, /^[A-G][#b]?\d$/);
});

test('frequencyToNoteName identifies A4 at 440 Hz', () => {
  assert.equal(frequencyToNoteName(440), 'A4');
  assert.equal(frequencyToNoteName(261.63), 'C4');
});

test('analyzeRgbaFrame detects left vs right stereo panning accurately', () => {
  const width = 20;
  const height = 10;

  // Left-heavy bright red thermal hotspot
  const leftHot = makeSolidRgba(width, height, 5, 5, 10, 255);
  for (let y = 2; y < 8; y++) {
    for (let x = 0; x < 6; x++) {
      const idx = (y * width + x) * 4;
      leftHot[idx] = 255;
      leftHot[idx + 1] = 110;
      leftHot[idx + 2] = 20;
    }
  }
  const leftResult = analyzeRgbaFrame(leftHot, width, height, {
    scaleType: 'minorPentatonic',
    minFreq: 196,
    maxFreq: 880,
    sampleStride: 1,
  });
  assert.ok(leftResult.stereoPan < -0.25, `Expected negative pan, got ${leftResult.stereoPan}`);
  assert.ok(leftResult.centroidX < 0.4);
  assert.ok(leftResult.thermalIntensity > 0.1);

  // Right-heavy bright red thermal hotspot
  const rightHot = makeSolidRgba(width, height, 5, 5, 10, 255);
  for (let y = 2; y < 8; y++) {
    for (let x = 14; x < 20; x++) {
      const idx = (y * width + x) * 4;
      rightHot[idx] = 255;
      rightHot[idx + 1] = 110;
      rightHot[idx + 2] = 20;
    }
  }
  const rightResult = analyzeRgbaFrame(rightHot, width, height, {
    scaleType: 'minorPentatonic',
    minFreq: 196,
    maxFreq: 880,
    sampleStride: 1,
  });
  assert.ok(rightResult.stereoPan > 0.25, `Expected positive pan, got ${rightResult.stereoPan}`);
  assert.ok(rightResult.centroidX > 0.6);
});

test('analyzeRgbaFrame maps higher density to higher filter cutoff and pitch', () => {
  const dark = makeSolidRgba(16, 16, 10, 12, 18, 255);
  const bright = makeSolidRgba(16, 16, 250, 150, 40, 255);

  const darkStats = analyzeRgbaFrame(dark, 16, 16, {
    scaleType: 'majorPentatonic',
    minFreq: 140,
    maxFreq: 700,
    sampleStride: 1,
  });
  const brightStats = analyzeRgbaFrame(bright, 16, 16, {
    scaleType: 'majorPentatonic',
    minFreq: 140,
    maxFreq: 700,
    sampleStride: 1,
  });

  assert.ok(brightStats.dataDensity > darkStats.dataDensity);
  assert.ok(brightStats.filterCutoffHz > darkStats.filterCutoffHz);
  assert.ok(brightStats.pitchHz > darkStats.pitchHz);
});

test('formatting helpers produce exact scientific labels', () => {
  assert.equal(formatTimestamp(0), '00:00.0');
  assert.equal(formatTimestamp(65.4), '01:05.4');
  assert.equal(formatPanLabel(0.01), 'Center');
  assert.equal(formatPanLabel(-0.42), '42% L');
  assert.equal(formatPanLabel(0.68), '68% R');
  assert.deepEqual(coordsToLatLon(0.5, 0.5), { latLabel: '0.0° N', lonLabel: '0.0° E' });
  assert.deepEqual(coordsToLatLon(0, 0), { latLabel: '90.0° N', lonLabel: '180.0° W' });
});
