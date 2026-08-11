import { create } from 'zustand';
import { dashboardApi, type DashboardLatestRequest, type DashboardView, type DashboardViewResponse } from '@/services/api/usage';

export interface DashboardIncrementalEvent {
  event_id?: number | string;
  id?: number | string;
  timestamp?: string;
  requested_at?: string;
  model?: string;
  api_key?: string;
  failed?: boolean;
  tokens?: { input?: number; output?: number; total?: number };
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  duration_ms?: number;
  status_code?: number;
  [key: string]: unknown;
}
import { useAuthStore } from '@/stores/useAuthStore';

export const DASHBOARD_VIEW_STALE_TIME_MS = 2_000;

export type LoadDashboardViewOptions = {
  force?: boolean;
  supersedeInFlight?: boolean;
  silent?: boolean;
  window?: string;
};

type DashboardViewState = {
  view: DashboardView | null;
  loading: boolean;
  error: string | null;
  lastRefreshedAt: number | null;
  lastEventId: number;
  lastEtag: string | null;
  scopeKey: string;
  loadDashboardView: (options?: LoadDashboardViewOptions) => Promise<void>;
  applyIncrementalEvent: (detail: DashboardIncrementalEvent) => void;
  resetDashboardView: () => void;
};

let requestToken = 0;
let inFlight: {
  id: number;
  scopeKey: string;
  promise: Promise<void>;
  abortController: AbortController;
} | null = null;

const invalidateInFlight = () => {
  requestToken += 1;
  inFlight?.abortController.abort();
  inFlight = null;
};

const toEventId = (id: unknown): number => {
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  if (typeof id === 'string' && id.trim() !== '') {
    const parsed = Number(id);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const computeEventIdFromDetail = (detail: { event_id?: unknown; id?: unknown; timestamp?: unknown; requested_at?: unknown }): number => {
  const direct = toEventId(detail.event_id) || toEventId(detail.id);
  if (direct) return direct;
  const ts = detail.timestamp ?? detail.requested_at;
  if (typeof ts === 'string') {
    const ms = Date.parse(ts);
    if (Number.isFinite(ms)) return ms;
  }
  return 0;
};

export const useDashboardViewStore = create<DashboardViewState>((set, get) => ({
  view: null,
  loading: false,
  error: null,
  lastRefreshedAt: null,
  lastEventId: 0,
  lastEtag: null,
  scopeKey: '',

  loadDashboardView: async (options = {}) => {
    const force = options.force === true;
    const supersedeInFlight = options.supersedeInFlight === true;
    const silent = options.silent === true;
    const window = options.window ?? '24h';
    const { apiBase = '', managementKey = '' } = useAuthStore.getState();
    const scopeKey = `${apiBase}::${managementKey}::dashboard-view:${window}`;
    const state = get();

    if (inFlight && inFlight.scopeKey === scopeKey) {
      if (!supersedeInFlight) {
        await inFlight.promise;
        return;
      }
      invalidateInFlight();
    }

    if (!force && !supersedeInFlight) {
      const last = state.lastRefreshedAt ?? 0;
      if (Date.now() - last < DASHBOARD_VIEW_STALE_TIME_MS && state.scopeKey === scopeKey && state.view) {
        return;
      }
    }

    const requestId = (requestToken += 1);
    const abortController = new AbortController();
    if (!silent) {
      set({ loading: true, error: null, scopeKey });
    } else {
      set({ error: null, scopeKey });
    }

    const promise = (async () => {
      try {
        const response = await dashboardApi.getDashboardView({
          window,
          signal: abortController.signal,
          etag: state.lastEtag,
        });
        if (requestId !== requestToken) return;
        if (response.status === 304) {
          // Not modified: keep the cached view, just refresh the freshness
          // marker and remember the (possibly renewed) ETag for the next poll.
          set({
            lastRefreshedAt: Date.now(),
            lastEtag: response.etag,
            loading: false,
            error: null,
            scopeKey,
          });
          return;
        }
        const payload = response.data as DashboardViewResponse;
        set({
          view: payload.dashboard,
          lastRefreshedAt: Date.now(),
          lastEtag: response.etag,
          lastEventId: toEventId(payload.dashboard.latest_event_id) || state.lastEventId,
          loading: false,
          error: null,
          scopeKey,
        });
      } catch (error: unknown) {
        if (requestId !== requestToken) return;
        const message = error instanceof Error ? error.message : String(error ?? '');
        // Always clear loading on failure. silent only suppresses the proactive
        // loading=true transition on entry; it must not leave the UI stuck on SYNC
        // when the request itself fails or is aborted by a supersede.
        const update: Partial<DashboardViewState> = {
          error: message,
          loading: false,
          scopeKey,
        };
        set(update as DashboardViewState);
        throw error;
      } finally {
        if (inFlight?.id === requestId) {
          inFlight = null;
        }
      }
    })();

    inFlight = { id: requestId, scopeKey, promise, abortController };
    await promise;
  },

  applyIncrementalEvent: (detail) => {
    const view = get().view;
    if (!view) return;
    const eventId = computeEventIdFromDetail(detail);
    const latestRequests = Array.isArray(view.latest_requests) ? view.latest_requests : [];
    const timestamp =
      typeof detail.timestamp === 'string'
        ? detail.timestamp
        : typeof detail.requested_at === 'string'
          ? detail.requested_at
          : new Date().toISOString();
    const totalTokens =
      typeof detail.total_tokens === 'number'
        ? detail.total_tokens
        : (detail.tokens?.total ?? 0);
    const inputTokens =
      typeof detail.input_tokens === 'number'
        ? detail.input_tokens
        : (detail.tokens?.input ?? 0);
    const outputTokens =
      typeof detail.output_tokens === 'number'
        ? detail.output_tokens
        : (detail.tokens?.output ?? 0);

    const nextLatest: DashboardLatestRequest = {
      event_id: eventId,
      timestamp,
      model: detail.model ?? '',
      api_key: detail.api_key ?? '',
      failed: detail.failed === true,
      status_code: typeof detail.status_code === 'number' ? detail.status_code : 0,
      duration_ms: typeof detail.duration_ms === 'number' ? detail.duration_ms : 0,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: totalTokens,
    };

    const merged = [nextLatest, ...latestRequests]
      .filter((row, index, arr) => {
        if (!row.event_id) return true;
        return arr.findIndex(other => other.event_id === row.event_id) === index;
      })
      .sort((a, b) => Date.parse(b.timestamp || '') - Date.parse(a.timestamp || ''))
      .slice(0, Math.max(view.latest_requests?.length ?? 0, 7));

    const flowBuckets = Array.isArray(view.flow_buckets) ? view.flow_buckets : [];
    const flowSize = flowBuckets.length;
    const nowMs = Date.now();
    const bucketStartMs = typeof view.bucket_start_ms === 'number'
      ? view.bucket_start_ms
      : nowMs - (flowSize || 12) * (typeof view.bucket_size_ms === 'number' ? view.bucket_size_ms : 5 * 60 * 1000);
    const bucketSizeMs = typeof view.bucket_size_ms === 'number' && view.bucket_size_ms > 0
      ? view.bucket_size_ms
      : 5 * 60 * 1000;
    const bucketIndex = Math.max(
      0,
      Math.min(flowSize - 1, Math.floor((nowMs - bucketStartMs) / bucketSizeMs))
    );
    const updatedBuckets = flowBuckets.map((bucket, index) => {
      if (index !== bucketIndex) return bucket;
      const updated = { ...bucket };
      updated.requests = (updated.requests ?? 0) + 1;
      updated.tokens = (updated.tokens ?? 0) + totalTokens;
      if (detail.failed === true) updated.failures = (updated.failures ?? 0) + 1;
      if (typeof detail.duration_ms === 'number' && detail.duration_ms > 0) {
        const sampleCount = (updated.requests ?? 1);
        const prevAvg = updated.avg_latency_ms ?? 0;
        updated.avg_latency_ms = (prevAvg * (sampleCount - 1) + detail.duration_ms) / sampleCount;
      }
      return updated;
    });

    const updatedView: DashboardView = {
      ...view,
      latest_requests: merged,
      flow_buckets: updatedBuckets,
      latest_event_id: Math.max(
        toEventId(view.latest_event_id) || 0,
        eventId || 0
      ) || view.latest_event_id,
      window_requests: (view.window_requests ?? 0) + 1,
      window_tokens: (view.window_tokens ?? 0) + totalTokens,
      window_failures: (view.window_failures ?? 0) + (detail.failed === true ? 1 : 0),
      window_successes: (view.window_successes ?? 0) + (detail.failed === true ? 0 : 1),
    };

    set({
      view: updatedView,
      lastEventId: Math.max(get().lastEventId, eventId),
      lastRefreshedAt: Date.now(),
    });
  },

  resetDashboardView: () => {
    invalidateInFlight();
    set({
      view: null,
      loading: false,
      error: null,
      lastRefreshedAt: null,
      lastEventId: 0,
      lastEtag: null,
      scopeKey: '',
    });
  },
}));
