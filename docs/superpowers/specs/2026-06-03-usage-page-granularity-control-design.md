# Usage Page Granularity Control Refactor — Design

> Status: design approved in chat, pending written review
> Date: 2026-06-03
> Target repo: `/Users/zhouyong/gitlab/ai/CLIProxyAPI/Cli-Proxy-API-Management-Center`

## 1. Goals

The granularity switch (按小时 / 按天) on the Usage page currently lives in the
top filter bar, while the trend chart and the model token distribution chart —
the two primary data consumers — sit far below. Users must scroll back up to
toggle granularity, breaking the "fast console" flow.

This refactor:

1. **Deletes** the top-level granularity button group entirely.
2. **Sinks** the granularity control into each chart card as a local
   monospace `HR / DAY` capsule.
3. **Unifies** the chart stack on ECharts (replacing `react-chartjs-2`) and
   introduces a single `<TelemetryChart />` wrapper component that owns the
   ECharts instance lifecycle.
4. **Fixes** the silent bug in `CostTrendChart.tsx` where an internal
   `useState<'hour' | 'day'>` ignored the global granularity state.
5. **Persists** each card's granularity preference to its own `localStorage`
   key, so user choices survive reloads without coupling the cards.

## 2. Non-Goals

- No "sync lock" (🔗 SYNC) — each card is intentionally independent.
- No Tailwind — project uses SCSS Modules + `THEME_GUIDE.md` CSS variables.
- No changes to `timeRange` (today / 7d / 30d / all), `credentialFilter`,
  `chartLines`, or `chartCompareMode` filters.
- No changes to the existing ECharts option in `ModelTokenDoughnut.tsx:215`
  — only the outer chrome is replaced with `<TelemetryChart />`.
- No new unit tests for ECharts (jsdom cannot render canvas reliably).

## 3. Locked Decisions

| # | Decision |
|---|----------|
| 1 | Chart library: **ECharts** (replace `react-chartjs-2`). |
| 2 | Migration: **one-shot** in a single PR. |
| 3 | Top-level granularity buttons: **deleted**; granularity is local to each card. |
| 4 | Sync lock: **none**. |
| 5 | Persistence: **per-card** `localStorage` key. |
| 6 | `timeRange='today'` → DAY button **disabled** inside the card. |
| 7 | 168-point interaction: **hybrid** — narrow screen uses `dataZoom`; wide screen auto-fits. |
| 8 | Abstraction: **`<TelemetryChart />` component** with title / indicator dot / control slot. |
| 9 | Styling: **SCSS Modules** + existing CSS variables (`--bg-primary`, `--text-primary`, `--border-color`, `--accent`). |

## 4. File Changes

### 4.1 New files

| Path | Purpose |
|------|---------|
| `src/components/charts/TelemetryChart.tsx` | ECharts wrapper. Owns init / resize / dispose. Exposes `extraControls` slot, `onChartReady`, `onResize`. |
| `src/components/charts/TelemetryChart.module.scss` | Dark monospace panel chrome. |
| `src/components/charts/GranularityCapsule.tsx` | HR/DAY capsule button. Self-disabled when `timeRange === 'today'`. |
| `src/components/charts/GranularityCapsule.module.scss` | Capsule styling. |
| `src/hooks/useGranularity.ts` | Per-card granularity hook with `localStorage` persistence. |
| `src/hooks/useEChartsResize.ts` | `ResizeObserver`-based resize subscription (replaces window-level listener). |
| `src/utils/echarts/registerThemes.ts` | Registers `cli-dark` and `cli-light` themes from CSS variables. |
| `src/utils/echarts/themeBridge.ts` | `getThemeColors()` reads current CSS variables at runtime. |

### 4.2 Modified files

| Path | Change |
|------|--------|
| `src/components/usage/UsageChart.tsx` | Replace `Line` from `react-chartjs-2` with `<TelemetryChart />` + raw ECharts init. Replace built-in `periodButtons` with `<GranularityCapsule cardId="usage_trend" />`. |
| `src/components/usage/CostTrendChart.tsx` | Remove internal `useState<'hour' \| 'day'>`. Accept `period` / `onPeriodChange` / `timeRange` / `hourWindowHours` as props. Use `<TelemetryChart />` + `<GranularityCapsule cardId="usage_cost" />`. |
| `src/components/usage/TrendTabsCard.tsx` | Pass `period` / `onPeriodChange` / `timeRange` to each tab's chart. |
| `src/components/usage/ModelTokenDoughnut.tsx` | Replace outer `<div>` chrome with `<TelemetryChart />`. Keep existing `option: echarts.EChartsOption` construction intact. Add `useGranularity('usage_doughnut_side', 'hour')` for the side sparkline. |
| `src/pages/UsagePage.tsx` | Delete lines 1255-1288 (top granularity group). Delete `chartGranularity` state, `effectiveChartGranularity`, `chartPeriod`, `handleChartGranularityChange` (now replaced by per-card state). Keep `hourWindowHours` calculation; pass it down. |
| `src/utils/usage/chartConfig.ts` | Add `buildEChartsTrendOption(data, theme, opts)` adapter that converts existing `ChartData` shape to `echarts.EChartsOption`. Mark old `buildChartOptions` as deprecated (will be removed after migration). |
| `src/i18n/locales/en.json` | Add `usage_stats.granularity_hour_short` (`HR`), `usage_stats.granularity_day_short` (`DAY`), `usage_stats.telemetry_loading` (`Acquiring...`), `usage_stats.granularity_day_disabled_today` (`Today has only one day — switch to HR`). |
| `src/i18n/locales/zh-CN.json` | Add matching Chinese keys: `小时`、`日`、`数据采集中`、`今日仅小时维度可用，请切换至 HR`。 |
| `package.json` | Add `echarts` (likely already present via `ModelTokenDoughnut`). After all imports migrated, remove `chart.js` and `react-chartjs-2`. |

### 4.3 Removed

- `UsagePage.module.scss` classes: `globalGranularityGroup`, `globalGranularityButton`, `globalGranularityButtonActive`.
- `UsageChart.tsx` local `periodButtons` block (replaced by `<GranularityCapsule />`).
- `CostTrendChart.tsx` local `useState<'hour' | 'day'>` block.
- `UsagePage.tsx` top-level granularity state and handler.
- `chartConfig.ts` deprecated `buildChartOptions` (after migration is complete and tests pass).

## 5. Key APIs

### 5.1 `useGranularity(cardId, defaultValue?)`

```ts
// src/hooks/useGranularity.ts
export type Granularity = 'hour' | 'day';
export interface UseGranularityResult {
  granularity: Granularity;
  setGranularity: (next: Granularity) => void;
  reset: () => void; // clears the localStorage key
}
export function useGranularity(
  cardId: string,
  defaultValue: Granularity = 'hour',
): UseGranularityResult;
```

- Storage key: `usage.granularity.${cardId}`.
- Validates the stored value on read; falls back to `defaultValue` on parse error.
- No `useEffect` for sync — `useState` initializer reads localStorage lazily.

### 5.2 `<GranularityCapsule />`

```ts
// src/components/charts/GranularityCapsule.tsx
interface GranularityCapsuleProps {
  cardId: string;                  // localStorage key + React key
  timeRange: UsageTimeRange;       // 'today' disables DAY
  disabled?: boolean;              // external override (e.g. loading)
  onChange?: (next: Granularity) => void; // optional analytics hook
}
```

Renders two monospace buttons inside a `slate-900` background with a thin
`border-color` outline. The active button uses `--accent` (cyan) foreground.
Disabled buttons have reduced opacity and `cursor: not-allowed`.

### 5.3 `<TelemetryChart />`

```ts
// src/components/charts/TelemetryChart.tsx
interface TelemetryChartProps {
  title: string;                                       // e.g. "METRIC // INTENSITY_TREND"
  option: echarts.EChartsOption;
  loading?: boolean;
  height?: number;                                     // default 256
  extraControls?: React.ReactNode;                     // right of title
  onChartReady?: (instance: echarts.EChartsType) => void;
  onResize?: (instance: echarts.EChartsType, size: { w: number; h: number }) => void;
  className?: string;
  style?: React.CSSProperties;
}
```

Internal contract:
- `useEffect([resolvedTheme])` calls `chart.dispose()` + `echarts.init(el, themeName, { renderer: 'canvas' })` on theme change.
- `useEffect([option])` calls `chart.setOption(option, { notMerge: false, lazyUpdate: true })`.
- `useEChartsResize(chartRef, instanceRef, onResize)` for container resize.
- `useEffect(cleanup)` disposes on unmount.

## 6. ECharts Option Patterns

### 6.1 Trend line (used in `UsageChart`)

```ts
{
  animationDuration: 250,
  animationEasing: 'cubicOut',
  backgroundColor: 'transparent',
  textStyle: { fontFamily: 'Roboto Mono, monospace', color: theme.textPrimary },
  grid: { left: 56, right: 24, top: 32, bottom: 40 },
  xAxis: {
    type: 'category',
    data: labels,
    axisLine: { lineStyle: { color: theme.border } },
    axisLabel: { color: theme.textSecondary, hideOverlap: true },
  },
  yAxis: {
    type: 'value',
    splitLine: { lineStyle: { color: theme.borderMuted } },
    axisLabel: { color: theme.textSecondary },
  },
  tooltip: {
    trigger: 'axis',
    backgroundColor: theme.bgPrimary,
    borderColor: theme.border,
    textStyle: { color: theme.textPrimary, fontFamily: 'Roboto Mono, monospace' },
  },
  dataZoom: isNarrowScreen ? [
    { type: 'inside', throttle: 50 },
    { type: 'slider', height: 18, bottom: 8, brushSelect: true },
  ] : undefined,
  series: datasets.map((d) => ({
    name: d.label,
    type: 'line',
    smooth: true,
    showSymbol: false,
    sampling: 'lttb',           // downsamples >5k points
    lineStyle: { width: 1.5, color: d.color },
    areaStyle: {
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: d.color + '55' },
        { offset: 1, color: d.color + '00' },
      ]),
    },
  })),
}
```

`isNarrowScreen` is measured via `useMediaQuery('(max-width: 640px)')` or
`window.matchMedia` subscription. Threshold: **640px**.

### 6.2 Cost line (used in `CostTrendChart`)

Same as 6.1 with two differences:
- `yAxis.axisLabel.formatter = (v) => formatUsd(Number(v))`.
- Single series, no per-credential comparison.

### 6.3 Doughnut main + side sparkline (`ModelTokenDoughnut`)

- Main: keep the existing option from `ModelTokenDoughnut.tsx:215` verbatim.
- Side sparkline: minimal ECharts line, `height: 64`, `legend.show = false`,
  `tooltip.show = false`, `grid: { left: 0, right: 0, top: 4, bottom: 4 }`,
  `xAxis.show = false`, `yAxis.show = false`, `series: { smooth: true,
  showSymbol: false, lineStyle: { width: 1, color: theme.accent } }`.

## 7. State Flow

```
UsagePage
  ├── timeRange ────────────► passed to each card
  ├── hourWindowHours ──────► computed from timeRange, passed to each card
  ├── scopedUsage ──────────► passed to UsageChart / CostTrendChart
  ├── scopedDetails ────────► passed to ModelTokenDoughnut
  └── (NO chartGranularity state anymore)

UsageChart
  └── useGranularity('usage_trend', 'hour')
       └── localStorage['usage.granularity.usage_trend'] ?? 'hour'

CostTrendChart  (was: internal useState; now: external prop)
  └── useGranularity('usage_cost', 'hour')   // owned by TrendTabsCard
       └── localStorage['usage.granularity.usage_cost'] ?? 'hour'

ModelTokenDoughnut
  └── useGranularity('usage_doughnut_side', 'hour')
       └── localStorage['usage.granularity.usage_doughnut_side'] ?? 'hour'
```

## 8. Theme Awareness

- `registerThemes.ts` registers two ECharts themes:
  - `cli-dark`: read from `[data-theme='dark']` CSS variables.
  - `cli-light`: read from `:root` (and `[data-theme='white']`) CSS variables.
- Themes are registered **once** at module load (idempotent guard).
- `TelemetryChart` calls `echarts.init(el, themeName)` and **disposes +
  re-inits** on `resolvedTheme` change. This is the simplest reliable way
  to switch ECharts themes.
- `themeBridge.getThemeColors()` returns a snapshot of `--text-primary`,
  `--text-secondary`, `--border-color`, `--border-muted`, `--bg-primary`,
  `--accent` from `getComputedStyle(document.documentElement)`. Used for
  tooltip / axisLabel colors that need to follow the live theme.

## 9. Animations & Interactions

| Interaction | Behavior |
|-------------|----------|
| Click `HR` / `DAY` in any capsule | `useGranularity.setGranularity(next)`. The card re-runs its `useMemo` to produce a new `EChartsOption`. `<TelemetryChart />`'s `useEffect([option])` calls `setOption({ notMerge: false, lazyUpdate: true })`. Default ECharts animation: 250ms `cubicOut`. |
| Hover side sparkline | Shows the in-chart `axisPointer` (if implemented) — **out of scope for this refactor**, add later. |
| Resize window on narrow screen | `useEChartsResize` fires; if `width < 640` and current `dataZoom` is undefined, add a `dataZoom` via `setOption({ dataZoom: [...] })`. |
| Theme switch (dark ↔ light) | `TelemetryChart` disposes the current instance and re-inits with the new theme. Brief 50ms flash is acceptable; the indicator dot pulses to signal "re-acquiring". |

## 10. Migration Order (within the one-shot PR)

1. Install `echarts` if not present; verify with `npm ls echarts`.
2. Add new files: `TelemetryChart`, `GranularityCapsule`, `useGranularity`,
   `useEChartsResize`, `registerThemes`, `themeBridge`, plus their SCSS
   modules.
3. Add `buildEChartsTrendOption` adapter in `chartConfig.ts`. Keep the
   old `buildChartOptions` exported for the rest of the codebase until
   step 7 is done.
4. Refactor `UsageChart.tsx` to use `<TelemetryChart />` + ECharts init.
   Verify with `npm run type-check` and dev-server smoke test.
5. Refactor `CostTrendChart.tsx`: delete internal `useState`; accept
   `period` / `onPeriodChange` / `timeRange` / `hourWindowHours` props;
   use `<TelemetryChart />` + `<GranularityCapsule />`.
6. Refactor `TrendTabsCard.tsx` to thread props through to each tab.
7. Refactor `ModelTokenDoughnut.tsx` outer chrome to `<TelemetryChart />`.
8. Edit `UsagePage.tsx`: remove the top granularity group (lines
   1255-1288), `chartGranularity` state, `handleChartGranularityChange`,
   and `chartPeriod` derived state. Pass `timeRange` and `hourWindowHours`
   down to all three cards.
9. Remove `globalGranularityGroup` / `globalGranularityButton` /
   `globalGranularityButtonActive` from `UsagePage.module.scss`.
10. Add i18n keys to `en.json` and `zh-CN.json`.
11. `npm run type-check` → `npm run build` → manual visual check.
12. After build is green, run `npm uninstall chart.js react-chartjs-2` to
    remove the legacy dependency.

## 11. Verification

- `npm run type-check` — must pass.
- `npm run build` — must pass.
- `npm run dev` — manual visual check:
  - [ ] Top filter bar shows only `timeRange`, `credentialFilter`, and
        refresh. No granularity group.
  - [ ] Three chart cards (trend / cost / model distribution) each show a
        `HR / DAY` capsule in their header. Active state uses cyan accent.
  - [ ] Clicking `HR` or `DAY` on the trend chart animates the line in
        place (≤300ms). No full-page re-render (DevTools profiler).
  - [ ] `timeRange='today'` disables all three `DAY` buttons. Hovering
        shows the `granularity_day_disabled_today` tooltip.
  - [ ] With `timeRange='7d'` and viewport ≤640px, the trend chart shows
        an ECharts dataZoom slider. Drag to inspect a subset of hours.
  - [ ] Refresh the page: each card restores its last-selected granularity
        from `localStorage`.
  - [ ] Theme switch (`dark` ↔ `light`) regenerates the chart with the
        new theme colors. No `chart.dispose()` warning in console.
  - [ ] All three cards' granularity preferences are **independent**:
        setting trend to `DAY` does not affect the doughnut side sparkline.

## 12. Open Risks

- **Theme re-init flicker**: 50ms flash on theme switch is acceptable but
  visible. If user feedback calls it out, swap to live `setOption` color
  updates instead of dispose+init.
- **ECharts bundle size**: ~900KB minified. Current `ModelTokenDoughnut`
  already imports it, so this is no new cost. Tree-shake on build should
  keep the chart-only modules.
- **`getHourChartMinWidth` removal**: the old horizontal scroll is
  superseded by `dataZoom` on narrow screens. On wide screens the chart
  auto-fits. This utility is no longer needed and will be removed.
