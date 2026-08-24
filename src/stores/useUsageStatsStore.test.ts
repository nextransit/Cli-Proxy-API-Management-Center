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

  it('keeps the previous window view while a new scope loads', async () => {
    mocks.getUsage.mockResolvedValueOnce({ total_requests: 1 });

    await useUsageStatsStore.getState().loadUsageStats({
      force: true,
      timeRange: '24h',
    });
    expect(useUsageStatsStore.getState().usage).toEqual({ total_requests: 1 });

    const secondRequest = createDeferred<Record<string, unknown>>();
    mocks.getUsage.mockReturnValueOnce(secondRequest.promise);

    const switchLoad = useUsageStatsStore.getState().loadUsageStats({
      force: true,
      timeRange: 'all',
    });
    // The previous window's view must stay visible while the new snapshot
    // is still in flight (no flash to the empty state on heavy windows).
    expect(useUsageStatsStore.getState().usage).toEqual({ total_requests: 1 });

    secondRequest.resolve({ total_requests: 2 });
    await switchLoad;

    expect(useUsageStatsStore.getState().usage).toEqual({ total_requests: 2 });
  });

  it('preserves the SSE high-water mark when a full snapshot finishes', async () => {
    mocks.getUsage.mockResolvedValueOnce({ total_requests: 1 });
    const liveEvent = { id: 42, model: 'gpt-live' };
    useUsageStatsStore.setState({
      lastEventId: 42,
      recentDetails: [liveEvent],
    });

    await useUsageStatsStore.getState().loadUsageStats({
      force: true,
      timeRange: 'all',
    });

    expect(useUsageStatsStore.getState().lastEventId).toBe(42);
    expect(useUsageStatsStore.getState().recentDetails).toEqual([liveEvent]);
  });

  it('cancels a suspended request without surfacing an error', async () => {
    const request = createDeferred<Record<string, unknown>>();
    let requestSignal: AbortSignal | undefined;
    mocks.getUsage.mockImplementationOnce((options: { signal?: AbortSignal }) => {
      requestSignal = options.signal;
      options.signal?.addEventListener('abort', () => {
        request.reject(new Error('aborted'));
      });
      return request.promise;
    });

    const load = useUsageStatsStore.getState().loadUsageStats({
      force: true,
      timeRange: 'all',
    });
    useUsageStatsStore.getState().cancelUsageStatsLoad();

    await expect(load).resolves.toBeUndefined();
    expect(requestSignal?.aborted).toBe(true);
    expect(useUsageStatsStore.getState()).toMatchObject({
      loading: false,
      error: null,
    });
  });
});

interface UsageEventDetail {
  [key: string]: unknown;
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
    expect(s.lastRefreshedAt).not.toBeNull();
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

  it('folds the SSE event into the all-time usage snapshot', () => {
    const todayKey = new Date().toISOString().slice(0, 10);
    useUsageStatsStore.setState({
      usage: {
        total_requests: 10,
        total_tokens: 100,
        success_count: 9,
        failure_count: 1,
        requests_by_day: { [todayKey]: 1 },
        tokens_by_day: { [todayKey]: 50 },
        apis: {
          'apikey-1': {
            total_requests: 1,
            total_tokens: 50,
            success_count: 1,
            failure_count: 0,
            models: { 'gpt-4o': { total_requests: 1, total_tokens: 50, details: [] } },
          },
        },
      },
      scopeKey: 'http://127.0.0.1:8317::test-key::usage:all',
    });

    useUsageStatsStore.getState().applyIncrementalEvent({
      id: 100,
      api_key: 'apikey-1',
      model: 'gpt-4o',
      failed: false,
      tokens: { input: 3, output: 7, total: 10 },
      requested_at: new Date().toISOString(),
    } as UsageEventDetail);

    const state = useUsageStatsStore.getState();
    expect(state.usage).toMatchObject({
      total_requests: 11,
      total_tokens: 110,
      success_count: 10,
      failure_count: 1,
      requests_by_day: { [todayKey]: 2 },
      tokens_by_day: { [todayKey]: 60 },
    });
    const apiEntry = (state.usage as Record<string, unknown>).apis as Record<
      string,
      Record<string, unknown>
    >;
    expect(apiEntry['apikey-1']).toMatchObject({
      total_requests: 2,
      total_tokens: 60,
      success_count: 2,
      failure_count: 0,
    });
    const modelEntry = (apiEntry['apikey-1'].models as Record<string, Record<string, unknown>>)[
      'gpt-4o'
    ];
    expect(modelEntry.total_requests).toBe(2);
    expect(modelEntry.total_tokens).toBe(60);
    expect(Array.isArray(modelEntry.details)).toBe(true);
    expect((modelEntry.details as unknown[])[0]).toMatchObject({
      event_id: 100,
      failed: false,
      tokens: { total_tokens: 10 },
      __modelName: 'gpt-4o',
    });
  });

  it('counts a failed SSE event toward failure_count', () => {
    useUsageStatsStore.setState({
      usage: {
        total_requests: 1,
        total_tokens: 5,
        success_count: 1,
        failure_count: 0,
        requests_by_day: {},
        tokens_by_day: {},
        apis: {},
      },
      scopeKey: 'http://127.0.0.1:8317::test-key::usage:all',
    });

    useUsageStatsStore.getState().applyIncrementalEvent({
      id: 200,
      api_key: 'k',
      model: 'm',
      failed: true,
      tokens: { input: 0, output: 0, total: 0 },
      requested_at: new Date().toISOString(),
    } as UsageEventDetail);

    const usage = useUsageStatsStore.getState().usage as Record<string, unknown>;
    expect(usage.total_requests).toBe(2);
    expect(usage.failure_count).toBe(1);
    expect(usage.success_count).toBe(1);
  });

  it('does not mutate the usage snapshot outside the all-time scope', () => {
    useUsageStatsStore.setState({
      usage: {
        total_requests: 5,
        apis: {},
        requests_by_day: {},
        tokens_by_day: {},
      },
      scopeKey: 'http://127.0.0.1:8317::test-key::usage:24h',
    });

    useUsageStatsStore.getState().applyIncrementalEvent({
      id: 300,
      api_key: 'k',
      model: 'm',
      failed: false,
      tokens: { input: 1, output: 1, total: 2 },
      requested_at: new Date().toISOString(),
    } as UsageEventDetail);

    const usage = useUsageStatsStore.getState().usage as Record<string, unknown>;
    expect(usage.total_requests).toBe(5);
    expect(useUsageStatsStore.getState().recentDetails).toHaveLength(1);
  });
});

describe('applyStreamSummary', () => {
  beforeEach(() => {
    useUsageStatsStore.getState().clearUsageStats();
  });

  it('updates all-time totals and refresh timestamp without replacing details', () => {
    const usage = {
      total_requests: 10,
      total_tokens: 100,
      success_count: 9,
      failure_count: 1,
      apis: { key: { models: {} } },
    };
    useUsageStatsStore.setState({
      usage,
      scopeKey: 'http://127.0.0.1:8317::test-key::usage:all',
    });

    useUsageStatsStore.getState().applyStreamSummary({
      total_requests: 12,
      total_tokens: 130,
      success_count: 10,
      failure_count: 2,
      latest_event_id: 77,
    });

    const state = useUsageStatsStore.getState();
    expect(state.usage).toEqual({
      ...usage,
      total_requests: 12,
      total_tokens: 130,
      success_count: 10,
      failure_count: 2,
    });
    expect(state.lastEventId).toBe(77);
    expect(state.lastRefreshedAt).not.toBeNull();
  });

  it('hydrates an empty all-time snapshot from the stream summary', () => {
    useUsageStatsStore.setState({
      usage: null,
      scopeKey: 'http://127.0.0.1:8317::test-key::usage:all',
    });

    useUsageStatsStore.getState().applyStreamSummary({
      total_requests: 12,
      total_tokens: 130,
      success_count: 10,
      failure_count: 2,
      latest_event_id: 77,
    });

    expect(useUsageStatsStore.getState()).toMatchObject({
      usage: {
        total_requests: 12,
        total_tokens: 130,
        success_count: 10,
        failure_count: 2,
      },
      lastEventId: 77,
      error: null,
    });
    expect(useUsageStatsStore.getState().lastRefreshedAt).not.toBeNull();
  });

  it('does not apply lifetime totals to a bounded time range', () => {
    const usage = { total_requests: 10, total_tokens: 100 };
    useUsageStatsStore.setState({
      usage,
      scopeKey: 'http://127.0.0.1:8317::test-key::usage:24h',
    });

    useUsageStatsStore.getState().applyStreamSummary({
      total_requests: 999,
      total_tokens: 9999,
      latest_event_id: 88,
    });

    const state = useUsageStatsStore.getState();
    expect(state.usage).toBe(usage);
    expect(state.lastEventId).toBe(88);
  });

  it('merges per-day requests and tokens into the all-time snapshot', () => {
    const todayKey = '2026-08-24';
    const usage = {
      total_requests: 10,
      total_tokens: 100,
      success_count: 9,
      failure_count: 1,
      requests_by_day: { [todayKey]: 1, '2026-08-23': 5 },
      tokens_by_day: { [todayKey]: 50, '2026-08-23': 200 },
      apis: { key: { models: {} } },
    };
    useUsageStatsStore.setState({
      usage,
      scopeKey: 'http://127.0.0.1:8317::test-key::usage:all',
    });

    useUsageStatsStore.getState().applyStreamSummary({
      total_requests: 14,
      total_tokens: 250,
      success_count: 12,
      failure_count: 2,
      latest_event_id: 91,
      requests_by_day: { [todayKey]: 4, '2026-08-23': 5 },
      tokens_by_day: { [todayKey]: 150, '2026-08-23': 200 },
    });

    const state = useUsageStatsStore.getState();
    expect(state.usage).toEqual({
      ...usage,
      total_requests: 14,
      total_tokens: 250,
      success_count: 12,
      failure_count: 2,
      requests_by_day: { [todayKey]: 4, '2026-08-23': 5 },
      tokens_by_day: { [todayKey]: 150, '2026-08-23': 200 },
    });
    expect(state.lastEventId).toBe(91);
  });

  it('keeps the higher per-day value when the stream lags behind the snapshot', () => {
    const todayKey = '2026-08-24';
    const usage = {
      requests_by_day: { [todayKey]: 7 },
      tokens_by_day: { [todayKey]: 700 },
      apis: { key: { models: {} } },
    };
    useUsageStatsStore.setState({
      usage,
      scopeKey: 'http://127.0.0.1:8317::test-key::usage:all',
    });

    useUsageStatsStore.getState().applyStreamSummary({
      latest_event_id: 12,
      requests_by_day: { [todayKey]: 3 },
      tokens_by_day: { [todayKey]: 300 },
    });

    const state = useUsageStatsStore.getState();
    expect(state.usage?.requests_by_day).toEqual({ [todayKey]: 7 });
    expect(state.usage?.tokens_by_day).toEqual({ [todayKey]: 700 });
  });

  it('keeps lifetime counters when the stream summary is older than the local fold', () => {
    const usage = {
      total_requests: 20,
      total_tokens: 200,
      success_count: 18,
      failure_count: 2,
      requests_by_day: {},
      tokens_by_day: {},
      apis: { key: { models: {} } },
    };
    useUsageStatsStore.setState({
      usage,
      scopeKey: 'http://127.0.0.1:8317::test-key::usage:all',
    });

    useUsageStatsStore.getState().applyStreamSummary({
      total_requests: 10,
      total_tokens: 100,
      success_count: 9,
      failure_count: 1,
      latest_event_id: 9,
    });

    const state = useUsageStatsStore.getState();
    expect(state.usage).toMatchObject({
      total_requests: 20,
      total_tokens: 200,
      success_count: 18,
      failure_count: 2,
    });
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
