/**
 * SSE subscription for usage statistics. Subscribes to
 * `/v0/management/usage/events` and surfaces usage_event / summary / heartbeat events.
 *
 * The native EventSource API does not support custom headers, so we use
 * `fetch` + ReadableStream and inject the Authorization header manually.
 */

import type { UsageDetail } from '../../stores/useUsageStatsStore';

export interface StreamSummary {
  total_requests?: number;
  total_tokens?: number;
  success_count?: number;
  failure_count?: number;
  latest_event_id: number;
}

export type StreamEvent =
  | { type: 'summary'; payload: StreamSummary }
  | { type: 'usage_event'; payload: UsageDetail }
  | { type: 'heartbeat'; ts: string };

export type StreamStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface UsageStreamHandle {
  status: () => StreamStatus;
  close: () => void;
}

export interface UsageStreamOptions {
  endpoint?: string;
  getManagementKey: () => string;
  getLastEventId?: () => number;
  onEvent?: (event: StreamEvent) => void;
  onUsageEvent?: (detail: UsageDetail) => void;
  onSummary?: (summary: StreamSummary) => void;
  onStatusChange?: (status: StreamStatus) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_ENDPOINT = '/v0/management/usage/events';
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

export function subscribeUsageStream(
  opts: UsageStreamOptions,
): UsageStreamHandle {
  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let status: StreamStatus = 'connecting';
  let attempt = 0;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (next: StreamStatus) => {
    status = next;
    opts.onStatusChange?.(next);
  };

  const scheduleReconnect = () => {
    if (closed) return;
    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    attempt++;
    reconnectTimer = setTimeout(connect, delay);
  };

  const parseBlock = (block: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    const data = dataLines.join('\n');
    try {
      if (event === 'summary') {
        const payload = JSON.parse(data) as StreamSummary;
        opts.onSummary?.(payload);
        opts.onEvent?.({ type: 'summary', payload });
      } else if (event === 'usage_event') {
        const payload = JSON.parse(data) as UsageDetail;
        opts.onUsageEvent?.(payload);
        opts.onEvent?.({ type: 'usage_event', payload });
      } else if (event === 'heartbeat') {
        opts.onEvent?.({ type: 'heartbeat', ts: new Date().toISOString() });
      }
    } catch {
      /* ignore malformed */
    }
  };

  const connect = () => {
    if (closed) return;
    setStatus('connecting');

    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    const key = opts.getManagementKey();
    if (key) headers.Authorization = `Bearer ${key}`;
    const lastId = opts.getLastEventId?.();
    if (lastId && lastId > 0) headers['Last-Event-ID'] = String(lastId);

    fetch(endpoint, {
      method: 'GET',
      headers,
      credentials: 'same-origin',
    })
      .then(async (response) => {
        if (!response.ok || !response.body) {
          setStatus('error');
          scheduleReconnect();
          return;
        }
        setStatus('open');
        attempt = 0;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (!closed) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let sep: number;
            while ((sep = buffer.indexOf('\n\n')) >= 0) {
              const block = buffer.slice(0, sep);
              buffer = buffer.slice(sep + 2);
              parseBlock(block);
            }
          }
        } catch {
          /* network errors during read */
        }

        if (!closed) scheduleReconnect();
      })
      .catch(() => {
        setStatus('error');
        scheduleReconnect();
      });
  };

  connect();

  return {
    status: () => status,
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      setStatus('closed');
    },
  };
}