/**
 * ECharts configuration utilities for usage statistics
 */

import type { EChartsOption } from 'echarts';
import type { ChartData, ChartDataset } from '../usage';
import type { ThemeColors } from '../echarts/themeBridge';
import { buildAreaGradient } from './chartPalette';

export interface BuildEChartsTrendOptionArgs {
  isNarrowScreen: boolean;
  animationDuration?: number;
  animationEasing?: EChartsOption['animationEasing'];
}

const FONT_FAMILY = 'Roboto Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const compactNumberFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return compactNumberFormatter.format(n);
}

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
    grid: { left: 56, right: 24, top: 72, bottom: isNarrowScreen ? 40 : 24 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: theme.bgPrimary,
      borderColor: theme.border,
      borderRadius: 8,
      padding: [10, 14],
      extraCssText: 'box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.08);',
      textStyle: { color: theme.textPrimary, fontFamily: FONT_FAMILY, fontSize: 12 },
      formatter: ((params: unknown) => {
        const list = Array.isArray(params)
          ? (params as Array<{
              seriesName: string;
              value: number | string;
              color: string;
              axisValueLabel?: string;
            }>)
          : [];
        if (list.length === 0) return '';
        const time = list[0].axisValueLabel ?? '';
        const total = list.reduce((s, p) => s + (Number(p.value) || 0), 0);
        const sorted = [...list].sort(
          (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0),
        );
        const rows = sorted.map((p) => {
          const v = Number(p.value) || 0;
          const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
          return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${p.color};"></span>
            <span style="flex:1;">${escapeHtml(p.seriesName)}</span>
            <span style="font-variant-numeric:tabular-nums;">${formatNum(v)}</span>
            <span style="opacity:.7;min-width:42px;text-align:right;">${pct}%</span>
          </div>`;
        }).join('');
        return `<div style="font-size:12px;">
          <div style="margin-bottom:4px;font-weight:600;">${escapeHtml(time)}</div>
          ${rows}
          <div style="margin-top:4px;border-top:1px solid ${theme.border};padding-top:4px;display:flex;justify-content:space-between;">
            <span>Total</span><span style="font-variant-numeric:tabular-nums;">${formatNum(total)}</span>
          </div>
        </div>`;
      }),
    },
    legend: {
      type: 'plain',            // CHANGED: from 'scroll' to 'plain' for natural wrap
      orient: 'horizontal',
      left: 'center',
      top: 8,
      width: '70%',             // NEW: constrains legend width to force 2-row wrap
      itemWidth: 14,
      itemHeight: 8,
      itemGap: 18,              // CHANGED: from 14 → 18 for better readability when wrapped
      textStyle: { color: theme.textPrimary, fontSize: 12 },
      pageIconColor: theme.textSecondary,        // kept (unused for plain but harmless)
      pageTextStyle: { color: theme.textSecondary },
      data: data.datasets.map((d) => d.label),
      selector: ['all', 'inverse'],
      selectorLabel: {
        color: theme.textSecondary,
        borderColor: theme.border,
      },
      selectorPosition: 'start',  // CHANGED: from 'end' to 'start'
    },
    xAxis: {
      type: 'category',
      data: data.labels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: theme.textSecondary,
        fontSize: 11,
        hideOverlap: true,
        // Auto-thin tick density for long series (e.g. >60 points) to avoid the
        // dense "comb" look when the dashboard defaults to 30d/All ranges.
        interval: data.labels.length > 60
          ? Math.ceil(data.labels.length / 12)
          : data.labels.length > 24
            ? Math.ceil(data.labels.length / 12)
            : 'auto',
      },
    },
    yAxis: (() => {
      const hasVolumeAxis = data.datasets.some((d) => d.yAxisID === 'yVolume');
      const baseYAxis: EChartsOption['yAxis'] = {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.textSecondary, fontSize: 11 },
        splitLine: {
          lineStyle: { type: 'dashed', color: theme.borderMuted },
        },
      };
      if (!hasVolumeAxis) return baseYAxis;
      return [
        baseYAxis,
        {
          type: 'value',
          position: 'right',
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: theme.textSecondary, fontSize: 11 },
          splitLine: { show: false },
          name: 'Requests',
          nameTextStyle: { color: theme.textSecondary, fontSize: 10, padding: [0, 0, 0, -28] },
        },
      ];
    })(),
    dataZoom: isNarrowScreen
      ? [
          { type: 'inside', throttle: 50 },
          { type: 'slider', height: 18, bottom: 8, brushSelect: true },
        ]
      : undefined,
    series: (() => {
      const baseSeries: EChartsOption['series'] = data.datasets.map((d: ChartDataset) => ({
        name: d.label,
        type: 'line',
        stack: 'total',
        smooth: true,
        showSymbol: false,
        sampling: 'lttb',
        lineStyle: { width: 2, color: d.borderColor },
        itemStyle: { color: d.borderColor },
        areaStyle: {
          color: buildAreaGradient(d.borderColor as string, 0.22, 0),
        },
        data: d.data,
        emphasis: { focus: 'series', lineStyle: { width: 3 } },
        blur: {
          lineStyle: { opacity: 0.15 },
          itemStyle: { opacity: 0.15 },
        },
      }));
      // MA7 overlay: aggregate totals across all datasets, then apply a 7-point
      // trailing moving average. Helps smooth periodic weekend dips so the trend
      // eye reads the underlying signal rather than day-of-week noise. Only when
      // there are enough points to make the average meaningful.
      if (data.labels.length >= 7) {
        const totals = new Array(data.labels.length).fill(0);
        data.datasets.forEach((d) => {
          d.data.forEach((value, index) => {
            totals[index] += Number(value) || 0;
          });
        });
        const maSeries = new Array(totals.length).fill(null as number | null);
        for (let index = 6; index < totals.length; index += 1) {
          let sum = 0;
          for (let offset = 0; offset < 7; offset += 1) {
            sum += totals[index - offset];
          }
          maSeries[index] = sum / 7;
        }
        baseSeries.push({
          name: 'MA7',
          type: 'line',
          smooth: true,
          showSymbol: false,
          sampling: 'lttb',
          lineStyle: { width: 1.5, type: 'dashed', color: theme.textPrimary },
          itemStyle: { color: theme.textPrimary },
          data: maSeries,
          z: 10,
          emphasis: { focus: 'series', lineStyle: { width: 2.5 } },
        });
      }
      return baseSeries;
    })(),
  };
}
