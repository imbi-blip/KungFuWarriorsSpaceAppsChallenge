import type { RiskTier } from '../../shared/types.ts';

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);
export const round = (v: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function tierFor(score: number): RiskTier {
  if (score >= 80) return 'Extreme';
  if (score >= 60) return 'High';
  if (score >= 40) return 'Elevated';
  if (score >= 20) return 'Moderate';
  return 'Low';
}

const TIER_ORDER: RiskTier[] = ['Low', 'Moderate', 'Elevated', 'High', 'Extreme'];
export const tierRank = (t: RiskTier): number => TIER_ORDER.indexOf(t);
export const maxTier = (tiers: RiskTier[]): RiskTier =>
  tiers.reduce<RiskTier>((a, b) => (tierRank(b) > tierRank(a) ? b : a), 'Low');

/** Uncertainty half-width grows as forecast skill falls (skill 1 = near-term, ~0.25 = climatology only). */
export function bandHalfWidth(skill: number): number {
  return 6 + 24 * (1 - clamp01(skill));
}

/** Remove control chars / markup from third-party strings and cap length. */
export function cleanText(input: unknown, max = 120): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/[<>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}
