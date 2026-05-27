import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions, TooltipItem } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  buildHourlyTokenBreakdown,
  buildDailyTokenBreakdown,
  type TokenCategory,
} from '@/utils/usage';
import { buildChartOptions, getHourChartMinWidth } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

const TOKEN_COLORS: Record<TokenCategory, string> = {
  input: '#06b6d4',
  output: '#22d3ee',
  cached: '#0891b2',
  reasoning: '#67e8f9',
};

const CATEGORIES: TokenCategory[] = ['input', 'output', 'cached', 'reasoning'];

function formatTokens(num: number): string {
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toString();
}

export interface TokenBreakdownChartProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  hourWindowHours?: number;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  summary?: React.ReactNode;
}

export function TokenBreakdownChart({
  usage,
  loading,
  isDark,
  isMobile,
  hourWindowHours,
  collapsible = false,
  defaultCollapsed = false,
  summary,
}: TokenBreakdownChartProps) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<'hour' | 'day'>('hour');
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  const { chartData, chartOptions } = useMemo(() => {
    const series =
      period === 'hour'
        ? buildHourlyTokenBreakdown(usage, hourWindowHours)
        : buildDailyTokenBreakdown(usage);
    const categoryLabels: Record<TokenCategory, string> = {
      input: t('usage_stats.input_tokens'),
      output: t('usage_stats.output_tokens'),
      cached: t('usage_stats.cached_tokens'),
      reasoning: t('usage_stats.reasoning_tokens'),
    };

    const data: ChartData<'bar'> = {
      labels: series.labels,
      datasets: CATEGORIES.map((cat) => ({
        label: categoryLabels[cat],
        data: series.dataByCategory[cat],
        backgroundColor: TOKEN_COLORS[cat],
        borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#ffffff',
        borderWidth: 1,
        borderSkipped: false,
        grouped: true,
        categoryPercentage: 0.82,
        barPercentage: 0.88,
      })),
    };

    const baseOptions = buildChartOptions({
      period,
      labels: series.labels,
      isDark,
      isMobile,
    }) as ChartOptions<'bar'>;
    const options: ChartOptions<'bar'> = {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          stacked: false,
        },
        x: {
          ...baseOptions.scales?.x,
          stacked: false,
        },
      },
      plugins: {
        ...baseOptions.plugins,
        tooltip: {
          ...baseOptions.plugins?.tooltip,
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
          callbacks: {
            ...baseOptions.plugins?.tooltip?.callbacks,
            label: function (context: TooltipItem<'bar'>) {
              const val = Number(context.raw) || 0;
              const cat = CATEGORIES[context.datasetIndex];
              let text = `${context.dataset.label}: ${formatTokens(val)}`;

              if (cat === 'cached') {
                const inputVal = Number(series.dataByCategory.input[context.dataIndex]) || 0;
                const coldInputVal = Math.max(inputVal - val, 0);
                const cacheDenominator = coldInputVal + val;
                if (cacheDenominator > 0) {
                  const perc = ((val / cacheDenominator) * 100).toFixed(2);
                  text += ` (${perc}%)`;
                }
              }
              return text;
            },
          },
        },
      },
    };

    return { chartData: data, chartOptions: options };
  }, [usage, period, isDark, isMobile, hourWindowHours, t]);
  const labels = chartData.labels ?? [];

  const handleHeaderClick = () => {
    if (collapsible) {
      setExpanded(!expanded);
    }
  };

  return (
    <Card
      title={t('usage_stats.token_breakdown')}
      collapsible={collapsible}
      defaultCollapsed={defaultCollapsed}
      headerExpanded={expanded}
      onHeaderClick={handleHeaderClick}
      summary={summary}
      extra={
        !collapsible || expanded ? (
          <div className={styles.periodButtons}>
            <Button
              variant={period === 'hour' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setPeriod('hour')}
            >
              {t('usage_stats.by_hour')}
            </Button>
            <Button
              variant={period === 'day' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setPeriod('day')}
            >
              {t('usage_stats.by_day')}
            </Button>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : labels.length > 0 ? (
        <div className={styles.chartWrapper}>
          <div className={styles.chartLegend} aria-label="Chart legend">
            {chartData.datasets.map((dataset, index) => (
              <div
                key={`${dataset.label}-${index}`}
                className={styles.legendItem}
                title={dataset.label}
              >
                <span
                  className={styles.legendDot}
                  style={{ backgroundColor: TOKEN_COLORS[CATEGORIES[index]] }}
                />
                <span className={styles.legendLabel}>{dataset.label}</span>
              </div>
            ))}
          </div>
          <div className={styles.chartArea}>
            <div className={styles.chartScroller}>
              <div
                className={styles.chartCanvas}
                style={
                  period === 'hour'
                    ? { minWidth: getHourChartMinWidth(labels.length, isMobile) }
                    : undefined
                }
              >
                <Bar data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
