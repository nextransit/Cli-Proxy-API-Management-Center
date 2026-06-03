import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useGranularity, type Granularity } from './useGranularity';

const KEY_PREFIX = 'usage.granularity.';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('useGranularity', () => {
  it('returns the default value when no stored preference exists', () => {
    const { result } = renderHook(() => useGranularity('usage_trend'));
    expect(result.current.granularity).toBe<Granularity>('hour');
  });

  it('honors a custom default value', () => {
    const { result } = renderHook(() => useGranularity('usage_trend', 'day'));
    expect(result.current.granularity).toBe<Granularity>('day');
  });

  it('reads the stored value when present and valid', () => {
    localStorage.setItem(`${KEY_PREFIX}usage_trend`, 'day');
    const { result } = renderHook(() => useGranularity('usage_trend'));
    expect(result.current.granularity).toBe<Granularity>('day');
  });

  it('falls back to default when stored value is invalid', () => {
    localStorage.setItem(`${KEY_PREFIX}usage_trend`, 'year');
    const { result } = renderHook(() => useGranularity('usage_trend'));
    expect(result.current.granularity).toBe<Granularity>('hour');
  });

  it('persists the new value when setGranularity is called', () => {
    const { result } = renderHook(() => useGranularity('usage_trend'));
    act(() => {
      result.current.setGranularity('day');
    });
    expect(result.current.granularity).toBe<Granularity>('day');
    expect(localStorage.getItem(`${KEY_PREFIX}usage_trend`)).toBe('day');
  });

  it('isolates state between cards (per cardId key)', () => {
    const trend = renderHook(() => useGranularity('usage_trend'));
    const cost = renderHook(() => useGranularity('usage_cost'));
    act(() => {
      trend.result.current.setGranularity('day');
    });
    expect(cost.result.current.granularity).toBe<Granularity>('hour');
  });

  it('reset() clears the stored value and falls back to default', () => {
    localStorage.setItem(`${KEY_PREFIX}usage_trend`, 'day');
    const { result } = renderHook(() => useGranularity('usage_trend', 'hour'));
    expect(result.current.granularity).toBe<Granularity>('day');
    act(() => {
      result.current.reset();
    });
    expect(result.current.granularity).toBe<Granularity>('hour');
    expect(localStorage.getItem(`${KEY_PREFIX}usage_trend`)).toBeNull();
  });
});
