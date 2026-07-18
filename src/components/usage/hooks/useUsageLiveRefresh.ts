import { useEffect } from 'react';
import { subscribeUsageStream } from '@/services/api/usageStream';
import { USAGE_STATS_STALE_TIME_MS, useUsageStatsStore } from '@/stores';
import { useAuthStore } from '@/stores/useAuthStore';

const USAGE_POLL_INTERVAL_MS = 1_000;
const FOREGROUND_REFRESH_DEDUPE_MS = 250;
const SILENT_REFRESH_DEBOUNCE_MS = 2_000;
const SILENT_REFRESH_THROTTLE_MS = 3_000;

export function useUsageLiveRefresh(timeRange: string, enabled = true) {
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);

  // Tab visibility / focus: trigger a forced refetch on foreground.
  useEffect(() => {
    if (!enabled) return;
    let lastForegroundRefreshAt = 0;
    const refreshOnForeground = () => {
      if (document.visibilityState === 'hidden') return;
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
  }, [enabled, loadUsageStats, timeRange]);

  // SSE + 1s polling fallback + debounced silent background refresh.
  useEffect(() => {
    if (!enabled) return;
    let pollingTimer: ReturnType<typeof setInterval> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSilentRefreshAt = 0;

    const refreshUsage = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      void loadUsageStats({
        force: true,
        staleTimeMs: USAGE_STATS_STALE_TIME_MS,
        timeRange,
      }).catch(() => {});
    };

    const triggerSilentRefresh = () => {
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
      pollingTimer = window.setInterval(refreshUsage, USAGE_POLL_INTERVAL_MS);
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
  }, [enabled, loadUsageStats, timeRange]);
}