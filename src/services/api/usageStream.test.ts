import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeUsageStream } from './usageStream';

describe('subscribeUsageStream', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('invokes onEvent with parsed snapshot payload', async () => {
    const payload = JSON.stringify({ total_requests: 5 });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: snapshot\ndata: ${payload}\n\n`));
        controller.close();
      },
    });

    global.fetch = vi.fn(async () =>
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ) as unknown as typeof fetch;

    const events: Array<{ type: string; payload?: unknown }> = [];
    const handle = subscribeUsageStream({
      getManagementKey: () => 'k',
      onEvent: (e) => events.push(e as { type: string; payload?: unknown }),
      baseDelayMs: 10,
      maxDelayMs: 100,
    });

    // Allow connect + reader to consume the stream.
    await vi.advanceTimersByTimeAsync(50);
    handle.close();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'snapshot', payload: { total_requests: 5 } });
  });

  it('reconnects with backoff after fetch error', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const statusChanges: string[] = [];
    const handle = subscribeUsageStream({
      getManagementKey: () => 'k',
      onEvent: () => {},
      onStatusChange: (s) => statusChanges.push(s),
      baseDelayMs: 100,
      maxDelayMs: 1000,
    });

    await vi.advanceTimersByTimeAsync(50);

    expect(statusChanges).toContain('connecting');
    expect(statusChanges).toContain('error');

    handle.close();
    expect(statusChanges[statusChanges.length - 1]).toBe('closed');
  });
});