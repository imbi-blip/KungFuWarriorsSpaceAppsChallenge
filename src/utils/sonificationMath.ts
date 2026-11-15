import type { EarthTrack } from '../data/tracks';

export interface PixelTelemetry {
  /** Mean normalized intensity across all sampled pixels [0, 1] */
  meanIntensity: number;
  /** Peak intensity among sampled pixels [0, 1] */
  peakIntensity: number;
  /** Mean red/thermal emphasis [0, 1] */
  thermalIntensity: number;
  /** Fraction of pixels exceeding active threshold [0, 1] */
  dataDensity: number;
  /** Stereo pan weighted by spatial distribution [-1 (left) to +1 (right)] */
  stereoPan: number;
  /** Horizontal centroid [0, 1] */
  centroidX: number;
  /** Vertical centroid [0, 1] */
  centroidY: number;
  /** Mapped musical pitch in Hz */
  pitchHz: number;
  /** Nearest musical note label (e.g. "A4") */
  noteName: string;
  /** Mapped lowpass filter cutoff in Hz */
  filterCutoffHz: number;
  /** Mapped ambient gain [0, 1] */
  mappedGain: number;
}

const SCALE_INTERVALS: Record<EarthTrack['scaleType'], number[]> = {
  // Semitone offsets per octave
  minorPentatonic: [0, 3, 5, 7, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  suspended: [0, 2, 5, 7, 10],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

export function frequencyToMidi(freq: number): number {
  const safeFreq = Math.max(20, freq);
  return 69 + 12 * Math.log2(safeFreq / 440);
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function frequencyToNoteName(freq: number): string {
  const midi = Math.round(frequencyToMidi(freq));
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export function getScaleFrequencies(
  scaleType: EarthTrack['scaleType'],
  minFreq: number,
  maxFreq: number,
): number[] {
  const low = Math.max(40, Math.min(minFreq, maxFreq - 20));
  const high = Math.max(low + 20, maxFreq);
  const intervals = SCALE_INTERVALS[scaleType];

  const minMidi = Math.floor(frequencyToMidi(low));
  const maxMidi = Math.ceil(frequencyToMidi(high));
  // Anchor scale to D (midi % 12 === 2) for warm cinematic ambient tonality
  const rootPitchClass = 2;
  const freqs: number[] = [];

  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const pitchClass = (((midi - rootPitchClass) % 12) + 12) % 12;
    if (intervals.includes(pitchClass)) {
      const f = midiToFrequency(midi);
      if (f >= low * 0.98 && f <= high * 1.02) {
        freqs.push(Number(f.toFixed(2)));
      }
    }
  }

  if (freqs.length === 0) {
    return [Number(low.toFixed(2)), Number(high.toFixed(2))];
  }
  return freqs;
}

export function quantizeIntensityToPitch(
  normalizedIntensity: number,
  scaleType: EarthTrack['scaleType'],
  minFreq: number,
  maxFreq: number,
): { pitchHz: number; noteName: string } {
  const clamped = Math.max(0, Math.min(1, normalizedIntensity));
  const scale = getScaleFrequencies(scaleType, minFreq, maxFreq);
  const idx = Math.min(scale.length - 1, Math.floor(clamped * scale.length));
  const pitchHz = scale[idx];
  return {
    pitchHz,
    noteName: frequencyToNoteName(pitchHz),
  };
}

/**
 * Sample an RGBA pixel buffer (from canvas getImageData) and extract acoustic
 * mapping metrics: intensity, red/thermal dominance, left-right stereo pan,
 * spatial centroids, and quantized musical pitch/filter parameters.
 */
export function analyzeRgbaFrame(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: {
    scaleType: EarthTrack['scaleType'];
    minFreq: number;
    maxFreq: number;
    sampleStride?: number;
  },
): PixelTelemetry {
  const stride = Math.max(1, options.sampleStride ?? 2);
  let totalBrightness = 0;
  let totalThermal = 0;
  let maxSignal = 0;
  let activeCount = 0;
  let leftWeight = 0;
  let rightWeight = 0;
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  let sampleCount = 0;

  const activeThreshold = 0.22;

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      const idx = (y * width + x) * 4;
      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;
      const a = data[idx + 3] / 255;

      if (a <= 0.05) {
        sampleCount++;
        continue;
      }

      // Perceptual luminance + thermal warmth weighting (red/orange emphasis)
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) * a;
      const thermal = Math.max(0, r * 0.72 + g * 0.28 - b * 0.35) * a;
      const combinedSignal = Math.min(1, luminance * 0.55 + thermal * 0.65);

      totalBrightness += luminance;
      totalThermal += thermal;
      if (combinedSignal > maxSignal) {
        maxSignal = combinedSignal;
      }

      if (combinedSignal > activeThreshold) {
        activeCount++;
      }

      const normX = width > 1 ? x / (width - 1) : 0.5;
      const normY = height > 1 ? y / (height - 1) : 0.5;
      // Weight stereo balance toward high-energy pixels
      const energyWeight = Math.pow(combinedSignal, 1.35);

      if (normX < 0.5) {
        leftWeight += energyWeight * (1 - normX * 2) + energyWeight * 0.25;
      } else {
        rightWeight += energyWeight * ((normX - 0.5) * 2) + energyWeight * 0.25;
      }

      weightedX += normX * energyWeight;
      weightedY += normY * energyWeight;
      totalWeight += energyWeight;
      sampleCount++;
    }
  }

  const count = Math.max(1, sampleCount);
  const meanIntensity = totalBrightness / count;
  const thermalIntensity = totalThermal / count;
  const dataDensity = activeCount / count;

  const panDenom = leftWeight + rightWeight;
  const rawPan = panDenom > 0.0001 ? (rightWeight - leftWeight) / panDenom : 0;
  const stereoPan = Math.max(-1, Math.min(1, rawPan * 1.4));

  const centroidX = totalWeight > 0.0001 ? weightedX / totalWeight : 0.5;
  const centroidY = totalWeight > 0.0001 ? weightedY / totalWeight : 0.5;

  // Drive pitch from blend of peak thermal energy and active density
  const pitchDriver = Math.min(1, thermalIntensity * 1.55 + maxSignal * 0.38 + dataDensity * 0.25);
  const { pitchHz, noteName } = quantizeIntensityToPitch(
    pitchDriver,
    options.scaleType,
    options.minFreq,
    options.maxFreq,
  );

  // Filter cutoff sweeps cleanly from 280 Hz (quiet) to 3600 Hz (dense/active)
  const filterCutoffHz = Math.round(280 + Math.pow(Math.min(1, dataDensity * 1.4 + meanIntensity * 0.6), 0.9) * 3320);
  const mappedGain = Math.min(1, 0.24 + dataDensity * 0.55 + meanIntensity * 0.3);

  return {
    meanIntensity: Number(meanIntensity.toFixed(4)),
    peakIntensity: Number(maxSignal.toFixed(4)),
    thermalIntensity: Number(thermalIntensity.toFixed(4)),
    dataDensity: Number(dataDensity.toFixed(4)),
    stereoPan: Number(stereoPan.toFixed(3)),
    centroidX: Number(centroidX.toFixed(3)),
    centroidY: Number(centroidY.toFixed(3)),
    pitchHz,
    noteName,
    filterCutoffHz,
    mappedGain: Number(mappedGain.toFixed(3)),
  };
}

export function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe * 10) % 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function formatPanLabel(pan: number): string {
  const pct = Math.round(Math.abs(pan) * 100);
  if (pct < 4) return 'Center';
  return pan < 0 ? `${pct}% L` : `${pct}% R`;
}

export function coordsToLatLon(normX: number, normY: number): { latLabel: string; lonLabel: string } {
  const lon = (Math.max(0, Math.min(1, normX)) - 0.5) * 360;
  const lat = (0.5 - Math.max(0, Math.min(1, normY))) * 180;
  const latDir = lat >= 0 ? 'N' : 'S';
  const lonDir = lon >= 0 ? 'E' : 'W';
  return {
    latLabel: `${Math.abs(lat).toFixed(1)}° ${latDir}`,
    lonLabel: `${Math.abs(lon).toFixed(1)}° ${lonDir}`,
  };
}
