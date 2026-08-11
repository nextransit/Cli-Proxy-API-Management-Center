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
  failed?: boolean;
  tokens?: { input: number; output: number; total: number };
  requested_at?: string;
  duration_ms?: number;
  status_code?: number;
  [key: string]: unknown;
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
  clearUsageStats: () => void;
  applyIncrementalEvent: (detail: UsageEventDetail) => void;
  applyBulkEvents: (events: UsageEventDetail[]) => void;
  resetRecent: () => void;
};

const createEmptyKeyStats = (): KeyStats => ({ bySource: {}, byAuthIndex: {} });

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
          update.recentDetails = [];
          update.lastEventId = 0;
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

  applyIncrementalEvent: (detail: UsageEventDetail) => {
    const { recentDetails, lastEventId } = get();
    if (detail.id <= lastEventId) return;
    const next = [detail, ...recentDetails];
    if (next.length > MAX_RECENT_DETAILS) next.length = MAX_RECENT_DETAILS;
    set({ recentDetails: next, lastEventId: detail.id });
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
      loading: false,
      error: null,
      lastRefreshedAt: null,
      scopeKey: ''
    });
  }
}));
