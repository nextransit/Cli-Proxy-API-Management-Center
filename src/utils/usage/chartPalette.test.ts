import { describe, it, expect } from 'vitest';
import {
  MODEL_TREND_PALETTE,
  TAIL_LINE_COLOR,
  getRankColor,
  buildAreaGradient,
} from './chartPalette';

describe('MODEL_TREND_PALETTE', () => {
  it('has exactly 8 colors in the documented order', () => {
    expect(MODEL_TREND_PALETTE).toEqual([
      '#3B82F6',
      '#10B981',
      '#8B5CF6',
      '#F59E0B',
      '#EC4899',
      '#06B6D4',
      '#F43F5E',
      '#64748B',
    ]);
  });
});

describe('getRankColor', () => {
  it('returns the palette color for ranks 0..7', () => {
    MODEL_TREND_PALETTE.forEach((hex, rank) => {
      expect(getRankColor(rank)).toBe(hex);
    });
  });

  it('returns TAIL_LINE_COLOR for rank >= 8', () => {
    expect(getRankColor(8)).toBe(TAIL_LINE_COLOR);
    expect(getRankColor(99)).toBe(TAIL_LINE_COLOR);
  });

  it('returns TAIL_LINE_COLOR for negative inputs', () => {
    expect(getRankColor(-1)).toBe(TAIL_LINE_COLOR);
    expect(getRankColor(-100)).toBe(TAIL_LINE_COLOR);
  });

  it('returns TAIL_LINE_COLOR for non-integer inputs', () => {
    expect(getRankColor(1.5)).toBe(TAIL_LINE_COLOR);
    expect(getRankColor(0.1)).toBe(TAIL_LINE_COLOR);
  });

  it('returns TAIL_LINE_COLOR for NaN and infinities', () => {
    expect(getRankColor(NaN)).toBe(TAIL_LINE_COLOR);
    expect(getRankColor(Infinity)).toBe(TAIL_LINE_COLOR);
    expect(getRankColor(-Infinity)).toBe(TAIL_LINE_COLOR);
  });
});

describe('buildAreaGradient', () => {
  it('returns a linear-gradient string with rgba for a 6-digit hex', () => {
    const result = buildAreaGradient('#3B82F6');
    expect(result).toContain('linear-gradient');
    expect(result).toContain('rgba(');
    expect(result).toContain('rgba(59, 130, 246, 0.33)');
    expect(result).toContain('rgba(59, 130, 246, 0)');
  });

  it('accepts custom opacityTop and opacityBottom values', () => {
    const result = buildAreaGradient('#10B981', 0.5, 0.1);
    expect(result).toContain('linear-gradient');
    expect(result).toContain('0.5');
    expect(result).toContain('0.1');
    expect(result).toContain('rgba(16, 185, 129');
  });
});
