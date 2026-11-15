import type { TrackId } from '../data/tracks';
import { WORLD_CONTINENTS } from '../data/worldCoastlines';
import type { LiveEvent } from '../../shared/types';
import {
  DEFAULT_VIEWPORT,
  getSourceRect,
  lonLatToScreen,
  type MapViewport,
} from './mapProjection';

// Offscreen fluid field buffer; vector coastlines, graticules, and disaster pins
// are projected directly in screen space for razor-sharp detail at any zoom level.
const FIELD_W = 280;
const FIELD_H = 140;

interface Hotspot {
  lon: number;
  lat: number;
  radius: number;
  phase: number;
  driftLon?: number;
  driftLat?: number;
  weight: number;
}

const FIRE_ZONES: Hotspot[] = [
  { lon: -120, lat: 41, radius: 14, phase: 0.2, weight: 0.95 }, // Western US
  { lon: -112, lat: 56, radius: 16, phase: 1.4, weight: 0.85 }, // Boreal Canada
  { lon: -58, lat: -11, radius: 18, phase: 2.1, weight: 1.0 }, // Amazon
  { lon: 22, lat: -8, radius: 22, phase: 3.0, weight: 1.0 },   // Central/Southern Africa
  { lon: 18, lat: 8, radius: 16, phase: 4.1, weight: 0.9 },    // Sahel
  { lon: 108, lat: 60, radius: 22, phase: 5.0, weight: 0.95 }, // Siberia
  { lon: 132, lat: -19, radius: 16, phase: 0.9, weight: 0.85 }, // Northern Australia
  { lon: 102, lat: 18, radius: 13, phase: 2.7, weight: 0.75 }, // SE Asia
  { lon: 24, lat: 39, radius: 11, phase: 3.6, weight: 0.7 },   // Mediterranean
];

const CO2_SOURCES: Hotspot[] = [
  { lon: -82, lat: 40, radius: 24, phase: 0.0, weight: 0.95 },  // Eastern North America
  { lon: 12, lat: 49, radius: 22, phase: 1.1, weight: 0.9 },   // Central Europe
  { lon: 116, lat: 36, radius: 28, phase: 2.2, weight: 1.0 },  // East Asia
  { lon: 78, lat: 24, radius: 20, phase: 3.1, weight: 0.85 },  // South Asia
  { lon: -55, lat: -8, radius: 18, phase: 4.5, weight: 0.65 }, // Amazon respiration
];

const AEROSOL_SOURCES: Hotspot[] = [
  { lon: 5, lat: 20, radius: 26, phase: 0.4, driftLon: -28, weight: 1.0 },  // Saharan dust -> Atlantic
  { lon: 55, lat: 21, radius: 20, phase: 1.8, driftLon: 12, weight: 0.88 }, // Arabian dust
  { lon: 110, lat: 33, radius: 24, phase: 2.6, driftLon: 18, weight: 0.95 }, // East Asia sulfate
  { lon: 80, lat: 25, radius: 18, phase: 3.7, driftLon: 8, weight: 0.85 },  // Indo-Gangetic haze
  { lon: -60, lat: -12, radius: 16, phase: 4.9, driftLon: -8, weight: 0.72 }, // Amazon smoke
  { lon: 18, lat: -10, radius: 18, phase: 5.5, driftLon: -14, weight: 0.78 }, // Central Africa smoke
];

export interface RenderOptions {
  viewport?: MapViewport;
  showRiskOverlay?: boolean;
  selectedPoint?: { lon: number; lat: number } | null;
  liveEvents?: LiveEvent[];
}

const EVENT_STYLES: Record<string, { color: string; shape: 'triangle' | 'diamond' | 'circle' | 'square' }> = {
  wildfires: { color: '#fb923c', shape: 'triangle' },
  floods: { color: '#38bdf8', shape: 'diamond' },
  severeStorms: { color: '#c084fc', shape: 'circle' },
  volcanoes: { color: '#f87171', shape: 'square' },
  landslides: { color: '#facc15', shape: 'square' },
  default: { color: '#e2e8f0', shape: 'circle' },
};

export class ProceduralEarthRenderer {
  private fieldCanvas: HTMLCanvasElement;
  private fieldCtx: CanvasRenderingContext2D;
  private fieldImage: ImageData;
  private landMask: Uint8Array;

  constructor() {
    this.fieldCanvas = document.createElement('canvas');
    this.fieldCanvas.width = FIELD_W;
    this.fieldCanvas.height = FIELD_H;
    const ctx = this.fieldCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to create offscreen 2D context');
    }
    this.fieldCtx = ctx;
    this.fieldImage = ctx.createImageData(FIELD_W, FIELD_H);
    this.landMask = this.buildLandMask();
  }

  private buildLandMask(): Uint8Array {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = FIELD_W;
    maskCanvas.height = FIELD_H;
    const mctx = maskCanvas.getContext('2d');
    const mask = new Uint8Array(FIELD_W * FIELD_H);
    if (!mctx) return mask;

    mctx.fillStyle = '#000000';
    mctx.fillRect(0, 0, FIELD_W, FIELD_H);
    mctx.fillStyle = '#ffffff';

    for (const poly of WORLD_CONTINENTS) {
      mctx.beginPath();
      poly.forEach(([lon, lat], idx) => {
        const x = ((lon + 180) / 360) * FIELD_W;
        const y = ((90 - lat) / 180) * FIELD_H;
        if (idx === 0) mctx.moveTo(x, y);
        else mctx.lineTo(x, y);
      });
      mctx.closePath();
      mctx.fill();
    }

    const pixels = mctx.getImageData(0, 0, FIELD_W, FIELD_H).data;
    for (let i = 0; i < FIELD_W * FIELD_H; i++) {
      mask[i] = pixels[i * 4] > 128 ? 1 : 0;
    }
    return mask;
  }

  private valueNoise(x: number, y: number, t: number): number {
    const n1 = Math.sin(x * 0.14 + t * 0.7) * Math.cos(y * 0.16 - t * 0.45);
    const n2 = Math.sin((x + y) * 0.25 - t * 1.1) * 0.5;
    const n3 = Math.cos(x * 0.41 - y * 0.37 + t * 1.6) * 0.25;
    return (n1 + n2 + n3) / 1.75;
  }

  private wrapLonDist(lon1: number, lon2: number): number {
    let d = Math.abs(lon1 - lon2);
    if (d > 180) d = 360 - d;
    return d;
  }

  public render(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    trackId: TrackId,
    timeSec: number,
    durationSec: number,
    options: RenderOptions = {},
  ): void {
    const viewport = options.viewport ?? DEFAULT_VIEWPORT;
    const showRiskOverlay = options.showRiskOverlay ?? false;
    const selectedPoint = options.selectedPoint ?? null;
    const liveEvents = options.liveEvents ?? [];

    const phase = (timeSec / Math.max(1, durationSec)) * Math.PI * 2;
    const data = this.fieldImage.data;

    for (let py = 0; py < FIELD_H; py++) {
      const lat = 90 - (py / (FIELD_H - 1)) * 180;
      for (let px = 0; px < FIELD_W; px++) {
        const lon = (px / (FIELD_W - 1)) * 360 - 180;
        const idx = py * FIELD_W + px;
        const isLand = this.landMask[idx] === 1;
        const out = idx * 4;

        let r = 8;
        let g = 12;
        let b = 20;

        if (trackId === 'wildfires') {
          let heat = 0;
          for (const z of FIRE_ZONES) {
            const seasonPulse = 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(phase + z.phase));
            const dl = this.wrapLonDist(lon, z.lon);
            const da = lat - z.lat;
            const d2 = dl * dl + da * da;
            const rad = z.radius * (0.75 + 0.3 * seasonPulse);
            const gVal = Math.exp(-d2 / (rad * rad));
            heat += gVal * seasonPulse * z.weight;
          }
          const turbulence = 0.5 + 0.5 * this.valueNoise(px * 0.85, py * 0.85, phase * 2);
          const signal = Math.min(1, heat * (isLand ? 1.15 : 0.16) * (0.65 + 0.55 * turbulence));

          if (isLand) {
            r = 18 + signal * 237;
            g = 22 + Math.pow(signal, 1.55) * 180;
            b = 32 + Math.pow(signal, 3.1) * 140;
          } else {
            r = 7 + signal * 45;
            g = 11 + signal * 18;
            b = 20 + signal * 10;
          }
        } else if (trackId === 'co2') {
          const jetWave = Math.sin(lon * 0.052 - phase * 2.0 + Math.sin(lat * 0.06) * 1.4);
          const rossbyBand = Math.exp(-Math.pow((lat - (38 + jetWave * 14)) / 24, 2));
          const southernBand = Math.exp(-Math.pow((lat + 18 - jetWave * 8) / 26, 2)) * 0.42;

          let plume = 0;
          for (const s of CO2_SOURCES) {
            const advectLon = ((s.lon + timeSec * 3.8 + 180) % 360) - 180;
            const dl = this.wrapLonDist(lon, advectLon);
            const da = lat - (s.lat + Math.sin(phase + s.phase) * 6);
            const d2 = (dl * dl) / (s.radius * s.radius * 1.9) + (da * da) / (s.radius * s.radius * 0.65);
            plume += Math.exp(-d2) * s.weight;
          }
          const swirl = 0.5 + 0.5 * this.valueNoise(px * 0.5 - timeSec * 1.8, py * 0.6, phase);
          const density = Math.min(1, (rossbyBand * 0.55 + southernBand + plume * 0.72) * (0.58 + 0.52 * swirl));

          if (density < 0.35) {
            const t = density / 0.35;
            r = 10 + t * 18;
            g = 18 + t * 105;
            b = 45 + t * 145;
          } else if (density < 0.7) {
            const t = (density - 0.35) / 0.35;
            r = 28 + t * 212;
            g = 123 + t * 40;
            b = 190 - t * 135;
          } else {
            const t = (density - 0.7) / 0.3;
            r = 240 + t * 15;
            g = 163 + t * 75;
            b = 55 + t * 190;
          }
        } else if (trackId === 'sst') {
          if (isLand) {
            r = 16;
            g = 21;
            b = 30;
          } else {
            const ensoOsc = Math.sin(phase);
            const ensoLonDist = this.wrapLonDist(lon, -135 + ensoOsc * 18);
            const ensoLatDist = lat;
            const elNino =
              Math.exp(-(ensoLonDist * ensoLonDist) / 2600 - (ensoLatDist * ensoLatDist) / 110) *
              (0.55 + 0.45 * ensoOsc);

            const gulfStream = Math.exp(-Math.pow((lon + 55) / 30, 2) - Math.pow((lat - 36) / 11, 2)) * 0.75;
            const kuroshio = Math.exp(-Math.pow((lon - 150) / 30, 2) - Math.pow((lat - 34) / 11, 2)) * 0.7;
            const southernCold = Math.exp(-Math.pow((lat + 54) / 14, 2)) * -0.75;
            const arcticCold = Math.exp(-Math.pow((lat - 70) / 14, 2)) * -0.65;
            const eddy = this.valueNoise(px * 0.7, py * 0.7, phase * 1.4) * 0.32;

            const anomaly = Math.max(-1, Math.min(1, elNino + gulfStream + kuroshio + southernCold + arcticCold + eddy));
            if (anomaly >= 0) {
              const t = anomaly;
              r = 40 + t * 208;
              g = 55 + (1 - Math.abs(t - 0.45) * 1.6) * 85;
              b = 75 * (1 - t);
            } else {
              const t = -anomaly;
              r = 35 * (1 - t * 0.7);
              g = 62 + t * 85;
              b = 92 + t * 155;
            }
          }
        } else if (trackId === 'aerosols') {
          let aod = 0;
          for (const src of AEROSOL_SOURCES) {
            const driftProgress = 0.5 + 0.5 * Math.sin(phase + src.phase);
            const cx = src.lon + (src.driftLon ?? 0) * driftProgress;
            const cy = src.lat + Math.sin(phase * 1.5 + src.phase) * 4;
            const dl = this.wrapLonDist(lon, cx);
            const da = lat - cy;
            const d2 = (dl * dl) / (src.radius * src.radius * 1.5) + (da * da) / (src.radius * src.radius * 0.75);
            aod += Math.exp(-d2) * src.weight * (0.65 + 0.35 * driftProgress);
          }
          const wave = 0.5 + 0.5 * this.valueNoise(px * 0.65 + timeSec * 1.4, py * 0.65, phase);
          const density = Math.min(1, aod * (0.55 + 0.55 * wave));

          if (density < 0.3) {
            const t = density / 0.3;
            r = 12 + t * 42;
            g = 15 + t * 28;
            b = 28 + t * 82;
          } else if (density < 0.68) {
            const t = (density - 0.3) / 0.38;
            r = 54 + t * 156;
            g = 43 + t * 65;
            b = 110 - t * 78;
          } else {
            const t = (density - 0.68) / 0.32;
            r = 210 + t * 44;
            g = 108 + t * 105;
            b = 32 + t * 130;
          }
        }

        data[out] = Math.max(0, Math.min(255, Math.round(r)));
        data[out + 1] = Math.max(0, Math.min(255, Math.round(g)));
        data[out + 2] = Math.max(0, Math.min(255, Math.round(b)));
        data[out + 3] = 255;
      }
    }

    this.fieldCtx.putImageData(this.fieldImage, 0, 0);

    // Draw zoomed/cropped region of the fluid heatmap field
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const rect = getSourceRect(FIELD_W, FIELD_H, viewport);
    ctx.drawImage(this.fieldCanvas, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);

    // Crisp lat/lon coordinate graticule (denser spacing when zoomed in)
    const gridStep = viewport.zoom >= 2.2 ? 15 : 30;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    for (let lon = -180 + gridStep; lon < 180; lon += gridStep) {
      const p = lonLatToScreen(lon, 0, viewport);
      if (p.normX < -0.05 || p.normX > 1.05) continue;
      const x = p.normX * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let lat = -90 + gridStep; lat < 90; lat += gridStep) {
      const p = lonLatToScreen(0, lat, viewport);
      if (p.normY < -0.05 || p.normY > 1.05) continue;
      const y = p.normY * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Equator highlight
    const eq = lonLatToScreen(0, 0, viewport);
    if (eq.normY >= 0 && eq.normY <= 1) {
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.2)';
      ctx.beginPath();
      ctx.moveTo(0, eq.normY * height);
      ctx.lineTo(width, eq.normY * height);
      ctx.stroke();
    }

    // Crisp vector continental coastlines projected to current viewport
    ctx.strokeStyle =
      trackId === 'sst' ? 'rgba(148, 163, 184, 0.56)' : 'rgba(203, 213, 225, 0.46)';
    ctx.lineWidth = Math.max(1, (width / 880) * Math.min(1.6, Math.sqrt(viewport.zoom)));
    for (const poly of WORLD_CONTINENTS) {
      ctx.beginPath();
      poly.forEach(([lon, lat], idx) => {
        const p = lonLatToScreen(lon, lat, viewport);
        const x = p.normX * width;
        const y = p.normY * height;
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Track-specific radiant hotspots
    if (trackId === 'wildfires') {
      for (const z of FIRE_ZONES) {
        const seasonPulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(phase + z.phase));
        if (seasonPulse < 0.52) continue;
        const p = lonLatToScreen(z.lon, z.lat, viewport);
        if (!p.inView) continue;
        const cx = p.normX * width;
        const cy = p.normY * height;
        const glowRadius = (width / 46) * seasonPulse * Math.min(2.2, viewport.zoom);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
        grad.addColorStop(0, `rgba(254, 240, 138, ${0.52 * seasonPulse})`);
        grad.addColorStop(0.45, `rgba(249, 115, 22, ${0.26 * seasonPulse})`);
        grad.addColorStop(1, 'rgba(249, 115, 22, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Live NASA EONET event layer (open wildfires, floods, storms, volcanoes, landslides).
    // Shapes differ per category so the layer never relies on colour alone.
    if (showRiskOverlay && liveEvents.length > 0) {
      const big = viewport.zoom >= 1.8;
      const r = big ? 6 : 4;
      for (const ev of liveEvents) {
        const pos = lonLatToScreen(ev.lon, ev.lat, viewport);
        if (!pos.inView) continue;
        const cx = pos.normX * width;
        const cy = pos.normY * height;
        const style = EVENT_STYLES[ev.category] ?? EVENT_STYLES.default;
        ctx.save();
        ctx.fillStyle = style.color;
        ctx.strokeStyle = '#07090E';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        if (style.shape === 'triangle') {
          ctx.moveTo(cx, cy - r - 1);
          ctx.lineTo(cx + r, cy + r * 0.8);
          ctx.lineTo(cx - r, cy + r * 0.8);
          ctx.closePath();
        } else if (style.shape === 'diamond') {
          ctx.moveTo(cx, cy - r - 1);
          ctx.lineTo(cx + r, cy);
          ctx.lineTo(cx, cy + r + 1);
          ctx.lineTo(cx - r, cy);
          ctx.closePath();
        } else if (style.shape === 'square') {
          ctx.rect(cx - r + 1, cy - r + 1, 2 * r - 2, 2 * r - 2);
        } else {
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // Clicked/selected geographic target reticle
    if (selectedPoint) {
      const tp = lonLatToScreen(selectedPoint.lon, selectedPoint.lat, viewport);
      if (tp.inView) {
        const tx = tp.normX * width;
        const ty = tp.normY * height;
        ctx.save();
        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.arc(tx, ty, 11, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(tx - 16, ty);
        ctx.lineTo(tx - 6, ty);
        ctx.moveTo(tx + 6, ty);
        ctx.lineTo(tx + 16, ty);
        ctx.moveTo(tx, ty - 16);
        ctx.lineTo(tx, ty - 6);
        ctx.moveTo(tx, ty + 6);
        ctx.lineTo(tx, ty + 16);
        ctx.stroke();

        ctx.fillStyle = '#22d3ee';
        ctx.beginPath();
        ctx.arc(tx, ty, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();
  }
}
