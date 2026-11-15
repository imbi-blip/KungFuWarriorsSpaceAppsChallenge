export interface MapViewport {
  /** Zoom multiplier >= 1 (1 = full globe) */
  zoom: number;
  /** Center longitude [-180, 180] */
  centerLon: number;
  /** Center latitude [-90, 90] */
  centerLat: number;
}

export const DEFAULT_VIEWPORT: MapViewport = {
  zoom: 1,
  centerLon: 0,
  centerLat: 0,
};

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function clampViewport(vp: MapViewport): MapViewport {
  const zoom = clamp(vp.zoom, 1, 6);
  const halfSpan = 0.5 / zoom;

  const rawCx = (vp.centerLon + 180) / 360;
  const rawCy = (90 - vp.centerLat) / 180;

  const cx = clamp(rawCx, halfSpan, 1 - halfSpan);
  const cy = clamp(rawCy, halfSpan, 1 - halfSpan);

  return {
    zoom: Number(zoom.toFixed(3)),
    centerLon: Number(((cx - 0.5) * 360).toFixed(4)),
    centerLat: Number(((0.5 - cy) * 180).toFixed(4)),
  };
}

/**
 * Convert normalized screen coordinates [0..1, 0..1] inside the canvas
 * to geographic [lon, lat] accounting for current zoom and center.
 */
export function screenToLonLat(
  screenNormX: number,
  screenNormY: number,
  viewport: MapViewport,
): { lon: number; lat: number } {
  const vp = clampViewport(viewport);
  const halfSpan = 0.5 / vp.zoom;
  const cx = (vp.centerLon + 180) / 360;
  const cy = (90 - vp.centerLat) / 180;

  const mapNormX = clamp(cx - halfSpan + clamp(screenNormX, 0, 1) * (2 * halfSpan), 0, 1);
  const mapNormY = clamp(cy - halfSpan + clamp(screenNormY, 0, 1) * (2 * halfSpan), 0, 1);

  return {
    lon: Number(((mapNormX - 0.5) * 360).toFixed(3)),
    lat: Number(((0.5 - mapNormY) * 180).toFixed(3)),
  };
}

/**
 * Convert geographic [lon, lat] to normalized screen coordinates [0..1, 0..1]
 * inside the zoomed viewport.
 */
export function lonLatToScreen(
  lon: number,
  lat: number,
  viewport: MapViewport,
): { normX: number; normY: number; inView: boolean } {
  const vp = clampViewport(viewport);
  const halfSpan = 0.5 / vp.zoom;
  const cx = (vp.centerLon + 180) / 360;
  const cy = (90 - vp.centerLat) / 180;

  const mapNormX = (lon + 180) / 360;
  const mapNormY = (90 - lat) / 180;

  const left = cx - halfSpan;
  const top = cy - halfSpan;
  const span = 2 * halfSpan;

  const normX = (mapNormX - left) / span;
  const normY = (mapNormY - top) / span;

  return {
    normX,
    normY,
    inView: normX >= -0.05 && normX <= 1.05 && normY >= -0.05 && normY <= 1.05,
  };
}

/**
 * Compute source pixel rectangle on a global equirectangular image of size (srcW, srcH).
 */
export function getSourceRect(
  srcW: number,
  srcH: number,
  viewport: MapViewport,
): { sx: number; sy: number; sw: number; sh: number } {
  const vp = clampViewport(viewport);
  const halfSpan = 0.5 / vp.zoom;
  const cx = (vp.centerLon + 180) / 360;
  const cy = (90 - vp.centerLat) / 180;

  const left = clamp(cx - halfSpan, 0, 1 - 2 * halfSpan);
  const top = clamp(cy - halfSpan, 0, 1 - 2 * halfSpan);

  return {
    sx: left * srcW,
    sy: top * srcH,
    sw: 2 * halfSpan * srcW,
    sh: 2 * halfSpan * srcH,
  };
}

export function interpolateViewport(
  current: MapViewport,
  target: MapViewport,
  alpha: number,
): MapViewport {
  const t = clamp(alpha, 0, 1);
  return clampViewport({
    zoom: current.zoom + (target.zoom - current.zoom) * t,
    centerLon: current.centerLon + (target.centerLon - current.centerLon) * t,
    centerLat: current.centerLat + (target.centerLat - current.centerLat) * t,
  });
}
