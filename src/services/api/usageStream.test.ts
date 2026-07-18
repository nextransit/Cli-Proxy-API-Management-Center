import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeUsageStream } from './usageStream';

describe('subscribeUsageStream', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('invokes onEvent with parsed usage_event payload', async () => {
    const payload = JSON.stringify({ timestamp: '2024-01-01T00:00:00Z', failed: false, tokens: { total_tokens: 100 } });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: usage_event\ndata: ${payload}\n\n`));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn(async () =>
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
    expect(events[0].type).toBe('usage_event');
    expect(events[0]).toEqual({ type: 'usage_event', payload: JSON.parse(payload) });
  });

  it('invokes onEvent with parsed summary payload', async () => {
    const payload = JSON.stringify({ total_requests: 5, latest_event_id: 42 });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: summary\ndata: ${payload}\n\n`));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn(async () =>
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

    await vi.advanceTimersByTimeAsync(50);
    handle.close();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'summary', payload: { total_requests: 5, latest_event_id: 42 } });
  });

  it('invokes onUsageEvent and onSummary callbacks directly', async () => {
    const usagePayload = JSON.stringify({ timestamp: '2024-01-01T00:00:00Z', failed: false, tokens: { total_tokens: 100 } });
    const summaryPayload = JSON.stringify({ total_requests: 5, latest_event_id: 42 });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: usage_event\ndata: ${usagePayload}\n\n`));
        controller.enqueue(encoder.encode(`event: summary\ndata: ${summaryPayload}\n\n`));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn(async () =>
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    ) as unknown as typeof fetch;

    const usageEvents: unknown[] = [];
    const summaries: unknown[] = [];
    const handle = subscribeUsageStream({
      getManagementKey: () => 'k',
      onUsageEvent: (d) => usageEvents.push(d),
      onSummary: (s) => summaries.push(s),
      baseDelayMs: 10,
      maxDelayMs: 100,
    });

    await vi.advanceTimersByTimeAsync(50);
    handle.close();

    expect(usageEvents).toHaveLength(1);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({ total_requests: 5, latest_event_id: 42 });
  });

  it('sends Last-Event-ID header when getLastEventId returns > 0', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: heartbeat\ndata: {}\n\n'));
        controller.close();
      },
    });

    let capturedHeaders: Headers | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedHeaders = init?.headers as Headers;
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    const handle = subscribeUsageStream({
      getManagementKey: () => 'k',
      getLastEventId: () => 99,
      onEvent: () => {},
      baseDelayMs: 10,
      maxDelayMs: 100,
    });

    await vi.advanceTimersByTimeAsync(50);
    handle.close();

    expect(capturedHeaders).toBeDefined();
    expect((capturedHeaders as unknown as Record<string, string>)['Last-Event-ID']).toBe('99');
  });

  it('does not send Last-Event-ID when getLastEventId returns 0', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: heartbeat\ndata: {}\n\n'));
        controller.close();
      },
    });

    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = vi.fn(async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    const handle = subscribeUsageStream({
      getManagementKey: () => 'k',
      getLastEventId: () => 0,
      onEvent: () => {},
      baseDelayMs: 10,
      maxDelayMs: 100,
    });

    await vi.advanceTimersByTimeAsync(50);
    handle.close();

    expect(capturedHeaders).toBeDefined();
    expect((capturedHeaders as Record<string, string>)['Last-Event-ID']).toBeUndefined();
  });

  it('reconnects with backoff after fetch error', async () => {
    globalThis.fetch = vi.fn(async () => {
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