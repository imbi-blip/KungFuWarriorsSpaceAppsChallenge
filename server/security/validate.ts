import { ApiError } from './http.ts';

const COORD_RE = /^-?\d{1,3}(\.\d{1,8})?$/;

function toCoordString(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string') return v.trim();
  return null;
}

/** Strictly parse coordinates and round to 2 dp (~1 km): limits location precision sent upstream and improves caching. */
export function parseLatLon(latRaw: unknown, lonRaw: unknown): { lat: number; lon: number } {
  const ls = toCoordString(latRaw);
  const os = toCoordString(lonRaw);
  const bad = () => new ApiError(400, 'invalid_coordinates', 'lat must be in [-90, 90] and lon in [-180, 180].');
  if (ls === null || os === null || !COORD_RE.test(ls) || !COORD_RE.test(os)) throw bad();
  const lat = Number(ls);
  const lon = Number(os);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) throw bad();
  const r = (x: number) => Math.round(x * 100) / 100 + 0; // +0 normalises -0
  return { lat: r(lat), lon: r(lon) };
}

export function optionalString(v: unknown, max: number): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new ApiError(400, 'invalid_field', 'Invalid text field.');
  return v.slice(0, max).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
}

const IMG_MAX_BYTES = 2_000_000;

/** Accepts a base64 JPEG/PNG (optionally as data URL), verifies magic bytes, returns clean base64 + mime. */
export function parseImage(v: unknown): { data: string; mimeType: 'image/jpeg' | 'image/png' } {
  if (typeof v !== 'string' || v.length === 0) throw new ApiError(400, 'invalid_image', 'Missing image data.');
  if (v.length > Math.ceil((IMG_MAX_BYTES * 4) / 3) + 64) throw new ApiError(413, 'payload_too_large', 'Image too large.');
  const m = /^data:image\/(jpeg|png);base64,/.exec(v);
  const b64 = m ? v.slice(m[0].length) : v;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new ApiError(400, 'invalid_image', 'Invalid image encoding.');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > IMG_MAX_BYTES) throw new ApiError(413, 'payload_too_large', 'Image too large.');
  const isJpeg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isPng = buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isJpeg && !isPng) throw new ApiError(400, 'invalid_image', 'Only JPEG or PNG images are accepted.');
  return { data: b64, mimeType: isJpeg ? 'image/jpeg' : 'image/png' };
}
