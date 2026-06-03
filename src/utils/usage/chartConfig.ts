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
    series: data.datasets.map((d: ChartDataset) => ({
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
