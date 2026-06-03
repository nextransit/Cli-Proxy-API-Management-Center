/**
 * Chart.js configuration utilities for usage statistics
 * Extracted from UsagePage.tsx for reusability
 */

import type { ChartOptions } from 'chart.js';

/**
 * Static sparkline chart options (no dependencies on theme/mobile)
 */
export const sparklineOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: { x: { display: false }, y: { display: false } },
  elements: { line: { tension: 0.45 }, point: { radius: 0 } }
};

export interface ChartConfigOptions {
  period: 'hour' | 'day';
  labels: string[];
  isDark: boolean;
  isMobile: boolean;
}

/**
 * Build chart options with theme and responsive awareness.
 *
 * Key optimizations:
 * - Smooth curves with hidden steady-state points for telemetry-style trend lines
 * - Axis-triggered tooltip (mode: 'index', intersect: false) so hovering
 *   shows all datasets at the same timestamp
 * - Subtle oscilloscope-style grid lines for improved readability
 * - Formatted tooltip labels with K/M suffixes
 * - spanGaps enabled so missing data points don't break the curve
 */
export function buildChartOptions({
  period,
  labels,
  isDark,
  isMobile
}: ChartConfigOptions): ChartOptions<'line'> {
  const tickFontSize = isMobile ? 10 : 12;
  const maxTickLabelCount = isMobile ? (period === 'hour' ? 6 : 5) : period === 'hour' ? 10 : 8;
  const axisBorderColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(17, 24, 39, 0.12)';
  const tickColor = isDark ? 'rgba(226, 232, 240, 0.58)' : 'rgba(17, 24, 39, 0.66)';
  const tooltipBg = isDark ? 'rgba(3, 7, 18, 0.88)' : 'rgba(255, 255, 255, 0.96)';
  const tooltipTitle = isDark ? '#e0faff' : '#0f172a';
  const tooltipBody = isDark ? 'rgba(226, 232, 240, 0.9)' : '#334155';
  const tooltipBorder = isDark ? 'rgba(0, 229, 255, 0.42)' : 'rgba(6, 182, 212, 0.26)';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.035)' : 'rgba(17, 24, 39, 0.055)';
  const tickFont = {
    size: tickFontSize,
    family: 'JetBrains Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  };

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      // Axis-triggered: show tooltip for all datasets at the same x-index
      mode: 'index',
      intersect: false
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: tooltipBg,
        titleColor: tooltipTitle,
        bodyColor: tooltipBody,
        borderColor: tooltipBorder,
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
        displayColors: true,
        usePointStyle: true,
        titleFont: { ...tickFont, weight: 700 },
        bodyFont: tickFont,
        footerFont: tickFont,
        boxPadding: 4,
        caretSize: 5,
        // Ensure tooltip shows all datasets at the same index
        mode: 'index',
        intersect: false,
        callbacks: {
          title: (items) => {
            const label = items[0]?.label || '';
            return label ? `[TIMESTAMP] ${label}` : '[TIMESTAMP]';
          },
          label: (ctx) => {
            const label = ctx.dataset.label || '';
            const value = Number(ctx.raw);
            if (!Number.isFinite(value)) return label;
            const formatted = value >= 1e9
              ? (value / 1e9).toFixed(2) + 'B'
              : value >= 1e6
                ? (value / 1e6).toFixed(2) + 'M'
                : value >= 1e3
                  ? (value / 1e3).toFixed(2) + 'K'
                  : value.toLocaleString();
            return `${label.padEnd(18, ' ')} : ${formatted}`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          display: true,
          drawTicks: false,
          color: gridColor,
          lineWidth: 1
        },
        border: {
          color: axisBorderColor
        },
        ticks: {
          color: tickColor,
          font: tickFont,
          maxRotation: 0,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: maxTickLabelCount,
          callback: (value) => {
            const index = typeof value === 'number' ? value : Number(value);
            const raw =
              Number.isFinite(index) && labels[index] ? labels[index] : typeof value === 'string' ? value : '';

            if (period === 'hour') {
              const [md, time] = raw.split(' ');
              if (!time) return raw;
              if (time.startsWith('00:')) {
                return md ? [md, time] : time;
              }
              return time;
            }

            if (isMobile) {
              const parts = raw.split('-');
              if (parts.length === 3) {
                return `${parts[1]}-${parts[2]}`;
              }
            }
            return raw;
          }
        }
      },
      y: {
        beginAtZero: true,
        grid: {
          display: true,
          color: gridColor,
          lineWidth: 1
        },
        border: { display: false },
        ticks: {
          display: false,
          color: tickColor,
          font: tickFont
        }
      }
    },
    elements: {
      line: {
        tension: 0.42,
        borderWidth: isMobile ? 1.5 : 2,
        // Prevent gaps when data points are missing
        spanGaps: true
      },
      point: {
        borderWidth: 0,
        radius: 0,
        hitRadius: 10,
        hoverRadius: isMobile ? 4 : 5
      }
    }
  };
}

/**
 * Calculate minimum chart width for hourly data on mobile devices
 */
export function getHourChartMinWidth(labelCount: number, isMobile: boolean): string | undefined {
  if (!isMobile || labelCount <= 0) return undefined;
  const perPoint = 56;
  const minWidth = Math.min(labelCount * perPoint, 3000);
  return `${minWidth}px`;
}

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
