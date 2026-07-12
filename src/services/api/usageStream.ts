/**
 * SSE subscription for usage statistics. Subscribes to
 * `/v0/management/usage/events` and surfaces snapshot / heartbeat events.
 *
 * The native EventSource API does not support custom headers, so we use
 * `fetch` + ReadableStream and inject the Authorization header manually.
 */

import type { UsagePayload } from '../../components/usage/hooks/useUsageData';

export type StreamEvent =
  | { type: 'snapshot'; payload: UsagePayload }
  | { type: 'heartbeat'; ts: string };

export type StreamStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface UsageStreamHandle {
  status: () => StreamStatus;
  close: () => void;
}

export interface UsageStreamOptions {
  endpoint?: string;
  getManagementKey: () => string;
  onEvent: (event: StreamEvent) => void;
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
    if (event === 'snapshot') {
      try {
        const payload = JSON.parse(data) as UsagePayload;
        opts.onEvent({ type: 'snapshot', payload });
      } catch {
        /* ignore malformed */
      }
    } else if (event === 'heartbeat') {
      opts.onEvent({ type: 'heartbeat', ts: new Date().toISOString() });
    }
  };

  const connect = () => {
    if (closed) return;
    setStatus('connecting');

    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    const key = opts.getManagementKey();
    if (key) headers.Authorization = `Bearer ${key}`;

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
