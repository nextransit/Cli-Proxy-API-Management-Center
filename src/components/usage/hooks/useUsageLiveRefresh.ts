import { useEffect } from 'react';
import { subscribeUsageStream } from '@/services/api/usageStream';
import { USAGE_STATS_STALE_TIME_MS, useUsageStatsStore } from '@/stores';
import { useAuthStore } from '@/stores/useAuthStore';

const USAGE_POLL_FALLBACK_MS = 30_000;
const FOREGROUND_REFRESH_DEDUPE_MS = 250;
const SILENT_REFRESH_DEBOUNCE_MS = 2_000;
// Full-aggregate refreshes are expensive on long-running servers (every
// retained RequestDetail is re-serialized). Under continuous traffic the SSE
// event stream fires triggerSilentRefresh constantly, so keep the throttle
// generous: 15s keeps the aggregates aligned while avoiding refresh storms
// that freeze the UI on large windows. SSE events still drive incremental
// recentDetails updates between refreshes.
const SILENT_REFRESH_THROTTLE_MS = 15_000;
// Windows whose full snapshots are huge (every retained RequestDetail is
// serialized, then parsed and aggregated in the browser). Background full
// refreshes are skipped entirely for these: the SSE stream still applies
// incremental recentDetails updates, and fresh aggregates only arrive on the
// initial load or an explicit foreground/scope change.
const HEAVY_FULL_REFRESH_WINDOWS = ['all', '30d'];

export function useUsageLiveRefresh(timeRange: string, enabled = true) {
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);
  const isHeavyWindow = HEAVY_FULL_REFRESH_WINDOWS.includes(timeRange);

  // Tab visibility / focus: trigger a forced refetch on foreground.
  useEffect(() => {
    if (!enabled) return;
    let lastForegroundRefreshAt = 0;
    const refreshOnForeground = () => {
      if (document.visibilityState === 'hidden') return;
      if (isHeavyWindow) return;
      const now = Date.now();
      if (now - lastForegroundRefreshAt < FOREGROUND_REFRESH_DEDUPE_MS) return;
      lastForegroundRefreshAt = now;
      void loadUsageStats({
        force: true,
        supersedeInFlight: true,
        staleTimeMs: USAGE_STATS_STALE_TIME_MS,
        timeRange,
      }).catch(() => {});
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) refreshOnForeground();
    };
    document.addEventListener('visibilitychange', refreshOnForeground);
    window.addEventListener('focus', refreshOnForeground);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      document.removeEventListener('visibilitychange', refreshOnForeground);
      window.removeEventListener('focus', refreshOnForeground);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [enabled, loadUsageStats, timeRange, isHeavyWindow]);

  // SSE + 30s polling fallback (down from 1s to stop refresh storms while
  // the SSE stream is reconnecting) + debounced silent background refresh.
  useEffect(() => {
    if (!enabled) return;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSilentRefreshAt = 0;

    const refreshUsage = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      if (isHeavyWindow) return;
      void loadUsageStats({
        force: true,
        staleTimeMs: USAGE_STATS_STALE_TIME_MS,
        timeRange,
      }).catch(() => {});
    };

    const triggerSilentRefresh = () => {
      if (isHeavyWindow) return;
      const now = Date.now();
      if (now - lastSilentRefreshAt < SILENT_REFRESH_THROTTLE_MS) {
        // Already refreshed recently, just debounce-reset for the next batch
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          lastSilentRefreshAt = Date.now();
          void loadUsageStats({
            force: true,
            supersedeInFlight: true,
            staleTimeMs: 0,
            timeRange,
            silent: true,
          }).catch(() => {});
        }, SILENT_REFRESH_DEBOUNCE_MS);
        return;
      }
      // Not refreshed recently, wait for debounce
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        lastSilentRefreshAt = Date.now();
        void loadUsageStats({
          force: true,
          supersedeInFlight: true,
          staleTimeMs: 0,
          timeRange,
          silent: true,
        }).catch(() => {});
      }, SILENT_REFRESH_DEBOUNCE_MS);
    };

    const stopPolling = () => {
      if (!pollingTimer) return;
      window.clearInterval(pollingTimer);
      pollingTimer = null;
    };
    const startPolling = () => {
      if (pollingTimer) return;
      // 30s polling fallback replaces the previous 1s cadence. The original
      // cadence caused a refresh storm: every SSE backoff window (1s..30s)
      // triggered a full /usage fetch, which on long-running servers
      // re-serializes every retained RequestDetail. SSE events still drive
      // incremental updates between polls, so 30s is plenty.
      pollingTimer = window.setInterval(refreshUsage, USAGE_POLL_FALLBACK_MS);
    };

    const streamHandle = subscribeUsageStream({
      getManagementKey: () => useAuthStore.getState().managementKey ?? '',
      getLastEventId: () => useUsageStatsStore.getState().lastEventId,
      onUsageEvent: (detail) => {
        // Incrementally merge into recentDetails for instant display
        useUsageStatsStore.getState().applyIncrementalEvent(detail);
        // Trigger a debounced silent background refresh of aggregates
        triggerSilentRefresh();
      },
      onSummary: (s) => {
        // Reconnect summary: server already replayed missed events.
        // Just align the high-water-mark.
        useUsageStatsStore.setState({ lastEventId: s.latest_event_id });
        triggerSilentRefresh();
      },
      onStatusChange: (status) => {
        if (status === 'open') stopPolling();
        // Only restart polling when SSE has given up reconnecting (closed by
        // the client side) or when the stream closed from the server. The
        // 30s interval is a last-resort safety net, not the primary refresh
        // path: SSE events still drive onUsageEvent updates between polls.
        else if (status === 'error' || status === 'closed') startPolling();
      },
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
    });

    return () => {
      streamHandle.close();
      stopPolling();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [enabled, loadUsageStats, timeRange, isHeavyWindow]);
}