import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '@/stores';
import type { ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import type { ChartData } from '@/utils/usage';
import { getHourChartMinWidth } from '@/utils/usage/chartConfig';
import styles from '@/pages/UsagePage.module.scss';

export interface UsageChartProps {
  isDark?: boolean;
  title: string;
  period: 'hour' | 'day';
  onPeriodChange: (period: 'hour' | 'day') => void;
  chartData: ChartData;
  chartOptions: ChartOptions<'line'>;
  loading: boolean;
  isMobile: boolean;
  emptyText: string;
  showPeriodControls?: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  summary?: React.ReactNode;
  extra?: React.ReactNode;
}

export function UsageChart({
  title,
  period,
  onPeriodChange,
  chartData,
  chartOptions,
  loading,
  isMobile,
  emptyText,
  showPeriodControls = true,
  isDark: isDarkProp,
  collapsible = false,
  defaultCollapsed = false,
  summary,
  extra,
}: UsageChartProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = isDarkProp ?? resolvedTheme === 'dark';
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  const handleHeaderClick = () => {
    if (collapsible) {
      setExpanded(!expanded);
    }
  };

  return (
    <Card
      title={title}
      collapsible={collapsible}
      defaultCollapsed={defaultCollapsed}
      headerExpanded={expanded}
      onHeaderClick={handleHeaderClick}
      summary={summary}
      extra={
        !collapsible || expanded ? (
          <div className={styles.chartCardActions}>
            {extra}
            {showPeriodControls && (
              <div className={styles.periodButtons}>
              <Button
                variant={period === 'hour' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => onPeriodChange('hour')}
              >
                {t('usage_stats.by_hour')}
              </Button>
              <Button
                variant={period === 'day' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => onPeriodChange('day')}
              >
                {t('usage_stats.by_day')}
              </Button>
              </div>
            )}
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : chartData.labels.length > 0 ? (
        <div className={`${styles.chartWrapper} ${isDark ? "" : "chart-light"}`}>
          <div className={styles.chartLegend} aria-label="Chart legend">
            {chartData.datasets.map((dataset, index) => (
              <div
                key={`${dataset.label}-${index}`}
                className={styles.legendItem}
                title={dataset.label}
              >
                <span className={styles.legendDot} style={{ backgroundColor: dataset.borderColor }} />
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
                    ? { minWidth: getHourChartMinWidth(chartData.labels.length, isMobile) }
                    : undefined
                }
              >
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.hint}>{emptyText}</div>
      )}
    </Card>
  );
}
