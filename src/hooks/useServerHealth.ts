import { useEffect, useState } from 'react';

export type ServerHealthState = 'unknown' | 'live' | 'down';

export interface ServerHealthSnapshot {
  state: ServerHealthState;
  latencyMs: number | null;
  lastCheckedAt: number | null;
}

const DEFAULT_ENDPOINT = '/healthz';
const DEFAULT_INTERVAL_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000;

async function probeHealth(endpoint: string, signal: AbortSignal): Promise<number> {
  const start = performance.now();
  const response = await fetch(endpoint, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) {
    throw new Error(`status ${response.status}`);
  }
  return Math.round(performance.now() - start);
}

export interface UseServerHealthOptions {
  endpoint?: string;
  intervalMs?: number;
  enabled?: boolean;
}

export function useServerHealth(options: UseServerHealthOptions = {}): ServerHealthSnapshot {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const enabled = options.enabled ?? true;

  const [snapshot, setSnapshot] = useState<ServerHealthSnapshot>({
    state: 'unknown',
    latencyMs: null,
    lastCheckedAt: null,
  });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined;

    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      const timeoutController = new AbortController();
      const timeout = window.setTimeout(() => timeoutController.abort(), PROBE_TIMEOUT_MS);
      const combinedSignal = controller.signal;
      // Combine signals so manual cancel also wins.
      const onCancel = () => timeoutController.abort();
      combinedSignal.addEventListener('abort', onCancel, { once: true });

      try {
        const latency = await probeHealth(endpoint, timeoutController.signal);
        if (cancelled || combinedSignal.aborted) return;
        setSnapshot({ state: 'live', latencyMs: latency, lastCheckedAt: Date.now() });
      } catch {
        if (cancelled || combinedSignal.aborted) return;
        setSnapshot({ state: 'down', latencyMs: null, lastCheckedAt: Date.now() });
      } finally {
        window.clearTimeout(timeout);
        combinedSignal.removeEventListener('abort', onCancel);
      }
    };

    void run();
    const timer = window.setInterval(() => void run(), intervalMs);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [endpoint, intervalMs, enabled]);

  return snapshot;
}
