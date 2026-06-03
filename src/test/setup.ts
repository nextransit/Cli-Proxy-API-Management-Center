import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node 22+ ships an experimental built-in `localStorage` global that
// shadows jsdom's implementation but is broken without `--localstorage-file`.
// Install a minimal in-memory Storage shim so tests have a working API.
if (typeof globalThis.localStorage?.clear !== 'function') {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: shim, writable: true, configurable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', { value: shim, writable: true, configurable: true });
  }
}

afterEach(() => {
  cleanup();
});
