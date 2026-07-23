import { useEffect } from 'react';
import { subscribeUsageStream } from '@/services/api/usageStream';
import { useDashboardViewStore } from '@/stores/useDashboardViewStore';
import { useAuthStore } from '@/stores/useAuthStore';

const DASHBOARD_SSE_THROTTLE_MS = 3_000;

/**
 * Subscribes to the usage SSE stream and incrementally merges each new event
 * into the dashboard-view store, refreshing the dashboard without forcing the
 * expensive /usage endpoint to re-fetch every event.
 *
 * Compared with useUsageLiveRefresh this hook does not poll, does not trigger
 * silent full-snapshot reloads, and stays out of the way of the existing
 * UsagePage refresh logic.
 */
export function useDashboardLiveRefresh(enabled = true) {
  const loadDashboardView = useDashboardViewStore((state) => state.loadDashboardView);

  useEffect(() => {
    if (!enabled) return;

    let lastRefreshAt = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const handle = subscribeUsageStream({
      getManagementKey: () => useAuthStore.getState().managementKey ?? '',
      getLastEventId: () => useDashboardViewStore.getState().lastEventId,
      onUsageEvent: (detail) => {
        useDashboardViewStore.getState().applyIncrementalEvent(detail);

        const now = Date.now();
        if (now - lastRefreshAt < DASHBOARD_SSE_THROTTLE_MS) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            lastRefreshAt = Date.now();
            void loadDashboardView({ silent: true, supersedeInFlight: true }).catch(() => {});
          }, DASHBOARD_SSE_THROTTLE_MS);
          return;
        }
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        lastRefreshAt = now;
        void loadDashboardView({ silent: true, supersedeInFlight: true }).catch(() => {});
      },
      onSummary: () => {
        // Reconnect summary aligns the high-water mark; the snapshot itself
        // is already represented by the in-flight view.
      },
      onStatusChange: () => {},
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
    });

    return () => {
      closed = true;
      handle.close();
      if (debounceTimer) clearTimeout(debounceTimer);
      void closed;
    };
  }, [enabled, loadDashboardView]);
}
