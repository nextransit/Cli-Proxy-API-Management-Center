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
 * - Smooth curves (tension: 0.35) for organic-looking trend lines
 * - Axis-triggered tooltip (mode: 'index', intersect: false) so hovering
 *   shows all datasets at the same timestamp
 * - Subtle grid lines for improved readability
 * - Formatted tooltip labels with K/M suffixes
 * - spanGaps enabled so missing data points don't break the curve
 */
export function buildChartOptions({
  period,
  labels,
  isDark,
  isMobile
}: ChartConfigOptions): ChartOptions<'line'> {
  const pointRadius = isMobile && period === 'hour' ? 0 : isMobile ? 2 : 4;
  const tickFontSize = isMobile ? 10 : 12;
  const maxTickLabelCount = isMobile ? (period === 'hour' ? 8 : 6) : period === 'hour' ? 12 : 10;
  const axisBorderColor = isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(17, 24, 39, 0.14)';
  const tickColor = isDark ? 'rgba(255, 255, 255, 0.72)' : 'rgba(17, 24, 39, 0.72)';
  const tooltipBg = isDark ? 'rgba(18, 18, 18, 0.94)' : 'rgba(255, 255, 255, 0.98)';
  const tooltipTitle = isDark ? '#ffffff' : '#111827';
  const tooltipBody = isDark ? 'rgba(238, 229, 255, 0.9)' : '#374151';
  const tooltipBorder = isDark ? 'rgba(6, 182, 212, 0.34)' : 'rgba(17, 24, 39, 0.10)';
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(17, 24, 39, 0.06)';

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
        padding: 12,
        displayColors: true,
        usePointStyle: true,
        boxPadding: 4,
        // Ensure tooltip shows all datasets at the same index
        mode: 'index',
        intersect: false,
        callbacks: {
          label: (ctx) => {
            const label = ctx.dataset.label || '';
            const value = Number(ctx.raw);
            if (!Number.isFinite(value)) return label;
            const formatted = value >= 1e6
              ? (value / 1e6).toFixed(2) + 'M'
              : value >= 1e3
                ? (value / 1e3).toFixed(2) + 'K'
                : value.toLocaleString();
            return `  ${label}: ${formatted}`;
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
          font: { size: tickFontSize },
          maxRotation: isMobile ? 0 : 45,
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
          font: { size: tickFontSize }
        }
      }
    },
    elements: {
      line: {
        // Smoother curves: lower tension = more rounded interpolation
        tension: 0.35,
        borderWidth: isMobile ? 1.5 : 2,
        // Prevent gaps when data points are missing
        spanGaps: true
      },
      point: {
        borderWidth: 2,
        radius: pointRadius,
        hoverRadius: 5
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
