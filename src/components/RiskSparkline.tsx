import type { DailyRisk, RiskTier } from '../../shared/types';

export const TIER_COLOR: Record<RiskTier, string> = {
  Low: '#34d399',
  Moderate: '#a3e635',
  Elevated: '#fbbf24',
  High: '#fb923c',
  Extreme: '#fb7185',
};

const W = 220;
const H = 56;

/** 20-day risk curve with uncertainty band. Accessible: summarised in aria-label; a text table is provided by the parent. */
export function RiskSparkline({ daily, tier, label }: { daily: DailyRisk[]; tier: RiskTier; label: string }) {
  if (daily.length < 2) return null;
  const x = (i: number) => (i / (daily.length - 1)) * (W - 8) + 4;
  const y = (v: number) => H - 4 - (v / 100) * (H - 8);
  const line = daily.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.score).toFixed(1)}`).join(' ');
  const band = [...daily.map((d, i) => `${x(i).toFixed(1)},${y(d.high).toFixed(1)}`), ...[...daily].reverse().map((d, i) => `${x(daily.length - 1 - i).toFixed(1)},${y(d.low).toFixed(1)}`)].join(' ');
  const peakIdx = daily.reduce((m, d, i) => (d.score > daily[m].score ? i : m), 0);
  const color = TIER_COLOR[tier];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="w-full h-14">
      {[20, 40, 60, 80].map((t) => (
        <line key={t} x1="0" x2={W} y1={y(t)} y2={y(t)} stroke="#1e293b" strokeWidth="0.75" />
      ))}
      <polygon points={band} fill={color} opacity="0.16" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx={x(0)} cy={y(daily[0].score)} r="2.5" fill="#f8fafc" />
      <circle cx={x(peakIdx)} cy={y(daily[peakIdx].score)} r="3" fill={color} stroke="#07090E" strokeWidth="1" />
    </svg>
  );
}
