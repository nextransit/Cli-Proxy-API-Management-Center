import { useEffect } from 'react';

const noop = () => {};
// Module-level handle so the foreground visibilitychange/focus/pageshow
// effect can start the 30s polling fallback that the SSE effect may have
// stopped while the tab was hidden. Initialised lazily by the SSE effect.
let moduleStartPolling: () => void = noop;
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
  // Also nudge the SSE effect to restart its 30s polling fallback, because
  // browsers may have suspended the EventSource without firing any
  // status change while the tab was hidden.
  useEffect(() => {
    if (!enabled) return;
    let lastForegroundRefreshAt = 0;
    const refreshOnForeground = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastForegroundRefreshAt < FOREGROUND_REFRESH_DEDUPE_MS) return;
      lastForegroundRefreshAt = now;
      // Heavy windows ("all", "30d") skip the foreground refresh, but
      // we still need to re-arm the 30s polling fallback that the SSE
      // effect may have stopped while the tab was hidden — otherwise
      // the page sits frozen until SSE itself errors.
      if (!isHeavyWindow) {
        void loadUsageStats({
          force: true,
          supersedeInFlight: true,
          staleTimeMs: USAGE_STATS_STALE_TIME_MS,
          timeRange,
        }).catch(() => {});
      }
      moduleStartPolling();
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

    const isDocumentVisible = () =>
      typeof document === 'undefined' || document.visibilityState !== 'hidden';

    const refreshUsage = () => {
      // The 30s polling fallback exists specifically so the page keeps
      // refreshing even when SSE has gone quiet or been stopped. For
      // heavy windows ("all", "30d") the SSE effect deliberately keeps
      // polling running at all times, so refreshUsage must NOT skip
      // heavy windows — otherwise the page freezes after every tab
      // switch. We still skip while the document is hidden to avoid
      // burning CPU while the tab is in the background.
      if (!isDocumentVisible()) return;
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
        // SSE is the primary path while the tab is visible. While hidden
        // the browser may suspend the EventSource; keep the 30s polling
        // safety net armed so a foreground refresh always has a fallback.
        // Heavy windows ("all", "30d") skip the foreground refresh, so SSE
        // is the only live path there — keep polling running even when
        // SSE is open so backgrounding the tab doesn't freeze the page.
        if (status === 'open' && isDocumentVisible() && !isHeavyWindow) {
          stopPolling();
        } else if (status === 'error' || status === 'closed') {
          startPolling();
        } else if (status === 'open' && isHeavyWindow) {
          // Defensive: ensure polling is alive for heavy windows.
          startPolling();
        }
      },
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
    });

    // Publish the polling controls so the foreground effect can start
    // them after a visibilitychange/focus/pageshow, even if the SSE
    // effect itself has already stopped polling while the tab was
    // hidden.
    moduleStartPolling = startPolling;

    return () => {
      streamHandle.close();
      stopPolling();
      if (debounceTimer) clearTimeout(debounceTimer);
      moduleStartPolling = noop;
    };
  }, [enabled, loadUsageStats, timeRange, isHeavyWindow]);
}