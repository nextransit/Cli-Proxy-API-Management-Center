import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ChartData as ChartJsData,
  ChartOptions,
  ScriptableContext,
  TooltipItem,
} from 'chart.js';
import {
  buildChartData,
  buildDailyCostSeries,
  buildDailyTokenBreakdown,
  buildHourlyCostSeries,
  buildHourlyTokenBreakdown,
  formatUsd,
  type ModelPrice,
  type TokenCategory,
} from '@/utils/usage';
import { buildChartOptions } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './useUsageData';

const TOKEN_COLORS: Record<TokenCategory, string> = {
  input: '#06b6d4',
  output: '#22d3ee',
  cached: '#0891b2',
  reasoning: '#67e8f9',
};

const TOKEN_CATEGORIES: TokenCategory[] = ['input', 'output', 'cached', 'reasoning'];
const COST_COLOR = '#06b6d4';
const COST_BG = 'rgba(6, 182, 212, 0.16)';

function buildCostGradient(ctx: ScriptableContext<'line'>) {
  const chart = ctx.chart;
  const area = chart.chartArea;
  if (!area) return COST_BG;
  const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, 'rgba(6, 182, 212, 0.32)');
  gradient.addColorStop(0.6, 'rgba(6, 182, 212, 0.12)');
  gradient.addColorStop(1, 'rgba(6, 182, 212, 0.02)');
  return gradient;
}

export interface UseChartDataOptions {
  usage: UsagePayload | null;
  chartLines: string[];
  isDark: boolean;
  isMobile: boolean;
  modelPrices: Record<string, ModelPrice>;
  hourWindowHours?: number;
}

export interface UseChartDataReturn {
  requestsPeriod: 'hour' | 'day';
  setRequestsPeriod: (period: 'hour' | 'day') => void;
  tokensPeriod: 'hour' | 'day';
  setTokensPeriod: (period: 'hour' | 'day') => void;
  costBreakdownPeriod: 'hour' | 'day';
  setCostBreakdownPeriod: (period: 'hour' | 'day') => void;
  requestsChartData: ChartJsData<'line'>;
  tokensChartData: ChartJsData<'bar'>;
  costBreakdownChartData: ChartJsData<'line'>;
  requestsChartOptions: ChartOptions<'line'>;
  tokensChartOptions: ChartOptions<'bar'>;
  costBreakdownChartOptions: ChartOptions<'line'>;
}

export function useChartData({
  usage,
  chartLines,
  isDark,
  isMobile,
  modelPrices,
  hourWindowHours
}: UseChartDataOptions): UseChartDataReturn {
  const { t } = useTranslation();
  const [requestsPeriod, setRequestsPeriod] = useState<'hour' | 'day'>('day');
  const [tokensPeriod, setTokensPeriod] = useState<'hour' | 'day'>('hour');
  const [costBreakdownPeriod, setCostBreakdownPeriod] = useState<'hour' | 'day'>('hour');
  const hasPrices = Object.keys(modelPrices).length > 0;

  const requestsChartData = useMemo(() => {
    if (!usage) return { labels: [], datasets: [] };
    return buildChartData(usage, requestsPeriod, 'requests', chartLines, {
      hourWindowHours,
    }) as unknown as ChartJsData<'line'>;
  }, [usage, requestsPeriod, chartLines, hourWindowHours]);

  const tokensChartData = useMemo(() => {
    if (!usage) return { labels: [], datasets: [] };
    const series =
      tokensPeriod === 'hour'
        ? buildHourlyTokenBreakdown(usage, hourWindowHours)
        : buildDailyTokenBreakdown(usage);

    return {
      labels: series.labels,
      datasets: TOKEN_CATEGORIES.map((category) => ({
        label: t(`usage_stats.${category}_tokens`),
        data: series.dataByCategory[category],
        backgroundColor: TOKEN_COLORS[category],
        borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#ffffff',
        borderWidth: 1,
        borderSkipped: false,
        grouped: true,
        categoryPercentage: 0.82,
        barPercentage: 0.88,
      })),
    } as ChartJsData<'bar'>;
  }, [usage, tokensPeriod, hourWindowHours, isDark, t]);

  const costBreakdownChartData = useMemo(() => {
    if (!usage || !hasPrices) {
      return { labels: [], datasets: [] };
    }

    const series =
      costBreakdownPeriod === 'hour'
        ? buildHourlyCostSeries(usage, modelPrices, hourWindowHours)
        : buildDailyCostSeries(usage, modelPrices);

    return {
      labels: series.labels,
      datasets: [
        {
          label: t('usage_stats.total_cost'),
          data: series.data,
          borderColor: COST_COLOR,
          backgroundColor: buildCostGradient,
          pointBackgroundColor: COST_COLOR,
          pointBorderColor: COST_COLOR,
          fill: true,
          tension: 0.4,
        },
      ],
    } as ChartJsData<'line'>;
  }, [usage, hasPrices, costBreakdownPeriod, modelPrices, hourWindowHours, t]);

  const requestsChartOptions = useMemo(
    () =>
      buildChartOptions({
        period: requestsPeriod,
        labels: (requestsChartData.labels ?? []) as string[],
        isDark,
        isMobile
      }),
    [requestsPeriod, requestsChartData.labels, isDark, isMobile]
  );

  const tokensChartOptions = useMemo(
    () => {
      const baseOptions = buildChartOptions({
        period: tokensPeriod,
        labels: (tokensChartData.labels ?? []) as string[],
        isDark,
        isMobile,
      }) as ChartOptions<'bar'>;

      return {
        ...baseOptions,
        scales: {
          ...baseOptions.scales,
          y: {
            ...((baseOptions.scales?.y as any) || {}),
            stacked: false,
          },
          x: {
            ...((baseOptions.scales?.x as any) || {}),
            stacked: false,
          },
        },
        plugins: {
          ...baseOptions.plugins,
          tooltip: {
            ...((baseOptions.plugins?.tooltip as any) || {}),
            itemSort: (a: TooltipItem<'bar'>, b: TooltipItem<'bar'>) =>
              a.datasetIndex - b.datasetIndex,
            callbacks: {
              ...(((baseOptions.plugins?.tooltip as any)?.callbacks as object) || {}),
              label: (context: TooltipItem<'bar'>) => {
                const value = Number(context.raw) || 0;
                const category = TOKEN_CATEGORIES[context.datasetIndex];
                let text = `${context.dataset.label}: ${value.toLocaleString()}`;

                if (category === 'cached') {
                  const inputValue =
                    Number(tokensChartData.datasets?.[0]?.data?.[context.dataIndex] ?? 0) || 0;
                  const coldInputValue = Math.max(inputValue - value, 0);
                  const cacheDenominator = coldInputValue + value;
                  if (cacheDenominator > 0) {
                    text += ` (${((value / cacheDenominator) * 100).toFixed(2)}%)`;
                  }
                }

                return text;
              },
            },
          },
        },
      } as ChartOptions<'bar'>;
    },
    [tokensPeriod, tokensChartData, isDark, isMobile]
  );

  const costBreakdownChartOptions = useMemo(
    () => {
      const baseOptions = buildChartOptions({
        period: costBreakdownPeriod,
        labels: (costBreakdownChartData.labels ?? []) as string[],
        isDark,
        isMobile,
      });

      return {
        ...baseOptions,
        scales: {
          ...baseOptions.scales,
          y: {
            ...((baseOptions.scales?.y as any) || {}),
            ticks: {
              ...(((baseOptions.scales?.y as any)?.ticks as object) || {}),
              callback: (value: string | number) => formatUsd(Number(value)),
            },
          },
        },
      } as ChartOptions<'line'>;
    },
    [costBreakdownPeriod, costBreakdownChartData.labels, isDark, isMobile]
  );

  return {
    requestsPeriod,
    setRequestsPeriod,
    tokensPeriod,
    setTokensPeriod,
    costBreakdownPeriod,
    setCostBreakdownPeriod,
    requestsChartData,
    tokensChartData,
    costBreakdownChartData,
    requestsChartOptions,
    tokensChartOptions,
    costBreakdownChartOptions
  };
}
