import { useEffect, type RefObject } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

export type ResizeCallback = (element: Element, size: ElementSize) => void;

export function useEChartsResize(
  ref: RefObject<Element | null>,
  callback: ResizeCallback,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      callback(element, { width, height });
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, callback]);
}
