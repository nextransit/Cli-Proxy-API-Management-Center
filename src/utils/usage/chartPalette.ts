/**
 * 8-color trend palette and helpers used by usage trend chart.
 */

export const MODEL_TREND_PALETTE = [
  '#3B82F6', // Top 1 — 科技蓝
  '#10B981', // Top 2 — 翡翠绿
  '#8B5CF6', // Top 3 — 皇家紫
  '#F59E0B', // Top 4 — 琥珀橙
  '#EC4899', // Top 5 — 魅惑粉
  '#06B6D4', // Top 6 — 青天蓝
  '#F43F5E', // Top 7 — 玫瑰红
  '#64748B', // Top 8 — 石板灰
] as const;

export const TAIL_LINE_COLOR = 'rgba(148, 163, 184, 0.55)';
export const TAIL_LINE_AREA_COLOR = 'rgba(148, 163, 184, 0.06)';

export function getRankColor(rank: number): string {
  if (!Number.isFinite(rank) || !Number.isInteger(rank) || rank < 0 || rank >= MODEL_TREND_PALETTE.length) {
    return TAIL_LINE_COLOR;
  }
  return MODEL_TREND_PALETTE[rank];
}

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
};

const parseHex = (hex: string): { r: number; g: number; b: number } | null => {
  const normalized = hex.trim().replace(/^#/, '');
  if (normalized.length !== 6) return null;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  if (![r, g, b].every((c) => Number.isFinite(c))) return null;
  return { r, g, b };
};

// Returns a CSS linear-gradient string. ECharts areaStyle.color accepts CSS
// gradient strings, so callers feed this directly into `areaStyle.color`
// (plan §3 data flow: `buildAreaGradient(getRankColor(i))`).
export function buildAreaGradient(
  hex: string,
  opacityTop: number = 0.33,
  opacityBottom: number = 0
): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const top = clamp01(opacityTop);
  const bottom = clamp01(opacityBottom);
  return `linear-gradient(180deg, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${top}) 0%, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${bottom}) 100%)`;
}
