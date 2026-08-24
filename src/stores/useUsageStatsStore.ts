import { create } from 'zustand';
import { usageApi } from '@/services/api';
import { useAuthStore } from '@/stores/useAuthStore';
import { collectUsageDetails, computeKeyStatsFromDetails, type KeyStats, type UsageDetail } from '@/utils/usage';
import i18n from '@/i18n';

export const USAGE_STATS_STALE_TIME_MS = 240_000;
export const MAX_RECENT_DETAILS = 200;
export type { UsageDetail } from '@/utils/usage';

export interface UsageEventDetail {
  id: number;
  api_key?: string;
  model?: string;
  source?: string;
  auth_index?: string;
  request_id?: string;
  failed?: boolean;
  tokens?: {
    input: number;
    output: number;
    reasoning?: number;
    cached?: number;
    total: number;
  };
  requested_at?: string;
  duration_ms?: number;
  status_code?: number;
  thinking?: UsageDetail['thinking'];
  [key: string]: unknown;
}

export interface UsageStreamSummary {
  total_requests?: number;
  total_tokens?: number;
  success_count?: number;
  failure_count?: number;
  latest_event_id: number;
  requests_by_day?: Record<string, number>;
  tokens_by_day?: Record<string, number>;
}

export type LoadUsageStatsOptions = {
  force?: boolean;
  supersedeInFlight?: boolean;
  staleTimeMs?: number;
  timeRange?: string;
  silent?: boolean;
};

type UsageStatsSnapshot = Record<string, unknown>;

type UsageStatsState = {
  usage: UsageStatsSnapshot | null;
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  recentDetails: UsageEventDetail[];
  lastEventId: number;
  loading: boolean;
  error: string | null;
  lastRefreshedAt: number | null;
  scopeKey: string;
  loadUsageStats: (options?: LoadUsageStatsOptions) => Promise<void>;
  cancelUsageStatsLoad: () => void;
  clearUsageStats: () => void;
  applyIncrementalEvent: (detail: UsageEventDetail) => void;
  applyStreamSummary: (summary: UsageStreamSummary) => void;
  applyBulkEvents: (events: UsageEventDetail[]) => void;
  resetRecent: () => void;
};

const createEmptyKeyStats = (): KeyStats => ({ bySource: {}, byAuthIndex: {} });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toNumber = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const formatLocalDayKey = (timestampMs: number): string => {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildInlineDetail = (
  event: UsageEventDetail,
  apiKey: string,
  model: string,
  timestampMs: number,
): Record<string, unknown> => {
  const safeTimestamp = Number.isFinite(timestampMs) ? timestampMs : Date.now();
  return {
    event_id: event.id,
    timestamp: event.requested_at || new Date(safeTimestamp).toISOString(),
    source: event.source ?? '',
    auth_index: event.auth_index ?? null,
    request_id: event.request_id ?? '',
    latency_ms: event.duration_ms ?? 0,
    status_code: event.status_code ?? 0,
    failed: event.failed === true,
    tokens: {
      input_tokens: event.tokens?.input ?? 0,
      output_tokens: event.tokens?.output ?? 0,
      reasoning_tokens: event.tokens?.reasoning ?? 0,
      cached_tokens: event.tokens?.cached ?? 0,
      total_tokens: event.tokens?.total ?? 0,
    },
    thinking: event.thinking ?? null,
    request: null,
    model_info: null,
    __apiKey: apiKey,
    __modelName: model,
    __timestampMs: safeTimestamp,
  };
};

let usageRequestToken = 0;
let inFlightUsageRequest: {
  id: number;
  scopeKey: string;
  promise: Promise<void>;
  abortController: AbortController;
} | null = null;

const invalidateInFlightUsageRequest = () => {
  usageRequestToken += 1;
  inFlightUsageRequest?.abortController.abort();
  inFlightUsageRequest = null;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : i18n.t('usage_stats.loading_error');

export const useUsageStatsStore = create<UsageStatsState>((set, get) => ({
  usage: null,
  keyStats: createEmptyKeyStats(),
  usageDetails: [],
  recentDetails: [] as UsageEventDetail[],
  lastEventId: 0,
  loading: false,
  error: null,
  lastRefreshedAt: null,
  scopeKey: '',

  loadUsageStats: async (options = {}) => {
    const force = options.force === true;
    const supersedeInFlight = options.supersedeInFlight === true;
    const staleTimeMs = options.staleTimeMs ?? USAGE_STATS_STALE_TIME_MS;
    const timeRange = options.timeRange || 'all';
    const silent = options.silent === true;
    const { apiBase = '', managementKey = '' } = useAuthStore.getState();
    const scopeKey = `${apiBase}::${managementKey}::usage:${timeRange}`;
    const state = get();
    const scopeChanged = state.scopeKey !== scopeKey;

    // Reuse same-scope requests unless a foreground refresh must replace stale work.
    if (inFlightUsageRequest && inFlightUsageRequest.scopeKey === scopeKey) {
      if (!supersedeInFlight) {
        await inFlightUsageRequest.promise;
        return;
      }
      invalidateInFlightUsageRequest();
    }

    // A request for another connection or time range must not update this scope.
    if (inFlightUsageRequest && inFlightUsageRequest.scopeKey !== scopeKey) {
      invalidateInFlightUsageRequest();
    }

    const fresh =
      !scopeChanged &&
      state.lastRefreshedAt !== null &&
      Date.now() - state.lastRefreshedAt < staleTimeMs;

    if (!force && fresh) {
      return;
    }

    // Note: switching windows deliberately keeps the previous usage view in
    // place until the new snapshot arrives (stale-while-revalidate). Clearing
    // it here would flash the empty state and stall the page while a large
    // window (e.g. "all") parses and aggregates; keeping the old data lets
    // the UI stay interactive under `isRefreshing`.

    const requestId = (usageRequestToken += 1);
    const abortController = new AbortController();
    if (!silent) {
      set({ loading: true, error: null, scopeKey });
    } else {
      set({ error: null, scopeKey });
    }

    const requestPromise = (async () => {
      try {
        const usageResponse = await usageApi.getUsage({
          timeRange,
          signal: abortController.signal,
        });
        const rawUsage = usageResponse?.usage ?? usageResponse;
        const usage =
          rawUsage && typeof rawUsage === 'object' ? (rawUsage as UsageStatsSnapshot) : null;

        if (requestId !== usageRequestToken) return;

        const usageDetails = collectUsageDetails(usage);
        const update: Partial<UsageStatsState> = {
          usage,
          keyStats: computeKeyStatsFromDetails(usageDetails),
          usageDetails,
          error: null,
          lastRefreshedAt: Date.now(),
          scopeKey,
        };
        if (!silent) {
          update.loading = false;
        }
        set(update as UsageStatsState);
      } catch (error: unknown) {
        if (requestId !== usageRequestToken) return;
        const message = getErrorMessage(error);
        const update: Partial<UsageStatsState> = { error: message, scopeKey };
        if (!silent) update.loading = false;
        set(update as UsageStatsState);
        throw new Error(message);
      } finally {
        if (inFlightUsageRequest?.id === requestId) {
          inFlightUsageRequest = null;
        }
      }
    })();

    inFlightUsageRequest = {
      id: requestId,
      scopeKey,
      promise: requestPromise,
      abortController,
    };
    await requestPromise;
  },

  cancelUsageStatsLoad: () => {
    invalidateInFlightUsageRequest();
    set({ loading: false, error: null });
  },

  applyIncrementalEvent: (detail: UsageEventDetail) => {
    const { recentDetails, lastEventId, usage, scopeKey } = get();
    if (detail.id <= lastEventId) return;

    const recentNext = [detail, ...recentDetails];
    if (recentNext.length > MAX_RECENT_DETAILS) recentNext.length = MAX_RECENT_DETAILS;

    const update: Partial<UsageStatsState> = {
      recentDetails: recentNext,
      lastEventId: detail.id,
      lastRefreshedAt: Date.now(),
      error: null,
    };

    // For the all-time view, fold the SSE event into the in-store usage
    // snapshot so the "今日请求" / "今日 Token" / "今日花费" cards refresh
    // immediately. Without this, the cards would stay frozen on the last
    // full snapshot value until the next /usage reload (potentially 60s+).
    if (scopeKey.endsWith(':usage:all') && usage) {
      const tokens = detail.tokens?.total ?? 0;
      const isFailed = detail.failed === true;
      const apiKey = detail.api_key || '_default';
      const model = detail.model || 'unknown';
      const timestampMs = detail.requested_at ? Date.parse(detail.requested_at) : NaN;
      const dayKey = Number.isFinite(timestampMs)
        ? formatLocalDayKey(timestampMs)
        : formatLocalDayKey(Date.now());

      const merged: UsageStatsSnapshot = { ...usage };
      merged.total_requests = toNumber(merged.total_requests) + 1;
      merged.total_tokens = toNumber(merged.total_tokens) + tokens;
      merged.success_count = toNumber(merged.success_count) + (isFailed ? 0 : 1);
      merged.failure_count = toNumber(merged.failure_count) + (isFailed ? 1 : 0);

      const prevRequestsByDay = (merged.requests_by_day ?? {}) as Record<string, number>;
      merged.requests_by_day = {
        ...prevRequestsByDay,
        [dayKey]: (prevRequestsByDay[dayKey] ?? 0) + 1,
      };
      const prevTokensByDay = (merged.tokens_by_day ?? {}) as Record<string, number>;
      merged.tokens_by_day = {
        ...prevTokensByDay,
        [dayKey]: (prevTokensByDay[dayKey] ?? 0) + tokens,
      };

      const apis = (merged.apis ?? {}) as Record<string, unknown>;
      const apiEntry = isRecord(apis[apiKey]) ? { ...(apis[apiKey] as Record<string, unknown>) } : {};
      apiEntry.total_requests = toNumber(apiEntry.total_requests) + 1;
      apiEntry.total_tokens = toNumber(apiEntry.total_tokens) + tokens;
      apiEntry.success_count = toNumber(apiEntry.success_count) + (isFailed ? 0 : 1);
      apiEntry.failure_count = toNumber(apiEntry.failure_count) + (isFailed ? 1 : 0);

      const models = isRecord(apiEntry.models) ? { ...(apiEntry.models as Record<string, unknown>) } : {};
      const modelEntry = isRecord(models[model])
        ? { ...(models[model] as Record<string, unknown>) }
        : {};
      modelEntry.total_requests = toNumber(modelEntry.total_requests) + 1;
      modelEntry.total_tokens = toNumber(modelEntry.total_tokens) + tokens;
      modelEntry.success_count = toNumber(modelEntry.success_count) + (isFailed ? 0 : 1);
      modelEntry.failure_count = toNumber(modelEntry.failure_count) + (isFailed ? 1 : 0);

      const detailList = Array.isArray(modelEntry.details)
        ? [buildInlineDetail(detail, apiKey, model, timestampMs), ...(modelEntry.details as unknown[])]
        : [buildInlineDetail(detail, apiKey, model, timestampMs)];
      if (detailList.length > MAX_RECENT_DETAILS) detailList.length = MAX_RECENT_DETAILS;
      modelEntry.details = detailList;

      models[model] = modelEntry;
      apiEntry.models = models;
      apis[apiKey] = apiEntry;
      merged.apis = apis;

      update.usage = merged;
    }

    set(update as UsageStatsState);
  },

  applyStreamSummary: (summary: UsageStreamSummary) => {
    const state = get();
    const update: Partial<UsageStatsState> = {
      lastEventId: Math.max(state.lastEventId, summary.latest_event_id),
      error: null,
    };

    if (state.scopeKey.endsWith(':usage:all')) {
      const mergedUsage: UsageStatsSnapshot = { ...(state.usage ?? {}) };

      // Counter fields are monotonic on the server, but the client may
      // have applied more recent SSE events before the server's snapshot
      // arrived. Take the max so the cards never go backwards.
      const takeMax = (current: unknown, incoming: number): number =>
        Math.max(toNumber(current), incoming);
      if (typeof summary.total_requests === 'number') {
        mergedUsage.total_requests = takeMax(mergedUsage.total_requests, summary.total_requests);
      }
      if (typeof summary.total_tokens === 'number') {
        mergedUsage.total_tokens = takeMax(mergedUsage.total_tokens, summary.total_tokens);
      }
      if (typeof summary.success_count === 'number') {
        mergedUsage.success_count = takeMax(mergedUsage.success_count, summary.success_count);
      }
      if (typeof summary.failure_count === 'number') {
        mergedUsage.failure_count = takeMax(mergedUsage.failure_count, summary.failure_count);
      }

      // Daily aggregates are monotonic on the server. Merge the per-day
      // maps so the "今日请求" / "今日 Token" cards refresh alongside the
      // SSE event stream without waiting on a heavy snapshot reload.
      if (summary.requests_by_day && Object.keys(summary.requests_by_day).length > 0) {
        const prev = (mergedUsage.requests_by_day ?? {}) as Record<string, number>;
        const next: Record<string, number> = { ...prev };
        for (const [day, count] of Object.entries(summary.requests_by_day)) {
          const prevCount = next[day] ?? 0;
          if (count > prevCount) next[day] = count;
        }
        mergedUsage.requests_by_day = next;
      }
      if (summary.tokens_by_day && Object.keys(summary.tokens_by_day).length > 0) {
        const prev = (mergedUsage.tokens_by_day ?? {}) as Record<string, number>;
        const next: Record<string, number> = { ...prev };
        for (const [day, count] of Object.entries(summary.tokens_by_day)) {
          const prevCount = next[day] ?? 0;
          if (count > prevCount) next[day] = count;
        }
        mergedUsage.tokens_by_day = next;
      }

      update.usage = mergedUsage;
      update.lastRefreshedAt = Date.now();
    }

    set(update as UsageStatsState);
  },

  applyBulkEvents: (events: UsageEventDetail[]) => {
    const { recentDetails, lastEventId } = get();
    const filtered = events.filter(e => e.id > lastEventId);
    if (filtered.length === 0) return;
    const maxId = Math.max(...filtered.map(e => e.id));
    const merged = [...filtered, ...recentDetails]
      .sort((a, b) => b.id - a.id)
      .slice(0, MAX_RECENT_DETAILS);
    set({ recentDetails: merged, lastEventId: maxId });
  },

  resetRecent: () => set({ recentDetails: [], lastEventId: 0 }),

  clearUsageStats: () => {
    invalidateInFlightUsageRequest();
    set({
      usage: null,
      keyStats: createEmptyKeyStats(),
      usageDetails: [],
      recentDetails: [],
      lastEventId: 0,
      loading: false,
      error: null,
      lastRefreshedAt: null,
      scopeKey: ''
    });
  }
}));
