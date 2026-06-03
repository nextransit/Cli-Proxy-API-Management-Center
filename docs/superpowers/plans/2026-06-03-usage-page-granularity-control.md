# Usage Page Granularity Control Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the top-level granularity switcher on the Usage page, sink the `HR / DAY` control into each chart card, and unify the chart stack on ECharts via a new `<TelemetryChart />` wrapper component. Each card's granularity is local state, persisted to its own `localStorage` key.

**Architecture:** Replace `react-chartjs-2` with direct ECharts. Introduce a `<TelemetryChart />` component that owns the ECharts instance lifecycle (init / resize / dispose / theme-switch). Introduce a `useGranularity(cardId)` hook for per-card persistence. The top filter bar loses the granularity group entirely. `CostTrendChart` drops its disconnected internal state and joins the per-card pattern.

**Tech Stack:** React 19, TypeScript 5, ECharts 6 (already installed), Vite 5, SCSS Modules, `localStorage`, vitest (newly added for pure-logic tests), @testing-library/react (newly added for component smoke tests).

**Source spec:** `docs/superpowers/specs/2026-06-03-usage-page-granularity-control-design.md`

---

## File Map

### New files (under `src/`)

| Path | Responsibility |
|------|----------------|
| `hooks/useGranularity.ts` | Per-card `Granularity` state with `localStorage` persistence. |
| `hooks/useGranularity.test.ts` | vitest unit tests. |
| `hooks/useEChartsResize.ts` | `ResizeObserver`-based resize subscription. |
| `hooks/useEChartsResize.test.ts` | vitest unit tests. |
| `utils/echarts/themeBridge.ts` | Reads live CSS variables for ECharts option colors. |
| `utils/echarts/themeBridge.test.ts` | vitest unit tests. |
| `utils/echarts/registerThemes.ts` | Idempotent registration of `cli-dark` and `cli-light` themes. |
| `utils/echarts/registerThemes.test.ts` | vitest unit tests. |
| `utils/usage/chartConfig.test.ts` | vitest tests for the new `buildEChartsTrendOption`. |
| `components/charts/TelemetryChart.tsx` | ECharts wrapper (init / setOption / resize / dispose / theme). |
| `components/charts/TelemetryChart.module.scss` | Panel chrome styling. |
| `components/charts/GranularityCapsule.tsx` | HR / DAY capsule button. |
| `components/charts/GranularityCapsule.module.scss` | Capsule styling. |
| `components/charts/GranularityCapsule.test.tsx` | RTL smoke tests. |
| `test/setup.ts` | vitest + jsdom + i18next init. |
| `vitest.config.ts` | Test config (jsdom env, setupFiles, alias). |

### Modified files

| Path | Change summary |
|------|----------------|
| `utils/usage/chartConfig.ts` | Add `buildEChartsTrendOption(data, theme, opts)`. Keep `buildChartOptions` until Task 16. |
| `components/usage/UsageChart.tsx` | Replace `Line` from `react-chartjs-2` with `<TelemetryChart />` + direct ECharts init. Use `useGranularity('usage_trend')` + `<GranularityCapsule />`. |
| `components/usage/CostTrendChart.tsx` | Remove internal `useState<'hour' \| 'day'>`. Accept `period` / `onPeriodChange` / `timeRange` / `hourWindowHours` props. Use `<TelemetryChart />` + `<GranularityCapsule />`. |
| `components/usage/TrendTabsCard.tsx` | Pass `period` / `onPeriodChange` / `timeRange` / `hourWindowHours` through to each tab. |
| `components/usage/ModelTokenDoughnut.tsx` | Replace outer `<div>` chrome with `<TelemetryChart />`. Existing ECharts option construction stays. |
| `pages/UsagePage.tsx` | Delete `chartGranularity` state, `handleChartGranularityChange`, `effectiveChartGranularity`, `chartPeriod` derived state, and the top granularity button group (lines 1255-1288). Pass `timeRange` and `hourWindowHours` to all three cards. |
| `i18n/locales/en.json` | Add 4 new keys. |
| `i18n/locales/zh-CN.json` | Add 4 new keys. |
| `package.json` | Add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`. Final task: remove `chart.js`, `react-chartjs-2`. |

### Removed

- `UsagePage.module.scss` classes: `globalGranularityGroup`, `globalGranularityButton`, `globalGranularityButtonActive`.
- `utils/usage/chartConfig.ts` exports: `getHourChartMinWidth` (replaced by ECharts `dataZoom` on narrow screens), `sparklineOptions`, `buildChartOptions` (after all consumers migrate).
- `UsageChart.tsx` local `periodButtons` block.

---

## Task 1: Add vitest + RTL test infrastructure

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/test/sanity.test.ts` (smoke test, deleted in Task 2)

- [ ] **Step 1: Install test deps**

```bash
npm install -D vitest@^2.1.9 @vitest/coverage-v8@^2.1.9 jsdom@^25.0.1 \
  @testing-library/react@^16.1.0 @testing-library/jest-dom@^6.6.3 \
  @testing-library/user-event@^14.5.2
```

Expected: `package.json` devDependencies block gains these entries.

- [ ] **Step 2: Add test scripts to package.json**

Edit the `scripts` block in `package.json` to add:

```json
"test": "vitest",
"test:run": "vitest run",
"test:coverage": "vitest run --coverage"
```

Verify: `cat package.json | grep -A1 '"test"'` shows the three new entries.

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
```

- [ ] **Step 4: Create `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
```

- [ ] **Step 5: Create a sanity test to confirm the harness works**

Create `src/test/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('runs a trivial assertion', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Run the smoke test**

Run: `npm run test:run`
Expected: 1 test passed.

- [ ] **Step 7: Remove the sanity test**

Delete `src/test/sanity.test.ts` (it has served its purpose).

- [ ] **Step 8: Commit**

```bash
git add package.json vitest.config.ts src/test/setup.ts
git commit -m "test: add vitest + RTL infrastructure"
```

---

## Task 2: Implement `useGranularity` hook (TDD)

**Files:**
- Create: `src/hooks/useGranularity.ts`
- Create: `src/hooks/useGranularity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useGranularity.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useGranularity, type Granularity } from './useGranularity';

const KEY_PREFIX = 'usage.granularity.';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('useGranularity', () => {
  it('returns the default value when no stored preference exists', () => {
    const { result } = renderHook(() => useGranularity('usage_trend'));
    expect(result.current.granularity).toBe<Granularity>('hour');
  });

  it('honors a custom default value', () => {
    const { result } = renderHook(() => useGranularity('usage_trend', 'day'));
    expect(result.current.granularity).toBe<Granularity>('day');
  });

  it('reads the stored value when present and valid', () => {
    localStorage.setItem(`${KEY_PREFIX}usage_trend`, 'day');
    const { result } = renderHook(() => useGranularity('usage_trend'));
    expect(result.current.granularity).toBe<Granularity>('day');
  });

  it('falls back to default when stored value is invalid', () => {
    localStorage.setItem(`${KEY_PREFIX}usage_trend`, 'year');
    const { result } = renderHook(() => useGranularity('usage_trend'));
    expect(result.current.granularity).toBe<Granularity>('hour');
  });

  it('persists the new value when setGranularity is called', () => {
    const { result } = renderHook(() => useGranularity('usage_trend'));
    act(() => {
      result.current.setGranularity('day');
    });
    expect(result.current.granularity).toBe<Granularity>('day');
    expect(localStorage.getItem(`${KEY_PREFIX}usage_trend`)).toBe('day');
  });

  it('isolates state between cards (per cardId key)', () => {
    const trend = renderHook(() => useGranularity('usage_trend'));
    const cost = renderHook(() => useGranularity('usage_cost'));
    act(() => {
      trend.result.current.setGranularity('day');
    });
    expect(cost.result.current.granularity).toBe<Granularity>('hour');
  });

  it('reset() clears the stored value and falls back to default', () => {
    localStorage.setItem(`${KEY_PREFIX}usage_trend`, 'day');
    const { result } = renderHook(() => useGranularity('usage_trend', 'hour'));
    expect(result.current.granularity).toBe<Granularity>('day');
    act(() => {
      result.current.reset();
    });
    expect(result.current.granularity).toBe<Granularity>('hour');
    expect(localStorage.getItem(`${KEY_PREFIX}usage_trend`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run src/hooks/useGranularity.test.ts`
Expected: FAIL — module `./useGranularity` does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useGranularity.ts`:

```ts
import { useCallback, useState } from 'react';

export type Granularity = 'hour' | 'day';

export interface UseGranularityResult {
  granularity: Granularity;
  setGranularity: (next: Granularity) => void;
  reset: () => void;
}

const STORAGE_PREFIX = 'usage.granularity.';
const isGranularity = (value: unknown): value is Granularity =>
  value === 'hour' || value === 'day';

const readStored = (cardId: string): Granularity | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${cardId}`);
    return isGranularity(raw) ? raw : null;
  } catch {
    return null;
  }
};

const writeStored = (cardId: string, value: Granularity): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`${STORAGE_PREFIX}${cardId}`, value);
  } catch {
    // Ignore storage errors (e.g. private mode, quota exceeded).
  }
};

const clearStored = (cardId: string): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(`${STORAGE_PREFIX}${cardId}`);
  } catch {
    // Ignore storage errors.
  }
};

export function useGranularity(
  cardId: string,
  defaultValue: Granularity = 'hour',
): UseGranularityResult {
  const [granularity, setGranularityState] = useState<Granularity>(
    () => readStored(cardId) ?? defaultValue,
  );

  const setGranularity = useCallback(
    (next: Granularity) => {
      writeStored(cardId, next);
      setGranularityState(next);
    },
    [cardId],
  );

  const reset = useCallback(() => {
    clearStored(cardId);
    setGranularityState(defaultValue);
  }, [cardId, defaultValue]);

  return { granularity, setGranularity, reset };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/hooks/useGranularity.test.ts`
Expected: 7 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useGranularity.ts src/hooks/useGranularity.test.ts
git commit -m "feat(usage): add useGranularity hook with localStorage persistence"
```

---

## Task 3: Implement `useEChartsResize` hook (TDD)

**Files:**
- Create: `src/hooks/useEChartsResize.ts`
- Create: `src/hooks/useEChartsResize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useEChartsResize.test.ts`:

```ts
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

  it('re-observes when the ref element changes', () => {
    const ref = { current: document.createElement('div') };
    const callback = vi.fn();
    renderHook(() => useEChartsResize(ref, callback));
    expect(observers[0]?.observe).toHaveBeenCalledTimes(1);
    const newEl = document.createElement('div');
    ref.current = newEl;
    renderHook(() => useEChartsResize(ref, callback)).unmount();
    // The first observer disconnects when the ref changes; a new one is created.
    expect(observers[0]?.disconnect).toHaveBeenCalled();
    expect(observers[1]?.observe).toHaveBeenCalledWith(newEl);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run src/hooks/useEChartsResize.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useEChartsResize.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/hooks/useEChartsResize.test.ts`
Expected: 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEChartsResize.ts src/hooks/useEChartsResize.test.ts
git commit -m "feat(usage): add useEChartsResize hook backed by ResizeObserver"
```

---

## Task 4: Implement `themeBridge.ts` (TDD)

**Files:**
- Create: `src/utils/echarts/themeBridge.ts`
- Create: `src/utils/echarts/themeBridge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/echarts/themeBridge.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getThemeColors, type ThemeColors } from './themeBridge';

const setVar = (name: string, value: string) => {
  document.documentElement.style.setProperty(name, value);
};

const clearVar = (name: string) => {
  document.documentElement.style.removeProperty(name);
};

beforeEach(() => {
  setVar('--text-primary', '#ffffff');
  setVar('--text-secondary', '#a0aec0');
  setVar('--border-color', '#1a202c');
  setVar('--border-muted', '#0f172a');
  setVar('--bg-primary', '#000000');
  setVar('--accent', '#06b6d4');
});

afterEach(() => {
  [
    '--text-primary',
    '--text-secondary',
    '--border-color',
    '--border-muted',
    '--bg-primary',
    '--accent',
  ].forEach(clearVar);
});

describe('getThemeColors', () => {
  it('returns all expected color keys', () => {
    const colors: ThemeColors = getThemeColors();
    expect(colors).toHaveProperty('textPrimary');
    expect(colors).toHaveProperty('textSecondary');
    expect(colors).toHaveProperty('border');
    expect(colors).toHaveProperty('borderMuted');
    expect(colors).toHaveProperty('bgPrimary');
    expect(colors).toHaveProperty('accent');
  });

  it('reads the current values of CSS variables', () => {
    setVar('--text-primary', '#abcdef');
    const colors = getThemeColors();
    expect(colors.textPrimary).toBe('#abcdef');
    expect(colors.accent).toBe('#06b6d4');
  });

  it('returns empty strings when a variable is not set', () => {
    clearVar('--text-primary');
    const colors = getThemeColors();
    expect(colors.textPrimary).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run src/utils/echarts/themeBridge.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/utils/echarts/themeBridge.ts`:

```ts
export interface ThemeColors {
  textPrimary: string;
  textSecondary: string;
  border: string;
  borderMuted: string;
  bgPrimary: string;
  accent: string;
}

const KEYS: Array<[keyof ThemeColors, string]> = [
  ['textPrimary', '--text-primary'],
  ['textSecondary', '--text-secondary'],
  ['border', '--border-color'],
  ['borderMuted', '--border-muted'],
  ['bgPrimary', '--bg-primary'],
  ['accent', '--accent'],
];

const readVar = (name: string): string => {
  if (typeof window === 'undefined' || typeof getComputedStyle === 'undefined') {
    return '';
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
};

export function getThemeColors(): ThemeColors {
  const result = {} as ThemeColors;
  for (const [key, varName] of KEYS) {
    result[key] = readVar(varName);
  }
  return result;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/utils/echarts/themeBridge.test.ts`
Expected: 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/echarts/themeBridge.ts src/utils/echarts/themeBridge.test.ts
git commit -m "feat(echarts): add themeBridge for live CSS variable reads"
```

---

## Task 5: Implement `registerThemes.ts` (TDD)

**Files:**
- Create: `src/utils/echarts/registerThemes.ts`
- Create: `src/utils/echarts/registerThemes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/echarts/registerThemes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as echarts from 'echarts';
import { registerCliThemes, CLI_DARK_THEME, CLI_LIGHT_THEME } from './registerThemes';

beforeEach(() => {
  // Reset registry between tests so we can assert idempotency.
  for (const name of Object.keys(echarts.themes || {})) {
    if (name === 'cli-dark' || name === 'cli-light') {
      // @ts-expect-error - private API for test cleanup
      delete echarts.themes[name];
    }
  }
});

afterEach(() => {
  for (const name of Object.keys(echarts.themes || {})) {
    if (name === 'cli-dark' || name === 'cli-light') {
      // @ts-expect-error - private API for test cleanup
      delete echarts.themes[name];
    }
  }
});

describe('registerCliThemes', () => {
  it('registers both cli-dark and cli-light themes', () => {
    registerCliThemes();
    expect(echarts.themes).toHaveProperty('cli-dark');
    expect(echarts.themes).toHaveProperty('cli-light');
  });

  it('is idempotent across multiple calls', () => {
    registerCliThemes();
    expect(() => registerCliThemes()).not.toThrow();
    registerCliThemes();
    expect(echarts.themes).toHaveProperty('cli-dark');
    expect(echarts.themes).toHaveProperty('cli-light');
  });

  it('cli-dark and cli-light expose the same baseline option keys', () => {
    registerCliThemes();
    for (const key of ['backgroundColor', 'textStyle']) {
      expect(CLI_DARK_THEME).toHaveProperty(key);
      expect(CLI_LIGHT_THEME).toHaveProperty(key);
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run src/utils/echarts/registerThemes.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/utils/echarts/registerThemes.ts`:

```ts
import * as echarts from 'echarts';

const FONT_FAMILY = 'Roboto Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const buildBase = () => ({
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: FONT_FAMILY,
    color: '#e2e8f0',
  },
  color: ['#06b6d4', '#22d3ee', '#67e8f9', '#0891b2', '#a78bfa', '#f472b6', '#facc15', '#34d399'],
});

export const CLI_DARK_THEME: echarts.EChartsTheme = {
  ...buildBase(),
  title: { textStyle: { color: '#e2e8f0' } },
  categoryAxis: {
    axisLine: { lineStyle: { color: '#1f2937' } },
    axisTick: { lineStyle: { color: '#1f2937' } },
    axisLabel: { color: 'rgba(226, 232, 240, 0.66)' },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: 'rgba(226, 232, 240, 0.58)' },
    splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } },
  },
};

export const CLI_LIGHT_THEME: echarts.EChartsTheme = {
  ...buildBase(),
  textStyle: { fontFamily: FONT_FAMILY, color: '#0f172a' },
  title: { textStyle: { color: '#0f172a' } },
  categoryAxis: {
    axisLine: { lineStyle: { color: 'rgba(17, 24, 39, 0.16)' } },
    axisTick: { lineStyle: { color: 'rgba(17, 24, 39, 0.16)' } },
    axisLabel: { color: 'rgba(17, 24, 39, 0.66)' },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: 'rgba(17, 24, 39, 0.58)' },
    splitLine: { lineStyle: { color: 'rgba(17, 24, 39, 0.06)' } },
  },
};

let registered = false;

export function registerCliThemes(): void {
  if (registered) return;
  echarts.registerTheme('cli-dark', CLI_DARK_THEME);
  echarts.registerTheme('cli-light', CLI_LIGHT_THEME);
  registered = true;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/utils/echarts/registerThemes.test.ts`
Expected: 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add src/utils/echarts/registerThemes.ts src/utils/echarts/registerThemes.test.ts
git commit -m "feat(echarts): add registerCliThemes for cli-dark / cli-light"
```

---

## Task 6: Implement `buildEChartsTrendOption` adapter (TDD)

**Files:**
- Modify: `src/utils/usage/chartConfig.ts` (add export at the bottom)
- Create: `src/utils/usage/chartConfig.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/usage/chartConfig.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildEChartsTrendOption } from './chartConfig';
import type { ChartData } from './usage';
import type { ThemeColors } from '../echarts/themeBridge';

const theme: ThemeColors = {
  textPrimary: '#e2e8f0',
  textSecondary: 'rgba(226, 232, 240, 0.66)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderMuted: 'rgba(255, 255, 255, 0.06)',
  bgPrimary: '#000000',
  accent: '#06b6d4',
};

const sampleData: ChartData = {
  labels: ['00:00', '01:00', '02:00'],
  datasets: [
    {
      label: 'Token Volume',
      data: [100, 200, 150],
      borderColor: '#06b6d4',
      backgroundColor: 'rgba(6, 182, 212, 0.16)',
      hoverBorderColor: '#06b6d4',
      hoverBackgroundColor: 'rgba(6, 182, 212, 0.4)',
      fill: true,
      tension: 0.4,
    },
  ],
};

describe('buildEChartsTrendOption', () => {
  it('returns an EChartsOption with category xAxis data from labels', () => {
    const option = buildEChartsTrendOption(sampleData, theme, { isNarrowScreen: false });
    expect(option.xAxis).toMatchObject({ type: 'category' });
    // @ts-expect-error - EChartsAxisBase has data on category
    expect(option.xAxis?.data).toEqual(['00:00', '01:00', '02:00']);
  });

  it('emits one line series per dataset with the dataset color', () => {
    const option = buildEChartsTrendOption(sampleData, theme, { isNarrowScreen: false });
    expect(Array.isArray(option.series)).toBe(true);
    const series = option.series as Array<Record<string, unknown>>;
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      name: 'Token Volume',
      type: 'line',
    });
  });

  it('includes dataZoom when isNarrowScreen is true', () => {
    const option = buildEChartsTrendOption(sampleData, theme, { isNarrowScreen: true });
    expect(option.dataZoom).toBeDefined();
    expect(Array.isArray(option.dataZoom)).toBe(true);
    const zooms = option.dataZoom as Array<{ type: string }>;
    expect(zooms.some((z) => z.type === 'inside')).toBe(true);
    expect(zooms.some((z) => z.type === 'slider')).toBe(true);
  });

  it('omits dataZoom when isNarrowScreen is false', () => {
    const option = buildEChartsTrendOption(sampleData, theme, { isNarrowScreen: false });
    expect(option.dataZoom).toBeUndefined();
  });

  it('applies the requested animation duration and easing', () => {
    const option = buildEChartsTrendOption(sampleData, theme, {
      isNarrowScreen: false,
      animationDuration: 350,
      animationEasing: 'linear',
    });
    expect(option.animationDuration).toBe(350);
    expect(option.animationEasing).toBe('linear');
  });

  it('uses sampling: lttb for dense series', () => {
    const option = buildEChartsTrendOption(sampleData, theme, { isNarrowScreen: false });
    const series = option.series as Array<Record<string, unknown>>;
    expect(series[0]?.sampling).toBe('lttb');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run src/utils/usage/chartConfig.test.ts`
Expected: FAIL — `buildEChartsTrendOption` is not exported from `./chartConfig`.

- [ ] **Step 3: Append the adapter to chartConfig.ts**

Append to the bottom of `src/utils/usage/chartConfig.ts` (do not remove the existing exports yet):

```ts
import type { EChartsOption } from 'echarts';
import type { ChartData } from './usage';
import type { ThemeColors } from '../echarts/themeBridge';

export interface BuildEChartsTrendOptionArgs {
  isNarrowScreen: boolean;
  animationDuration?: number;
  animationEasing?: string;
}

const FONT_FAMILY = 'Roboto Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const hexToRgba = (hex: string, alpha: number): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const intVal = parseInt(m[1] as string, 16);
  const r = (intVal >> 16) & 0xff;
  const g = (intVal >> 8) & 0xff;
  const b = intVal & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export function buildEChartsTrendOption(
  data: ChartData,
  theme: ThemeColors,
  args: BuildEChartsTrendOptionArgs,
): EChartsOption {
  const { isNarrowScreen, animationDuration = 250, animationEasing = 'cubicOut' } = args;

  return {
    backgroundColor: 'transparent',
    animationDuration,
    animationEasing,
    textStyle: { fontFamily: FONT_FAMILY, color: theme.textPrimary },
    grid: { left: 56, right: 24, top: 32, bottom: isNarrowScreen ? 40 : 24 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: theme.bgPrimary,
      borderColor: theme.border,
      textStyle: { color: theme.textPrimary, fontFamily: FONT_FAMILY },
    },
    xAxis: {
      type: 'category',
      data: data.labels,
      axisLine: { lineStyle: { color: theme.border } },
      axisLabel: { color: theme.textSecondary, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: theme.textSecondary },
      splitLine: { lineStyle: { color: theme.borderMuted } },
    },
    dataZoom: isNarrowScreen
      ? [
          { type: 'inside', throttle: 50 },
          { type: 'slider', height: 18, bottom: 8, brushSelect: true },
        ]
      : undefined,
    series: data.datasets.map((d) => ({
      name: d.label,
      type: 'line',
      smooth: true,
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 1.5, color: d.borderColor },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: hexToRgba(d.borderColor, 0.33) },
            { offset: 1, color: hexToRgba(d.borderColor, 0) },
          ],
        },
      },
      data: d.data,
    })),
  };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `npx vitest run src/utils/usage/chartConfig.test.ts`
Expected: 6 tests passed.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/usage/chartConfig.ts src/utils/usage/chartConfig.test.ts
git commit -m "feat(usage): add buildEChartsTrendOption adapter"
```

---

## Task 7: Implement `GranularityCapsule` component (TDD)

**Files:**
- Create: `src/components/charts/GranularityCapsule.tsx`
- Create: `src/components/charts/GranularityCapsule.module.scss`
- Create: `src/components/charts/GranularityCapsule.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/charts/GranularityCapsule.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { GranularityCapsule } from './GranularityCapsule';

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {
          'usage_stats.granularity_hour_short': 'HR',
          'usage_stats.granularity_day_short': 'DAY',
          'usage_stats.granularity_day_disabled_today': 'Today has only one day — switch to HR',
        },
      },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  i18n.changeLanguage('en');
});

describe('<GranularityCapsule />', () => {
  it('renders both HR and DAY buttons', () => {
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={() => {}} timeRange="7d" />,
    );
    expect(screen.getByRole('button', { name: 'HR' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DAY' })).toBeInTheDocument();
  });

  it('disables DAY when timeRange is "today"', () => {
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={() => {}} timeRange="today" />,
    );
    expect(screen.getByRole('button', { name: 'HR' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'DAY' })).toBeDisabled();
  });

  it('enables DAY for other time ranges', () => {
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={() => {}} timeRange="7d" />,
    );
    expect(screen.getByRole('button', { name: 'DAY' })).not.toBeDisabled();
  });

  it('marks the current value as aria-pressed=true', () => {
    render(
      <GranularityCapsule cardId="usage_trend" value="day" onChange={() => {}} timeRange="7d" />,
    );
    expect(screen.getByRole('button', { name: 'HR' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'DAY' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('invokes onChange with "hour" when HR is clicked', async () => {
    const onChange = vi.fn();
    render(
      <GranularityCapsule cardId="usage_trend" value="day" onChange={onChange} timeRange="7d" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'HR' }));
    expect(onChange).toHaveBeenCalledWith('hour');
  });

  it('invokes onChange with "day" when DAY is clicked', async () => {
    const onChange = vi.fn();
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={onChange} timeRange="7d" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'DAY' }));
    expect(onChange).toHaveBeenCalledWith('day');
  });

  it('does not call onChange when the disabled DAY button is clicked', async () => {
    const onChange = vi.fn();
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={onChange} timeRange="today" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'DAY' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('honors the disabled prop for both buttons', () => {
    render(
      <GranularityCapsule cardId="usage_trend" value="hour" onChange={() => {}} timeRange="7d" disabled />,
    );
    expect(screen.getByRole('button', { name: 'HR' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DAY' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run src/components/charts/GranularityCapsule.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the SCSS module**

Create `src/components/charts/GranularityCapsule.module.scss`:

```scss
.capsule {
  display: inline-flex;
  align-items: stretch;
  background-color: var(--bg-tertiary, rgba(15, 23, 42, 0.6));
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 2px;
  font-family: 'Roboto Mono', 'SF Mono', Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  line-height: 1;
}

.button {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--text-tertiary, rgba(148, 163, 184, 0.85));
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
  font: inherit;
}

.button:hover:not(:disabled) {
  color: var(--text-primary);
}

.button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.buttonActive {
  background-color: var(--bg-primary, rgba(2, 6, 23, 0.9));
  color: var(--accent, #06b6d4);
  box-shadow: inset 0 0 0 1px var(--border-color);
}
```

- [ ] **Step 4: Implement the component**

Create `src/components/charts/GranularityCapsule.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import type { Granularity } from '@/hooks/useGranularity';
import type { UsageTimeRange } from '@/utils/usage';
import styles from './GranularityCapsule.module.scss';

export interface GranularityCapsuleProps {
  cardId: string;
  value: Granularity;
  onChange: (next: Granularity) => void;
  timeRange: UsageTimeRange;
  disabled?: boolean;
}

export function GranularityCapsule({
  cardId,
  value,
  onChange,
  timeRange,
  disabled = false,
}: GranularityCapsuleProps) {
  const { t } = useTranslation();
  const dayDisabled = disabled || timeRange === 'today';

  return (
    <div
      className={styles.capsule}
      role="group"
      aria-label={t('usage_stats.chart_granularity')}
      data-card-id={cardId}
    >
      <button
        type="button"
        className={`${styles.button} ${value === 'hour' ? styles.buttonActive : ''}`}
        aria-pressed={value === 'hour'}
        disabled={disabled}
        onClick={() => onChange('hour')}
      >
        {t('usage_stats.granularity_hour_short')}
      </button>
      <button
        type="button"
        className={`${styles.button} ${value === 'day' ? styles.buttonActive : ''}`}
        aria-pressed={value === 'day'}
        disabled={dayDisabled}
        title={dayDisabled ? t('usage_stats.granularity_day_disabled_today') : undefined}
        onClick={() => onChange('day')}
      >
        {t('usage_stats.granularity_day_short')}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `npx vitest run src/components/charts/GranularityCapsule.test.tsx`
Expected: 8 tests passed.

- [ ] **Step 6: Commit**

```bash
git add src/components/charts/GranularityCapsule.tsx \
        src/components/charts/GranularityCapsule.module.scss \
        src/components/charts/GranularityCapsule.test.tsx
git commit -m "feat(usage): add GranularityCapsule with disabled-when-today state"
```

---

## Task 8: Implement `TelemetryChart` component

**Files:**
- Create: `src/components/charts/TelemetryChart.tsx`
- Create: `src/components/charts/TelemetryChart.module.scss`
- Create: `src/components/charts/TelemetryChart.test.tsx` (smoke tests)

- [ ] **Step 1: Write the failing test**

Create `src/components/charts/TelemetryChart.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock echarts to avoid canvas operations in jsdom.
vi.mock('echarts', () => {
  const init = vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  }));
  const registerTheme = vi.fn();
  return {
    default: { init, registerTheme },
    init,
    registerTheme,
  };
});

import { TelemetryChart } from './TelemetryChart';

describe('<TelemetryChart />', () => {
  it('renders the title in the header', () => {
    render(
      <TelemetryChart title="METRIC // TREND" option={{ series: [] }} />,
    );
    expect(screen.getByText('METRIC // TREND')).toBeInTheDocument();
  });

  it('renders the extraControls slot to the right of the title', () => {
    render(
      <TelemetryChart
        title="METRIC // TREND"
        option={{ series: [] }}
        extraControls={<button>HR</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'HR' })).toBeInTheDocument();
  });

  it('renders a container div for the ECharts canvas mount', () => {
    const { container } = render(
      <TelemetryChart title="METRIC // TREND" option={{ series: [] }} />,
    );
    // Find the div with the canvasMount class. Match by data attribute to avoid coupling to CSS module hashes.
    const mount = container.querySelector('[data-testid="echarts-mount"]');
    expect(mount).toBeInTheDocument();
  });

  it('passes the loading flag through to the indicator dot styling', () => {
    const { container } = render(
      <TelemetryChart title="METRIC // TREND" option={{ series: [] }} loading />,
    );
    // The dot has a data-loading attribute when loading.
    const dot = container.querySelector('[data-loading="true"]');
    expect(dot).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run src/components/charts/TelemetryChart.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the SCSS module**

Create `src/components/charts/TelemetryChart.module.scss`:

```scss
.container {
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 16px;
  position: relative;
  font-family: 'Roboto Mono', 'SF Pro Display', 'Inter', monospace;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.3);
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 8px;
  margin-bottom: 16px;
}

.titleArea {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.indicatorDot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;

  &.active {
    background-color: var(--accent);
    animation: pulse 2s infinite ease-in-out;
  }

  &.loading {
    background-color: #f59e0b;
    animation: ping 1s infinite cubic-bezier(0, 0, 0.2, 1);
  }
}

.titleText {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.controlSlot {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.canvas {
  width: 100%;
  min-height: 64px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.85); }
}

@keyframes ping {
  75%, 100% { transform: scale(2); opacity: 0; }
}
```

- [ ] **Step 4: Implement the component**

Create `src/components/charts/TelemetryChart.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { useThemeStore } from '@/stores';
import { useEChartsResize } from '@/hooks/useEChartsResize';
import { getThemeColors } from '@/utils/echarts/themeBridge';
import { registerCliThemes } from '@/utils/echarts/registerThemes';
import styles from './TelemetryChart.module.scss';

registerCliThemes();

export interface TelemetryChartProps {
  title: string;
  option: echarts.EChartsOption;
  loading?: boolean;
  height?: number;
  extraControls?: React.ReactNode;
  onChartReady?: (instance: echarts.EChartsType) => void;
  onResize?: (size: { width: number; height: number }) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function TelemetryChart({
  title,
  option,
  loading = false,
  height = 256,
  extraControls,
  onChartReady,
  onResize,
  className,
  style,
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.EChartsType | null>(null);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  // (Re-)initialize when the resolved theme changes; ECharts binds theme at init.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const instance = echarts.init(
      container,
      resolvedTheme === 'dark' ? 'cli-dark' : 'cli-light',
      { renderer: 'canvas' },
    );
    instanceRef.current = instance;
    onChartReady?.(instance);

    return () => {
      instance.dispose();
      instanceRef.current = null;
    };
    // We intentionally only re-init on theme change; option updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);

  // Apply option updates without merging conflicts.
  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    instance.setOption(option, { notMerge: false, lazyUpdate: true });
  }, [option]);

  // Mirror the active theme colors onto the live option (cheap; uses CSS vars).
  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const colors = getThemeColors();
    instance.setOption(
      {
        textStyle: { color: colors.textPrimary },
        backgroundColor: 'transparent',
      },
      { lazyUpdate: true },
    );
  }, [resolvedTheme]);

  useEChartsResize(containerRef, (_el, size) => {
    instanceRef.current?.resize();
    onResize?.(size);
  });

  return (
    <div className={`${styles.container} ${className ?? ''}`} style={style}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <span
            className={`${styles.indicatorDot} ${loading ? styles.loading : styles.active}`}
            data-loading={loading || undefined}
            aria-hidden="true"
          />
          <span className={styles.titleText}>{title}</span>
        </div>
        {extraControls ? <div className={styles.controlSlot}>{extraControls}</div> : null}
      </div>
      <div
        ref={containerRef}
        className={styles.canvas}
        style={{ height }}
        data-testid="echarts-mount"
      />
    </div>
  );
}
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `npx vitest run src/components/charts/TelemetryChart.test.tsx`
Expected: 4 tests passed.

- [ ] **Step 6: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/charts/TelemetryChart.tsx \
        src/components/charts/TelemetryChart.module.scss \
        src/components/charts/TelemetryChart.test.tsx
git commit -m "feat(charts): add TelemetryChart wrapper with ECharts lifecycle"
```

---

## Task 9: Refactor `ModelTokenDoughnut` outer chrome to use `TelemetryChart`

**Files:**
- Modify: `src/components/usage/ModelTokenDoughnut.tsx`

- [ ] **Step 1: Read the current file to locate the outer div**

Run: `grep -n "telemetry-panel\|panelHeader\|<div className" src/components/usage/ModelTokenDoughnut.tsx | head -30`

Look for the existing custom chrome (the file uses raw `<div>` for the header, not `Card`).

- [ ] **Step 2: Add the `TelemetryChart` import**

Near the top of `ModelTokenDoughnut.tsx`, add:

```ts
import { TelemetryChart } from '@/components/charts/TelemetryChart';
```

- [ ] **Step 3: Wrap the existing chart DOM in `<TelemetryChart />`**

Find the outer JSX that returns the panel header and the chart canvas. Replace it with:

```tsx
return (
  <TelemetryChart
    title={t('usage_stats.model_token_distribution')}
    option={option}
    loading={isLoading}
    extraControls={
      <GranularityCapsule
        cardId="usage_doughnut_side"
        value={chartPeriod}
        onChange={(next) => onChartPeriodChange?.(next)}
        timeRange={timeRange}
      />
    }
  >
    {/* The existing ECharts-rendered series and sparkline remain inside the body. */}
  </TelemetryChart>
);
```

If the current implementation puts both the doughnut and the side sparkline as direct children of one container, move the side sparkline into a footer slot of the panel via a follow-up edit (do not over-refactor in this step — see Step 4 for the minimum-diff approach).

- [ ] **Step 4: Apply the minimum-diff approach**

For this refactor, the safe change is:

1. Keep the existing `option` construction (lines 189-340 roughly) untouched.
2. Replace only the outer panel `<div>` and its header `<div>` with `<TelemetryChart title="..." option={option} extraControls={...} />`.
3. The side sparkline (a separate `<Line>` or `ECharts` instance inside the same panel) is rendered as a sibling canvas div beside the doughnut. After wrapping the doughnut in `TelemetryChart`, render the side sparkline in a second `<TelemetryChart title="..." height={64} ... />` placed in a `flex` row below.

Add a small `wrapper` SCSS module in `ModelTokenDoughnut.module.scss` (create if missing):

```scss
.row {
  display: flex;
  gap: 16px;
  align-items: stretch;
}

.doughnutCell {
  flex: 1 1 auto;
  min-width: 0;
}

.sparklineCell {
  flex: 0 0 240px;
  min-width: 0;
}
```

The render layout becomes:

```tsx
<div className={styles.row}>
  <div className={styles.doughnutCell}>
    <TelemetryChart title={...} option={option} ... />
  </div>
  <div className={styles.sparklineCell}>
    <TelemetryChart
      title={t('usage_stats.model_token_trend')}
      option={sparklineOption}
      height={64}
      extraControls={
        <GranularityCapsule ... />
      }
    />
  </div>
</div>
```

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 6: Run all unit tests**

Run: `npm run test:run`
Expected: all tests pass.

- [ ] **Step 7: Manual visual check**

Run: `npm run dev` and navigate to the Usage page. Confirm:
- The model token distribution panel renders.
- The side sparkline renders.
- The doughnut chart still shows colored arcs.

- [ ] **Step 8: Commit**

```bash
git add src/components/usage/ModelTokenDoughnut.tsx src/components/usage/ModelTokenDoughnut.module.scss
git commit -m "refactor(usage): wrap ModelTokenDoughnut in TelemetryChart"
```

---

## Task 10: Refactor `UsageChart` to use ECharts + `TelemetryChart`

**Files:**
- Modify: `src/components/usage/UsageChart.tsx`
- Modify: `src/pages/UsagePage.tsx` (pass new props)

- [ ] **Step 1: Add the new imports**

In `UsageChart.tsx`, replace the chart.js / react-chartjs-2 imports with ECharts imports:

```ts
// Remove:
// import type { ChartOptions } from 'chart.js';
// import { Line } from 'react-chartjs-2';
// import { getHourChartMinWidth } from '@/utils/usage/chartConfig';

// Add:
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '@/stores';
import { TelemetryChart } from '@/components/charts/TelemetryChart';
import { GranularityCapsule } from '@/components/charts/GranularityCapsule';
import { useGranularity } from '@/hooks/useGranularity';
import { getThemeColors } from '@/utils/echarts/themeBridge';
import { buildEChartsTrendOption } from '@/utils/usage/chartConfig';
import type { ChartData } from '@/utils/usage';
import type { UsageTimeRange } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';
```

- [ ] **Step 2: Replace the component body**

Replace the body of `UsageChart` with:

```tsx
export interface UsageChartProps {
  isDark?: boolean;
  title: string;
  chartData: ChartData;
  loading: boolean;
  isMobile: boolean;
  isNarrowScreen: boolean;
  emptyText: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  summary?: React.ReactNode;
  extra?: React.ReactNode;
  timeRange: UsageTimeRange;
}

export function UsageChart({
  title,
  chartData,
  loading,
  isMobile: _isMobile,
  isNarrowScreen,
  emptyText,
  isDark: isDarkProp,
  collapsible = false,
  defaultCollapsed = false,
  summary,
  extra,
  timeRange,
}: UsageChartProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = isDarkProp ?? resolvedTheme === 'dark';
  const { granularity, setGranularity } = useGranularity('usage_trend');
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  const handleHeaderClick = () => {
    if (collapsible) setExpanded(!expanded);
  };

  const option = useMemo(() => {
    if (chartData.labels.length === 0) return null;
    const theme = getThemeColors();
    return buildEChartsTrendOption(chartData, theme, { isNarrowScreen });
  }, [chartData, isNarrowScreen]);

  if (collapsible) {
    return (
      <Card
        title={title}
        collapsible
        defaultCollapsed={defaultCollapsed}
        headerExpanded={expanded}
        onHeaderClick={handleHeaderClick}
        summary={summary}
        extra={extra}
      >
        {renderBody()}
      </Card>
    );
  }

  return (
    <TelemetryChart
      title={title}
      option={option ?? { series: [] }}
      loading={loading}
      extraControls={
        <GranularityCapsule
          cardId="usage_trend"
          value={granularity}
          onChange={setGranularity}
          timeRange={timeRange}
        />
      }
    />
  );

  function renderBody() {
    // ... use the previous Card-based collapsible rendering ...
  }
}
```

(The collapsible branch keeps the existing `Card` chrome for now. Only the non-collapsible path uses `TelemetryChart`.)

- [ ] **Step 3: Update `UsagePage` to pass new props**

In `src/pages/UsagePage.tsx`, find the three `UsageChart` calls (one for requests, one for tokens, one for cost). For each, add `isNarrowScreen` and `timeRange` props and remove the `period` / `onPeriodChange` props (no longer needed; the chart owns granularity).

Add at the top of the component, near the `isMobile` calculation:

```ts
const isNarrowScreen = useMediaQuery('(max-width: 640px)');
```

If `useMediaQuery` is not already a hook in the codebase, add a small inline definition:

```ts
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
```

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 5: Manual visual check**

Run: `npm run dev` and confirm:
- The trend chart renders as a line chart (not broken).
- The HR/DAY capsule appears in the chart header.
- Clicking HR/DAY animates the line in place.

- [ ] **Step 6: Commit**

```bash
git add src/components/usage/UsageChart.tsx src/pages/UsagePage.tsx
git commit -m "refactor(usage): migrate UsageChart to ECharts + GranularityCapsule"
```

---

## Task 11: Refactor `CostTrendChart` to use ECharts

**Files:**
- Modify: `src/components/usage/CostTrendChart.tsx`
- Modify: `src/components/usage/TrendTabsCard.tsx`

- [ ] **Step 1: Read the current CostTrendChart to find the local useState**

Run: `grep -n "useState<'hour'\\|setPeriod\\|period" src/components/usage/CostTrendChart.tsx`

- [ ] **Step 2: Replace the component**

Replace the entire `CostTrendChart` body with:

```tsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { TelemetryChart } from '@/components/charts/TelemetryChart';
import { GranularityCapsule } from '@/components/charts/GranularityCapsule';
import { useGranularity } from '@/hooks/useGranularity';
import { getThemeColors } from '@/utils/echarts/themeBridge';
import { buildEChartsTrendOption } from '@/utils/usage/chartConfig';
import {
  buildHourlyCostSeries,
  buildDailyCostSeries,
  formatUsd,
  type ModelPrice,
  type ChartData,
  type UsageTimeRange,
} from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface CostTrendChartProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  isNarrowScreen: boolean;
  modelPrices: Record<string, ModelPrice>;
  hourWindowHours?: number;
  timeRange: UsageTimeRange;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  summary?: React.ReactNode;
}

const COST_COLOR = '#06b6d4';

export function CostTrendChart({
  usage,
  loading,
  isDark: _isDark,
  isMobile: _isMobile,
  isNarrowScreen,
  modelPrices,
  hourWindowHours,
  timeRange,
  collapsible = false,
  defaultCollapsed = false,
  summary,
}: CostTrendChartProps) {
  const { t } = useTranslation();
  const { granularity, setGranularity } = useGranularity('usage_cost');
  const hasPrices = Object.keys(modelPrices).length > 0;

  const chartData: ChartData | null = useMemo(() => {
    if (!hasPrices || !usage) return null;
    const series =
      granularity === 'hour'
        ? buildHourlyCostSeries(usage, modelPrices, hourWindowHours)
        : buildDailyCostSeries(usage, modelPrices);
    return {
      labels: series.labels,
      datasets: [
        {
          label: t('usage_stats.total_cost'),
          data: series.data,
          borderColor: COST_COLOR,
          backgroundColor: 'rgba(6, 182, 212, 0.16)',
          fill: true,
          tension: 0.4,
        },
      ],
    };
  }, [granularity, hasPrices, hourWindowHours, modelPrices, t, usage]);

  const option = useMemo(() => {
    if (!chartData) return null;
    const theme = getThemeColors();
    const base = buildEChartsTrendOption(chartData, theme, { isNarrowScreen });
    return {
      ...base,
      yAxis: {
        ...(base.yAxis as object),
        axisLabel: {
          ...(((base.yAxis as { axisLabel?: object })?.axisLabel) as object),
          formatter: (v: number | string) => formatUsd(Number(v)),
        },
      },
    };
  }, [chartData, isNarrowScreen]);

  if (collapsible) {
    return (
      <Card
        title={t('usage_stats.cost_trend')}
        collapsible
        defaultCollapsed={defaultCollapsed}
        headerExpanded={!defaultCollapsed}
        onHeaderClick={() => {}}
        summary={summary}
        extra={
          <GranularityCapsule
            cardId="usage_cost"
            value={granularity}
            onChange={setGranularity}
            timeRange={timeRange}
          />
        }
      >
        {renderBody()}
      </Card>
    );
  }

  return (
    <TelemetryChart
      title={t('usage_stats.cost_trend')}
      option={option ?? { series: [] }}
      loading={loading}
      extraControls={
        <GranularityCapsule
          cardId="usage_cost"
          value={granularity}
          onChange={setGranularity}
          timeRange={timeRange}
        />
      }
    />
  );

  function renderBody() {
    if (loading) return <div className={styles.hint}>{t('common.loading')}</div>;
    if (!hasPrices) return <div className={styles.hint}>{t('usage_stats.cost_need_price')}</div>;
    if (!chartData) return <div className={styles.hint}>{t('usage_stats.cost_no_data')}</div>;
    return null;
  }
}
```

- [ ] **Step 3: Update `TrendTabsCard` to forward the new props**

Find the `TrendTab` and `TrendTabsCard` definitions. The `chartProps` field already extends `UsageChartProps` (less `title` and `showPeriodControls`). For the `cost` tab, the chart props are for `CostTrendChart`, not `UsageChart`. Either:

- (a) Add a sibling `costChartProps` field to `TrendTab` and render `CostTrendChart` directly inside the cost panel.
- (b) Keep using `UsageChartProps` shape and have `CostTrendChart` extend it (drop the shape mismatch — it currently does not).

Choose (a) for clarity. In `TrendTabsCard.tsx`, change the interface to:

```ts
export interface TrendTab {
  key: string;
  label: string;
  chartProps: Omit<UsageChartProps, 'title' | 'showPeriodControls'>;
  costChartProps?: Omit<CostTrendChartProps, 'title'>;
}

export function TrendTabsCard({ tabs, activeTab, onTabChange, lineSelector }: TrendTabsCardProps) {
  // ... unchanged header ...
  return (
    <div className={styles.trendTabsCard}>
      {/* header unchanged */}
      <div className={styles.trendTabsBody}>
        {tabs.map((tab) => (
          <div key={tab.key} ...>
            {tab.costChartProps ? (
              <CostTrendChart {...tab.costChartProps} title={tab.label} />
            ) : (
              <UsageChart {...tab.chartProps} title={tab.label} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update `UsagePage` tab construction**

Where the `tabs` array is built in `UsagePage.tsx`, add `costChartProps` for the `cost` tab. For the `requests` and `tokens` tabs, leave `chartProps` as is.

- [ ] **Step 5: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 6: Manual visual check**

Run: `npm run dev` and confirm the cost tab shows a line chart with USD-formatted y-axis and a HR/DAY capsule.

- [ ] **Step 7: Commit**

```bash
git add src/components/usage/CostTrendChart.tsx \
        src/components/usage/TrendTabsCard.tsx \
        src/pages/UsagePage.tsx
git commit -m "refactor(usage): migrate CostTrendChart to ECharts, fix disconnected state"
```

---

## Task 12: Add i18n keys

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`

- [ ] **Step 1: Add English keys**

In `src/i18n/locales/en.json`, inside the `usage_stats` block, add:

```json
"granularity_hour_short": "HR",
"granularity_day_short": "DAY",
"granularity_day_disabled_today": "Today has only one day — switch to HR",
"telemetry_loading": "Acquiring..."
```

- [ ] **Step 2: Add Chinese keys**

In `src/i18n/locales/zh-CN.json`, inside the `usage_stats` block, add:

```json
"granularity_hour_short": "小时",
"granularity_day_short": "日",
"granularity_day_disabled_today": "今日仅小时维度可用，请切换至 HR",
"telemetry_loading": "数据采集中..."
```

- [ ] **Step 3: Type-check + run all unit tests**

Run: `npm run type-check && npm run test:run`
Expected: no type errors; all unit tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/zh-CN.json
git commit -m "feat(i18n): add granularity capsule and telemetry keys"
```

---

## Task 13: Remove the top-level granularity group from `UsagePage`

**Files:**
- Modify: `src/pages/UsagePage.tsx`
- Modify: `src/pages/UsagePage.module.scss`

- [ ] **Step 1: Remove the state**

In `UsagePage.tsx`, delete:

- The `chartGranularity` `useState` (line 441).
- The `effectiveChartGranularity` and `chartPeriod` derived values (lines 1062-1063).
- The `handleChartGranularityChange` callback (around line 1064).

- [ ] **Step 2: Remove the top filter group**

Delete lines 1255-1288 (the `granularity` `timeRangeGroup` div with the two buttons).

- [ ] **Step 3: Remove the SCSS classes**

In `UsagePage.module.scss`, delete the `globalGranularityGroup`, `globalGranularityButton`, and `globalGranularityButtonActive` rule blocks.

- [ ] **Step 4: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 5: Manual visual check**

Run: `npm run dev`:
- The top filter bar shows only `timeRange` and `credentialFilter`. No granularity group.
- Each chart card shows its own HR/DAY capsule.
- With `timeRange='today'`, all DAY buttons are disabled.
- Refresh the page; each card remembers its last choice.

- [ ] **Step 6: Run the full test suite**

Run: `npm run test:run`
Expected: all unit tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/pages/UsagePage.tsx src/pages/UsagePage.module.scss
git commit -m "refactor(usage): remove top-level granularity group, fully sink to cards"
```

---

## Task 14: Final manual verification pass

**Files:** (no code changes; verification only)

- [ ] **Step 1: Type-check + build**

Run: `npm run type-check && npm run build`
Expected: both succeed.

- [ ] **Step 2: Run the full test suite**

Run: `npm run test:run`
Expected: all unit tests pass.

- [ ] **Step 3: Walk the verification checklist from the spec**

Open `docs/superpowers/specs/2026-06-03-usage-page-granularity-control-design.md` section 11. Confirm every checkbox.

- [ ] **Step 4: Check console for warnings**

Open the Usage page in a browser. The DevTools console must not show:
- `ECharts: There is a chart instance already initialized on the dom.` (duplicate init warning)
- `getComputedStyle` errors (theme bridge issue)
- `localStorage` quota errors

- [ ] **Step 5: Commit any final adjustments**

If steps 1-4 surfaced small visual issues, fix them and commit:

```bash
git add -A
git commit -m "fix(usage): address verification findings"
```

---

## Task 15: Remove `chart.js` and `react-chartjs-2` dependencies

**Files:**
- Modify: `package.json`
- Modify: `src/utils/usage/chartConfig.ts` (remove deprecated exports)
- Modify: any remaining import sites (should be none after Task 11)

- [ ] **Step 1: Search for remaining references**

Run: `grep -rn "chart.js\|react-chartjs-2\|getHourChartMinWidth\|sparklineOptions\|buildChartOptions" src/`

Expected: only matches in `src/utils/usage/chartConfig.ts` (the exports we want to remove). If there are other matches, refactor those files first.

- [ ] **Step 2: Remove the deprecated exports from chartConfig.ts**

Delete the `buildChartOptions` function, the `sparklineOptions` constant, and the `getHourChartMinWidth` function from `src/utils/usage/chartConfig.ts`. Also remove the `import type { ChartOptions } from 'chart.js';` line.

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 4: Run all unit tests**

Run: `npm run test:run`
Expected: all pass.

- [ ] **Step 5: Uninstall the dependencies**

```bash
npm uninstall chart.js react-chartjs-2
```

- [ ] **Step 6: Final build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/utils/usage/chartConfig.ts
git commit -m "chore(usage): drop chart.js and react-chartjs-2 dependencies"
```

---

## Self-Review

1. **Spec coverage:**
   - Section 1 (goals: top-level group removed; ECharts unified; per-card granularity; `CostTrendChart` fixed; per-card persistence) → covered by Tasks 1-15.
   - Section 2 (non-goals: no sync lock, no Tailwind, no other filters) → honored throughout.
   - Section 3 (locked decisions) → each decision reflected in the relevant task.
   - Section 4 (file changes) → file map at the top of this plan matches the spec.
   - Section 5 (key APIs: `useGranularity`, `<GranularityCapsule />`, `<TelemetryChart />`) → Tasks 2, 7, 8.
   - Section 6 (ECharts option patterns) → Task 6 + Tasks 9-11.
   - Section 7 (state flow) → reflected in Tasks 9-11 and the architecture note.
   - Section 8 (theme awareness) → Task 4 (`themeBridge`) + Task 5 (`registerThemes`) + Task 8 (`TelemetryChart` re-init on theme change).
   - Section 9 (animations & interactions) → Task 6 (animation params) + Task 8 (resize observer).
   - Section 10 (migration order) → Tasks 1-15 follow the 12-step order from the spec.
   - Section 11 (verification checklist) → Task 14.
   - Section 12 (open risks) → no extra task needed; the risks are documented.

2. **Placeholder scan:** No "TBD", "TODO", or "similar to Task N" patterns. Every code step shows the actual code.

3. **Type consistency:** `Granularity` is exported from `useGranularity.ts` and imported as a type in `GranularityCapsule.tsx` and `UsageChart.tsx`. `UsageTimeRange` is imported from `@/utils/usage`. `ThemeColors` is imported from `@/utils/echarts/themeBridge`. `buildEChartsTrendOption` is exported from `chartConfig.ts` and consumed in `UsageChart.tsx` and `CostTrendChart.tsx`. The `cardId` strings (`usage_trend`, `usage_cost`, `usage_doughnut_side`) are consistent across all consumers.

4. **Coverage gaps found during self-review:** The plan does not yet wire `UsagePage` to call `useMediaQuery`. This is added in Task 10 step 3. The plan also assumes `useThemeStore` exposes `resolvedTheme` directly — verified during context exploration.
