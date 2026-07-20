/**
 * ECharts configuration utilities for usage statistics
 */

import type { EChartsOption } from 'echarts';
import type { ChartData, ChartDataset } from '../usage';
import type { ThemeColors } from '../echarts/themeBridge';

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
      type: 'scroll',
      orient: 'horizontal',
      top: 8,
      left: 'center',
      itemWidth: 14,
      itemHeight: 8,
      itemGap: 14,
      textStyle: { color: theme.textPrimary, fontSize: 12 },
      pageIconColor: theme.textSecondary,
      pageTextStyle: { color: theme.textSecondary },
      data: data.datasets.map((d) => d.label),
      selector: ['all', 'inverse'],
      selectorLabel: {
        color: theme.textSecondary,
        borderColor: theme.border,
      },
      selectorPosition: 'end',
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
    series: data.datasets.map((d: ChartDataset, i: number) => ({
      name: d.label,
      type: 'line',
      smooth: true,
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: i === 0 ? 2 : 1.5, color: d.borderColor },
      emphasis: { focus: 'series', lineStyle: { width: 3 } },
      blur: {
        lineStyle: { opacity: 0.15 },
        itemStyle: { opacity: 0.15 },
      },
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
