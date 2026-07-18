import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUsageStatsStore } from './useUsageStatsStore';

const mocks = vi.hoisted(() => ({
  getUsage: vi.fn(),
  authState: {
    apiBase: 'http://127.0.0.1:8317',
    managementKey: 'test-key',
  },
}));

vi.mock('@/services/api', () => ({
  usageApi: {
    getUsage: mocks.getUsage,
  },
}));

vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: {
    getState: () => mocks.authState,
  },
}));

vi.mock('@/utils/usage', () => ({
  collectUsageDetails: () => [],
  computeKeyStatsFromDetails: () => ({ bySource: {}, byAuthIndex: {} }),
}));

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('useUsageStatsStore foreground refresh', () => {
  beforeEach(() => {
    useUsageStatsStore.getState().clearUsageStats();
    vi.clearAllMocks();
  });

  it('aborts and replaces a same-scope request for a foreground refresh', async () => {
    const firstRequest = createDeferred<Record<string, unknown>>();
    let firstSignal: AbortSignal | undefined;

    mocks.getUsage
      .mockImplementationOnce((options: { signal?: AbortSignal }) => {
        firstSignal = options.signal;
        options.signal?.addEventListener('abort', () => {
          firstRequest.reject(new Error('aborted'));
        });
        return firstRequest.promise;
      })
      .mockResolvedValueOnce({ total_requests: 2 });

    const firstLoad = useUsageStatsStore.getState().loadUsageStats({
      force: true,
      timeRange: '24h',
    });

    expect(mocks.getUsage).toHaveBeenCalledTimes(1);

    await useUsageStatsStore.getState().loadUsageStats({
      force: true,
      supersedeInFlight: true,
      timeRange: '24h',
    });

    await expect(firstLoad).resolves.toBeUndefined();
    expect(firstSignal?.aborted).toBe(true);
    expect(mocks.getUsage).toHaveBeenCalledTimes(2);
    expect(useUsageStatsStore.getState().usage).toEqual({ total_requests: 2 });
  });

  it('keeps reusing a same-scope request for normal live refreshes', async () => {
    const request = createDeferred<Record<string, unknown>>();
    mocks.getUsage.mockReturnValueOnce(request.promise);

    const firstLoad = useUsageStatsStore.getState().loadUsageStats({
      force: true,
      timeRange: '24h',
    });
    const secondLoad = useUsageStatsStore.getState().loadUsageStats({
      force: true,
      timeRange: '24h',
    });

    expect(mocks.getUsage).toHaveBeenCalledTimes(1);

    request.resolve({ total_requests: 1 });
    await Promise.all([firstLoad, secondLoad]);

    expect(useUsageStatsStore.getState().usage).toEqual({ total_requests: 1 });
  });
});

interface UsageEventDetail {
  id: number;
  api_key?: string;
  model?: string;
  failed?: boolean;
  tokens?: { input: number; output: number; total: number };
  requested_at?: string;
  duration_ms?: number;
  status_code?: number;
}

describe('applyIncrementalEvent', () => {
  beforeEach(() => {
    useUsageStatsStore.getState().resetRecent();
  });

  it('appends new event to head and updates lastEventId', () => {
    const store = useUsageStatsStore.getState();
    store.applyIncrementalEvent({ id: 1, model: 'gpt-4o' } as UsageEventDetail);
    const s = useUsageStatsStore.getState();
    expect(s.recentDetails[0]).toMatchObject({ id: 1, model: 'gpt-4o' });
    expect(s.lastEventId).toBe(1);
  });

  it('deduplicates by id', () => {
    const store = useUsageStatsStore.getState();
    store.applyIncrementalEvent({ id: 1, model: 'a' } as UsageEventDetail);
    store.applyIncrementalEvent({ id: 1, model: 'b' } as UsageEventDetail);
    const s = useUsageStatsStore.getState();
    expect(s.recentDetails).toHaveLength(1);
    expect(s.recentDetails[0].model).toBe('a');
    expect(s.lastEventId).toBe(1);
  });

  it('caps at maxRecent (200) by dropping tail', () => {
    const store = useUsageStatsStore.getState();
    for (let i = 1; i <= 250; i++) {
      store.applyIncrementalEvent({ id: i } as UsageEventDetail);
    }
    const s = useUsageStatsStore.getState();
    expect(s.recentDetails).toHaveLength(200);
    expect(s.recentDetails[0].id).toBe(250);
    expect(s.recentDetails[199].id).toBe(51);
  });
});

describe('applyBulkEvents', () => {
  beforeEach(() => {
    useUsageStatsStore.getState().resetRecent();
  });

  it('merges multiple events and sorts by id desc', () => {
    const store = useUsageStatsStore.getState();
    store.applyBulkEvents([
      { id: 2 } as UsageEventDetail,
      { id: 5 } as UsageEventDetail,
      { id: 3 } as UsageEventDetail,
    ]);
    const s = useUsageStatsStore.getState();
    expect(s.recentDetails.map(e => e.id)).toEqual([5, 3, 2]);
    expect(s.lastEventId).toBe(5);
  });

  it('skips duplicates against existing', () => {
    const store = useUsageStatsStore.getState();
    store.applyIncrementalEvent({ id: 1 } as UsageEventDetail);
    store.applyBulkEvents([{ id: 1 } as UsageEventDetail, { id: 2 } as UsageEventDetail]);
    const s = useUsageStatsStore.getState();
    expect(s.recentDetails).toHaveLength(2);
    expect(s.recentDetails[0].id).toBe(2);
  });
});

describe('resetRecent', () => {
  it('clears recentDetails and lastEventId', () => {
    const store = useUsageStatsStore.getState();
    store.applyIncrementalEvent({ id: 1 } as UsageEventDetail);
    store.resetRecent();
    const s = useUsageStatsStore.getState();
    expect(s.recentDetails).toEqual([]);
    expect(s.lastEventId).toBe(0);
  });
});
