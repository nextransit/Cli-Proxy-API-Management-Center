import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardViewResponse } from '@/services/api/usage';

const mocks = vi.hoisted(() => ({
  getDashboardView: vi.fn(),
  authState: {
    apiBase: 'http://127.0.0.1:8317',
    managementKey: 'test-key',
  },
}));

vi.mock('@/services/api/usage', () => ({
  dashboardApi: {
    getDashboardView: mocks.getDashboardView,
  },
}));

vi.mock('@/stores/useAuthStore', () => ({
  useAuthStore: {
    getState: () => mocks.authState,
  },
}));

import { useDashboardViewStore } from './useDashboardViewStore';

const buildResponse = (overrides: Partial<DashboardViewResponse['dashboard']> = {}): DashboardViewResponse => {
  // Use real wall-clock time so incremental events with Date.now() land on top
  // of the existing latest_requests entries.
  const now = Date.now();
  const buckets = Array.from({ length: 12 }, (_, index) => ({
    index,
    start_ms: now - (12 - index) * 5 * 60 * 1000,
    end_ms: now - (12 - index - 1) * 5 * 60 * 1000,
    label: '00:0' + index,
    requests: 1,
    tokens: 100,
    failures: 0,
    avg_latency_ms: 250,
  }));
  return {
    dashboard: {
      total_requests: 12,
      success_count: 12,
      failure_count: 0,
      total_tokens: 1200,
      failure_rate: 0,
      latest_event_id: 7,
      generated_at: new Date(now).toISOString(),
      bucket_count: 12,
      bucket_size_ms: 5 * 60 * 1000,
      bucket_start_ms: now - 12 * 5 * 60 * 1000,
      flow_buckets: buckets,
      model_top: [
        { model: 'gpt-5', requests: 8, tokens: 800, share_percent: 66.7, avg_latency_ms: 250, success_rate: 100 },
        { model: 'gemini', requests: 4, tokens: 400, share_percent: 33.3, avg_latency_ms: 250, success_rate: 100 },
      ],
      latest_requests: [
        {
          event_id: 7,
          timestamp: new Date(now).toISOString(),
          model: 'gpt-5',
          api_key: 'src',
          failed: false,
          status_code: 200,
          duration_ms: 250,
          input_tokens: 40,
          output_tokens: 60,
          total_tokens: 100,
        },
      ],
      window_start: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
      window_end: new Date(now).toISOString(),
      window_hours: 24,
      window_seconds: 86400,
      window_tokens: 1200,
      window_requests: 12,
      window_failures: 0,
      window_successes: 12,
      ...overrides,
    },
    generated_at: new Date(now).toISOString(),
  };
};

describe('useDashboardViewStore', () => {
  beforeEach(() => {
    useDashboardViewStore.getState().resetDashboardView();
    vi.clearAllMocks();
    mocks.authState.apiBase = 'http://127.0.0.1:8317';
    mocks.authState.managementKey = 'test-key';
  });

  it('loads the dashboard view and stores the aggregates', async () => {
    mocks.getDashboardView.mockResolvedValueOnce(buildResponse());

    await useDashboardViewStore.getState().loadDashboardView({ window: '24h' });
    const state = useDashboardViewStore.getState();

    expect(state.view?.model_top).toHaveLength(2);
    expect(state.view?.flow_buckets).toHaveLength(12);
    expect(state.view?.latest_requests).toHaveLength(1);
    expect(state.lastEventId).toBe(7);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(mocks.getDashboardView).toHaveBeenCalledWith({ window: '24h', signal: expect.any(AbortSignal) });
  });

  it('reuses the cached view within the stale window', async () => {
    mocks.getDashboardView.mockResolvedValue(buildResponse());

    await useDashboardViewStore.getState().loadDashboardView({ window: '24h' });
    mocks.getDashboardView.mockClear();
    await useDashboardViewStore.getState().loadDashboardView({ window: '24h' });

    expect(mocks.getDashboardView).not.toHaveBeenCalled();
  });

  it('refetches on force even when cache is warm', async () => {
    mocks.getDashboardView.mockResolvedValue(buildResponse());
    await useDashboardViewStore.getState().loadDashboardView({ window: '24h' });
    mocks.getDashboardView.mockClear();

    await useDashboardViewStore.getState().loadDashboardView({ window: '24h', force: true });
    expect(mocks.getDashboardView).toHaveBeenCalledTimes(1);
  });

  it('appends an incremental event without resetting the aggregates', async () => {
    mocks.getDashboardView.mockResolvedValueOnce(buildResponse());
    await useDashboardViewStore.getState().loadDashboardView({ window: '24h' });
    const before = useDashboardViewStore.getState().view;
    const beforeTokens = before?.window_tokens ?? 0;
    const beforeRequests = before?.window_requests ?? 0;

    useDashboardViewStore.getState().applyIncrementalEvent({
      event_id: 99,
      timestamp: new Date(Date.now() + 60_000).toISOString(),
      model: 'gpt-5',
      api_key: 'src',
      failed: false,
      status_code: 200,
      duration_ms: 200,
      input_tokens: 50,
      output_tokens: 50,
      total_tokens: 100,
    });
    const after = useDashboardViewStore.getState().view;
    expect(after?.window_tokens).toBe(beforeTokens + 100);
    expect(after?.window_requests).toBe(beforeRequests + 1);
    const head = after?.latest_requests[0];
    expect(head?.event_id).toBe(99);
  });
});
