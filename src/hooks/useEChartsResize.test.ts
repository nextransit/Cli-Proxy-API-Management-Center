import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEChartsResize } from './useEChartsResize';

type ResizeObserverCallback = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;

interface MockObserver {
  callback: ResizeObserverCallback;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger: (width: number, height: number) => void;
}

let observers: MockObserver[] = [];

beforeEach(() => {
  observers = [];
  globalThis.ResizeObserver = class {
    private observer: MockObserver;
    constructor(cb: ResizeObserverCallback) {
      this.observer = {
        callback: cb,
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
        trigger: (w: number, h: number) => cb([{ contentRect: { width: w, height: h } }]),
      };
      observers.push(this.observer);
    }
    observe(el: Element) { this.observer.observe(el); }
    unobserve(el: Element) { this.observer.unobserve(el); }
    disconnect() { this.observer.disconnect(); }
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  // @ts-expect-error - reset
  delete globalThis.ResizeObserver;
});

describe('useEChartsResize', () => {
  it('does not create an observer when the ref is null', () => {
    const ref = { current: null };
    const callback = vi.fn();
    renderHook(() => useEChartsResize(ref, callback));
    expect(observers).toHaveLength(0);
  });

  it('creates an observer and observes the element when the ref is set', () => {
    const el = document.createElement('div');
    const ref = { current: el };
    const callback = vi.fn();
    renderHook(() => useEChartsResize(ref, callback));
    expect(observers).toHaveLength(1);
    expect(observers[0]?.observe).toHaveBeenCalledWith(el);
  });

  it('invokes the callback with the new size when the observer fires', () => {
    const el = document.createElement('div');
    const ref = { current: el };
    const callback = vi.fn();
    renderHook(() => useEChartsResize(ref, callback));
    observers[0]?.trigger(640, 480);
    expect(callback).toHaveBeenCalledWith(el, { width: 640, height: 480 });
  });

  it('disconnects the observer on unmount', () => {
    const el = document.createElement('div');
    const ref = { current: el };
    const callback = vi.fn();
    const { unmount } = renderHook(() => useEChartsResize(ref, callback));
    unmount();
    expect(observers[0]?.disconnect).toHaveBeenCalled();
  });
});
