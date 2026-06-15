import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { TelemetryChart } from '@/components/charts/TelemetryChart';
import { GranularityCapsule } from '@/components/charts/GranularityCapsule';
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
import type { UsagePayload } from './hooks/useUsageData';
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
  period: 'hour' | 'day';
  onPeriodChange: (next: 'hour' | 'day') => void;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  summary?: React.ReactNode;
}

const COST_COLOR = '#06b6d4';

type TooltipParam = {
  axisValue?: string | number;
  marker?: string;
  seriesName?: string;
  value?: number | string | Array<number | string>;
};

const escapeHtml = (value: string | number | undefined): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getTooltipValue = (value: TooltipParam['value']): number => {
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
};

export function CostTrendChart({
  usage,
  loading,
  isDark: _isDark,
  isMobile: _isMobile,
  isNarrowScreen,
  modelPrices,
  hourWindowHours,
  timeRange,
  period,
  onPeriodChange,
  collapsible = false,
  defaultCollapsed = false,
  summary,
}: CostTrendChartProps) {
  const { t } = useTranslation();
  const hasPrices = Object.keys(modelPrices).length > 0;

  const chartData: ChartData | null = useMemo(() => {
    if (!hasPrices || !usage) return null;
    const series =
      period === 'hour'
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
  }, [hasPrices, hourWindowHours, modelPrices, period, t, usage]);

  const option = useMemo(() => {
    if (!chartData) return null;
    const theme = getThemeColors();
    const base = buildEChartsTrendOption(chartData, theme, { isNarrowScreen });
    const yAxis = base.yAxis as { axisLabel?: Record<string, unknown> } | undefined;
    const tooltip = base.tooltip as Record<string, unknown> | undefined;
    return {
      ...base,
      tooltip: {
        ...(tooltip ?? {}),
        formatter: (params: unknown) => {
          const items = Array.isArray(params) ? params : [params];
          const first = items[0] as TooltipParam | undefined;
          const lines = [`<strong>${escapeHtml(first?.axisValue)}</strong>`];
          items.forEach((item) => {
            const param = item as TooltipParam;
            const marker = param.marker ?? '';
            const seriesName = escapeHtml(param.seriesName ?? t('usage_stats.total_cost'));
            lines.push(`${marker}${seriesName}: ${formatUsd(getTooltipValue(param.value))}`);
          });
          return lines.join('<br/>');
        },
      },
      yAxis: {
        ...(yAxis as object),
        axisLabel: {
          ...(yAxis?.axisLabel ?? {}),
          formatter: (v: number | string) => formatUsd(Number(v)),
        },
      },
    };
  }, [chartData, isNarrowScreen]);

  const capsule = (
    <GranularityCapsule
      cardId="usage_cost"
      value={period}
      onChange={onPeriodChange}
      timeRange={timeRange}
    />
  );

  if (collapsible) {
    return (
      <Card
        title={t('usage_stats.cost_trend')}
        collapsible
        defaultCollapsed={defaultCollapsed}
        headerExpanded={!defaultCollapsed}
        onHeaderClick={() => {}}
        summary={summary}
        extra={capsule}
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
      extraControls={capsule}
    />
  );

  function renderBody() {
    if (loading) return <div className={styles.hint}>{t('common.loading')}</div>;
    if (!hasPrices) return <div className={styles.hint}>{t('usage_stats.cost_need_price')}</div>;
    if (!chartData) return <div className={styles.hint}>{t('usage_stats.cost_no_data')}</div>;
    return null;
  }
}
