import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageStreamOptions } from '@/services/api/usageStream';
import { useUsageData } from './useUsageData';

const mocks = vi.hoisted(() => {
  const loadUsageStats = vi.fn(async () => {});
  const setUsageState = vi.fn();
  const applyIncrementalEvent = vi.fn();
  const usageStoreState = {
    usage: null,
    loading: false,
    error: null,
    lastRefreshedAt: null,
    lastEventId: 0,
    loadUsageStats,
    applyIncrementalEvent,
  };

  const getState = () => usageStoreState;
  const useUsageStatsStore = Object.assign(
    (selector: (state: typeof usageStoreState) => unknown) => selector(usageStoreState),
    { setState: setUsageState, getState }
  );

  return {
    loadUsageStats,
    setUsageState,
    applyIncrementalEvent,
    useUsageStatsStore,
    closeUsageStream: vi.fn(),
    getModelPrices: vi.fn(async () => ({ prices: {} })),
    usageStreamOptions: null as UsageStreamOptions | null,
  };
});

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock('@/stores', () => ({
  USAGE_STATS_STALE_TIME_MS: 240_000,
  useNotificationStore: () => ({ showNotification: vi.fn() }),
  useUsageStatsStore: mocks.useUsageStatsStore,
}));

vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: {
    getState: () => ({ managementKey: 'test-key' }),
  },
}));

vi.mock('@/services/api/usageStream', () => ({
  subscribeUsageStream: (options: UsageStreamOptions) => {
    mocks.usageStreamOptions = options;
    return {
      status: () => 'open',
      close: mocks.closeUsageStream,
    };
  },
}));

vi.mock('@/services/api/modelPrices', () => ({
  modelPricesApi: {
    getModelPrices: mocks.getModelPrices,
    putModelPrices: vi.fn(),
    patchModelPrices: vi.fn(),
  },
}));

const setVisibilityState = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
};

describe('useUsageData page visibility refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.usageStreamOptions = null;
    setVisibilityState('visible');
  });

  afterEach(() => {
    setVisibilityState('visible');
  });

  it('forces a usage refresh when the browser tab becomes visible again', async () => {
    const { unmount } = renderHook(() => useUsageData('24h'));

    await waitFor(() => {
      expect(mocks.loadUsageStats).toHaveBeenCalledWith({
        staleTimeMs: 240_000,
        timeRange: '24h',
      });
    });
    mocks.loadUsageStats.mockClear();

    act(() => {
      setVisibilityState('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(mocks.loadUsageStats).not.toHaveBeenCalled();

    act(() => {
      setVisibilityState('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(mocks.loadUsageStats).toHaveBeenCalledWith({
        force: true,
        supersedeInFlight: true,
        staleTimeMs: 240_000,
        timeRange: '24h',
      });
    });

    unmount();
    expect(mocks.closeUsageStream).toHaveBeenCalledOnce();
  });

  it('forces one refresh for paired visibility and focus events', async () => {
    const { unmount } = renderHook(() => useUsageData('24h'));

    await waitFor(() => expect(mocks.loadUsageStats).toHaveBeenCalled());
    mocks.loadUsageStats.mockClear();

    act(() => {
      setVisibilityState('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      setVisibilityState('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(mocks.loadUsageStats).toHaveBeenCalledTimes(1);
      expect(mocks.loadUsageStats).toHaveBeenCalledWith({
        force: true,
        supersedeInFlight: true,
        staleTimeMs: 240_000,
        timeRange: '24h',
      });
    });

    unmount();
  });

  it('forces a refresh when a cached page is restored', async () => {
    const { unmount } = renderHook(() => useUsageData('7d'));

    await waitFor(() => expect(mocks.loadUsageStats).toHaveBeenCalled());
    mocks.loadUsageStats.mockClear();

    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });

    await waitFor(() => {
      expect(mocks.loadUsageStats).toHaveBeenCalledWith({
        force: true,
        supersedeInFlight: true,
        staleTimeMs: 240_000,
        timeRange: '7d',
      });
    });

    unmount();
  });

  it('removes foreground refresh listeners when the usage page unmounts', async () => {
    const { unmount } = renderHook(() => useUsageData());

    await waitFor(() => expect(mocks.loadUsageStats).toHaveBeenCalled());
    unmount();
    mocks.loadUsageStats.mockClear();

    act(() => {
      setVisibilityState('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      setVisibilityState('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });

    expect(mocks.loadUsageStats).not.toHaveBeenCalled();
  });

  it('merges usage events incrementally via SSE onUsageEvent callback', async () => {
    const { unmount } = renderHook(() => useUsageData('7d'));

    await waitFor(() => {
      expect(mocks.usageStreamOptions).not.toBeNull();
      expect(mocks.loadUsageStats).toHaveBeenCalledWith({
        staleTimeMs: 240_000,
        timeRange: '7d',
      });
    });
    mocks.loadUsageStats.mockClear();

    const detail = { id: 42, total_requests: 1, total_tokens: 100 } as const;
    act(() => {
      mocks.usageStreamOptions?.onUsageEvent?.(detail);
    });

    // Should NOT trigger loadUsageStats (avoids the spinner cycle)
    expect(mocks.loadUsageStats).not.toHaveBeenCalled();
    // Should update the store incrementally
    expect(mocks.applyIncrementalEvent).toHaveBeenCalledWith(detail);

    unmount();
  });

  it('aligns lastEventId via SSE onSummary callback', async () => {
    const { unmount } = renderHook(() => useUsageData('7d'));

    await waitFor(() => {
      expect(mocks.usageStreamOptions).not.toBeNull();
    });
    mocks.loadUsageStats.mockClear();
    mocks.setUsageState.mockClear();

    const summary = { latest_event_id: 99, total_requests: 10, total_tokens: 500 };
    act(() => {
      mocks.usageStreamOptions?.onSummary?.(summary);
    });

    expect(mocks.setUsageState).toHaveBeenCalledWith({ lastEventId: 99 });

    unmount();
  });

  it('falls back to 30-second polling when the usage stream is unavailable', async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useUsageData('24h'));

    await vi.waitFor(() => {
      expect(mocks.usageStreamOptions).not.toBeNull();
    });
    mocks.loadUsageStats.mockClear();

    act(() => {
      mocks.usageStreamOptions?.onStatusChange?.('error');
      vi.advanceTimersByTime(29_999);
    });
    expect(mocks.loadUsageStats).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    expect(mocks.loadUsageStats).toHaveBeenCalledWith({
      force: true,
      staleTimeMs: 240_000,
      timeRange: '24h',
    });

    unmount();
    vi.useRealTimers();
  });
});

it('does not refresh on visibility return for heavy windows, but still re-arms polling', async () => {
  const { unmount } = renderHook(() => useUsageData('all'));

  await waitFor(() => expect(mocks.usageStreamOptions).not.toBeNull());
  mocks.loadUsageStats.mockClear();

  act(() => {
    setVisibilityState('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibilityState('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });

  // Heavy windows must NOT trigger a foreground loadUsageStats (that
  // would re-serialise every retained RequestDetail).
  expect(mocks.loadUsageStats).not.toHaveBeenCalled();
  unmount();
});
