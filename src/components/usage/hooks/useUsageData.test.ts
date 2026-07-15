import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UsageStreamOptions } from '@/services/api/usageStream';
import { useUsageData } from './useUsageData';

const mocks = vi.hoisted(() => {
  const loadUsageStats = vi.fn(async () => {});
  const setUsageState = vi.fn();
  const usageStoreState = {
    usage: null,
    loading: false,
    error: null,
    lastRefreshedAt: null,
    loadUsageStats,
  };

  const useUsageStatsStore = Object.assign(
    (selector: (state: typeof usageStoreState) => unknown) => selector(usageStoreState),
    { setState: setUsageState }
  );

  return {
    loadUsageStats,
    setUsageState,
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
        staleTimeMs: 240_000,
        timeRange: '24h',
      });
    });

    unmount();
    expect(mocks.closeUsageStream).toHaveBeenCalledOnce();
  });

  it('removes the visibility listener when the usage page unmounts', async () => {
    const { unmount } = renderHook(() => useUsageData());

    await waitFor(() => expect(mocks.loadUsageStats).toHaveBeenCalled());
    unmount();
    mocks.loadUsageStats.mockClear();

    act(() => {
      setVisibilityState('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      setVisibilityState('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mocks.loadUsageStats).not.toHaveBeenCalled();
  });

  it('refreshes the full usage snapshot when an SSE snapshot arrives', async () => {
    const { unmount } = renderHook(() => useUsageData('7d'));

    await waitFor(() => {
      expect(mocks.usageStreamOptions).not.toBeNull();
      expect(mocks.loadUsageStats).toHaveBeenCalledWith({
        staleTimeMs: 240_000,
        timeRange: '7d',
      });
    });
    mocks.loadUsageStats.mockClear();

    act(() => {
      mocks.usageStreamOptions?.onEvent({
        type: 'snapshot',
        payload: {
          total_requests: 1,
          total_tokens: 2,
        },
      });
    });

    await waitFor(() => {
      expect(mocks.loadUsageStats).toHaveBeenCalledWith({
        force: true,
        staleTimeMs: 240_000,
        timeRange: '7d',
      });
    });
    expect(mocks.setUsageState).not.toHaveBeenCalled();

    unmount();
  });
});
