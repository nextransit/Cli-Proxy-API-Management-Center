import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { TelemetryChart } from '@/components/charts/TelemetryChart';
import { GranularityCapsule } from '@/components/charts/GranularityCapsule';
import { getThemeColors } from '@/utils/echarts/themeBridge';
import { buildEChartsTrendOption } from '@/utils/usage/chartConfig';
import {
  getRankColor,
  buildAreaGradient,
} from '@/utils/usage/chartPalette';
import {
  formatDayLabel,
  formatHourLabel,
  extractTotalTokens,
  getCacheHitRate,
  getTokenBreakdownValue,
  type ChartData,
  type UsageTimeRange,
  type UsageDetail,
} from '@/utils/usage';
import { maskApiKey } from '@/utils/format';
import styles from '@/pages/UsagePage.module.scss';

export type UsageChartMetric = 'requests' | 'tokens';

export interface UsageChartProps {
  title: string;
  metric: UsageChartMetric;
  scopedDetails: UsageDetail[];
  chartCompareMode: 'model' | 'credential';
  clientApiKeyInfoMap: Map<string, { label: string; masked: string }>;
  resolvedChartLines: string[];
  hourWindowHours?: number;
  focusedModel?: string | null;
  loading: boolean;
  isMobile: boolean;
  isNarrowScreen: boolean;
  isDark?: boolean;
  emptyText: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  summary?: React.ReactNode;
  extra?: React.ReactNode;
  timeRange: UsageTimeRange;
  period: 'hour' | 'day';
  onPeriodChange: (next: 'hour' | 'day') => void;
  cardId: string;
}

const ALL_FILTER = 'all';
const DEFAULT_CHART_LINES = ['all'];
const MAX_CHART_DETAILS = 5_000;
const TOKEN_FOCUS_CHART_COLORS = {
  input: '#00E5FF',
  cache: '#7C4DFF',
  output: '#22c55e',
  rate: '#94a3b8',
};

// Sample details when the dataset is too large for chart rendering.
function sampleDetails(details: UsageDetail[], max: number): UsageDetail[] {
  if (details.length <= max) return details;
  const step = details.length / max;
  const sampled: UsageDetail[] = [];
  for (let i = 0; i < details.length; i++) {
    if (Math.floor(i / step) === sampled.length) {
      sampled.push(details[i]);
    }
    if (sampled.length >= max) break;
  }
  return sampled;
}

const withAlpha = (hex: string, alpha: number): string => {
  const normalized = hex.replace('#', '');
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (![r, g, b].every((channel) => Number.isFinite(channel))) {
    return hex;
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(alpha, 1))})`;
};

const formatCredentialShortName = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '-';
  return maskApiKey(trimmed) || trimmed;
};

const buildHourlyLabels = (hourWindowHours: number | undefined): string[] => {
  const hourMs = 60 * 60 * 1000;
  const resolvedHourWindow =
    Number.isFinite(hourWindowHours) && hourWindowHours && hourWindowHours > 0
      ? Math.min(Math.max(Math.floor(hourWindowHours), 1), 24 * 31)
      : 24;
  const currentHour = new Date();
  currentHour.setMinutes(0, 0, 0);
  const earliest = new Date(currentHour);
  earliest.setHours(earliest.getHours() - (resolvedHourWindow - 1));
  const earliestTime = earliest.getTime();
  return Array.from({ length: resolvedHourWindow }, (_, index) =>
    formatHourLabel(new Date(earliestTime + index * hourMs))
  );
};

export const UsageChart = memo(function UsageChart({
  title,
  metric,
  scopedDetails,
  chartCompareMode,
  clientApiKeyInfoMap,
  resolvedChartLines,
  hourWindowHours,
  focusedModel = null,
  loading,
  isMobile: _isMobile,
  isNarrowScreen,
  // isDark is accepted for API surface parity; TelemetryChart handles its own theme.
  isDark: _isDark,
  emptyText,
  collapsible = false,
  defaultCollapsed = false,
  summary,
  extra,
  timeRange,
  period,
  onPeriodChange,
  cardId,
}: UsageChartProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  const handleHeaderClick = () => {
    if (collapsible) {
      setExpanded(!expanded);
    }
  };

  const chartData = useMemo<ChartData>(() => {
    if (metric === 'tokens' && focusedModel && focusedModel !== '__all__') {
      return buildFocusedTokenChartData(focusedModel, period, scopedDetails, hourWindowHours, t);
    }
    return buildTrendChartData(
      metric,
      period,
      scopedDetails,
      chartCompareMode,
      clientApiKeyInfoMap,
      resolvedChartLines,
      hourWindowHours,
      t
    );
  }, [
    chartCompareMode,
    clientApiKeyInfoMap,
    focusedModel,
    hourWindowHours,
    metric,
    period,
    resolvedChartLines,
    scopedDetails,
    t,
  ]);

  const option = useMemo(() => {
    if (chartData.labels.length === 0) return null;
    const theme = getThemeColors();
    return buildEChartsTrendOption(chartData, theme, { isNarrowScreen });
  }, [chartData, isNarrowScreen]);

  const capsule = (
    <GranularityCapsule
      cardId={cardId}
      value={period}
      onChange={onPeriodChange}
      timeRange={timeRange}
    />
  );

  if (collapsible) {
    return (
      <Card
        title={title}
        collapsible
        defaultCollapsed={defaultCollapsed}
        headerExpanded={expanded}
        onHeaderClick={handleHeaderClick}
        summary={summary}
        extra={capsule}
      >
        {renderBody()}
      </Card>
    );
  }

  return (
    <TelemetryChart
      title={title}
      option={option ?? { series: [] }}
      loading={loading}
      extraControls={
        <>
          {extra}
          {capsule}
        </>
      }
    />
  );

  function renderBody() {
    if (loading) {
      return (
        <div className={styles.chartSkeletonPlaceholder}>
          <div className={styles.chartSkeletonBars}>
            {[40, 65, 45, 80, 55, 70, 50, 85, 60, 75, 45, 90].map((h, i) => (
              <div key={i} className={styles.chartSkeletonBar} style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      );
    }
    if (chartData.labels.length === 0) {
      return <div className={styles.hint}>{emptyText}</div>;
    }
    return (
      <div className={styles.hint}>
        Collapsible UsageChart branch with data: {chartData.labels.length} labels
      </div>
    );
  }
});

function getTrendValue(metric: UsageChartMetric, detail: UsageDetail): number {
  if (metric === 'tokens') {
    return extractTotalTokens(detail);
  }
  return 1;
}

function buildTrendChartData(
  metric: UsageChartMetric,
  period: 'hour' | 'day',
  scopedDetails: UsageDetail[],
  chartCompareMode: 'model' | 'credential',
  clientApiKeyInfoMap: Map<string, { label: string; masked: string }>,
  resolvedChartLines: string[],
  hourWindowHours: number | undefined,
  t: (key: string) => string
): ChartData {
  const details = sampleDetails(scopedDetails, MAX_CHART_DETAILS);
  const labels =
    period === 'hour'
      ? buildHourlyLabels(hourWindowHours)
      : Array.from(
          new Set(
            details
              .map((detail) => formatDayLabel(new Date(detail.__timestampMs || 0)))
              .filter(Boolean)
          )
        ).sort();
  const dataByKey = new Map<string, number[]>();
  const labelIndex = new Map(labels.map((label, index) => [label, index]));
  const lineLabels = new Map<string, string>();

  details.forEach((detail) => {
    const timestamp = detail.__timestampMs || 0;
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;

    const label =
      period === 'hour'
        ? (() => {
            const date = new Date(timestamp);
            date.setMinutes(0, 0, 0);
            return formatHourLabel(date);
          })()
        : formatDayLabel(new Date(timestamp));
    const index = labelIndex.get(label);
    if (index === undefined) return;

    const credentialKey = String(detail.__apiKey ?? '').trim() || 'unknown';
    const keyInfo = clientApiKeyInfoMap.get(credentialKey);
    const key =
      chartCompareMode === 'credential' ? credentialKey : detail.__modelName || 'Unknown';
    const displayLabel =
      chartCompareMode === 'credential'
        ? keyInfo?.label || formatCredentialShortName(key)
        : key;

    if (!dataByKey.has(key)) {
      dataByKey.set(key, new Array(labels.length).fill(0));
      lineLabels.set(key, displayLabel);
    }
    dataByKey.get(key)![index] += getTrendValue(metric, detail);
  });

  const selectedLines = resolvedChartLines.length > 0 ? resolvedChartLines : DEFAULT_CHART_LINES;
  const rawSeries = selectedLines.map((line) => {
    const isAll = line === ALL_FILTER;
    const data = isAll
      ? labels.map((_, labelIndexValue) =>
          Array.from(dataByKey.values()).reduce(
            (sum, values) => sum + (values[labelIndexValue] || 0),
            0
          )
        )
      : dataByKey.get(line) || new Array(labels.length).fill(0);
    const total = data.reduce((sum, value) => sum + value, 0);

    return {
      line,
      total,
      label: isAll
        ? chartCompareMode === 'credential'
          ? t('usage_stats.chart_line_all_credentials')
          : t('usage_stats.chart_line_all')
        : lineLabels.get(line) || formatCredentialShortName(line),
      data,
    };
  });
  const rankedLines = [...rawSeries].sort((a, b) => b.total - a.total);
  const rankByLine = new Map(rankedLines.map((series, index) => [series.line, index]));
  const datasets = rawSeries.map((series) => {
    const rank = rankByLine.get(series.line) ?? 0;
    const color = getRankColor(rank);
    const isTop = rank === 0;
    const borderWidth = rank === 0 ? 2 : rank < 8 ? 1.5 : 1;
    const pointHoverRadius = rank === 0 ? 6 : 4;

    return {
      label: series.label,
      data: series.data,
      borderColor: color,
      backgroundColor: buildAreaGradient(color),
      pointBackgroundColor: color,
      pointBorderColor: color,
      borderWidth,
      pointRadius: 0,
      pointHoverRadius,
      pointHitRadius: 10,
      pointBorderWidth: 0,
      pointHoverBorderWidth: 2,
      fill: isTop,
      tension: 0.42,
      order: rank,
    };
  });

  return { labels, datasets };
}

function buildFocusedTokenChartData(
  modelName: string,
  period: 'hour' | 'day',
  scopedDetails: UsageDetail[],
  hourWindowHours: number | undefined,
  t: (key: string) => string
): ChartData {
  const details = sampleDetails(scopedDetails, MAX_CHART_DETAILS).filter((detail) => detail.__modelName === modelName);
  const labels =
    period === 'hour'
      ? buildHourlyLabels(hourWindowHours)
      : Array.from(
          new Set(
            details
              .map((detail) => formatDayLabel(new Date(detail.__timestampMs || 0)))
              .filter(Boolean)
          )
        ).sort();
  const labelIndex = new Map(labels.map((label, index) => [label, index]));
  const inputData = new Array(labels.length).fill(0);
  const outputData = new Array(labels.length).fill(0);
  const cacheData = new Array(labels.length).fill(0);

  details.forEach((detail) => {
    const timestamp = detail.__timestampMs || 0;
    if (!Number.isFinite(timestamp) || timestamp <= 0) return;

    const label =
      period === 'hour'
        ? (() => {
            const date = new Date(timestamp);
            date.setMinutes(0, 0, 0);
            return formatHourLabel(date);
          })()
        : formatDayLabel(new Date(timestamp));
    const index = labelIndex.get(label);
    if (index === undefined) return;

    inputData[index] += getTokenBreakdownValue('input', detail);
    outputData[index] += getTokenBreakdownValue('output', detail);
    cacheData[index] += getTokenBreakdownValue('cache', detail);
  });

  const cacheHitRateData = labels.map((_, index) =>
    getCacheHitRate(inputData[index], cacheData[index])
  );

  return {
    labels,
    datasets: [
      {
        label: t('usage_stats.input_tokens'),
        data: inputData,
        borderColor: TOKEN_FOCUS_CHART_COLORS.input,
        backgroundColor: withAlpha(TOKEN_FOCUS_CHART_COLORS.input, 0.15),
        pointBackgroundColor: TOKEN_FOCUS_CHART_COLORS.input,
        pointBorderColor: TOKEN_FOCUS_CHART_COLORS.input,
        borderWidth: 2.4,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHitRadius: 10,
        fill: true,
        tension: 0.42,
      },
      {
        label: t('usage_stats.output_tokens'),
        data: outputData,
        borderColor: TOKEN_FOCUS_CHART_COLORS.output,
        backgroundColor: 'rgba(255, 255, 255, 0)',
        pointBackgroundColor: TOKEN_FOCUS_CHART_COLORS.output,
        pointBorderColor: TOKEN_FOCUS_CHART_COLORS.output,
        borderWidth: 1.9,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        fill: false,
        tension: 0.42,
      },
      {
        label: t('usage_stats.cache_hit'),
        data: cacheData,
        borderColor: TOKEN_FOCUS_CHART_COLORS.cache,
        backgroundColor: 'rgba(255, 255, 255, 0)',
        pointBackgroundColor: TOKEN_FOCUS_CHART_COLORS.cache,
        pointBorderColor: TOKEN_FOCUS_CHART_COLORS.cache,
        borderWidth: 1.8,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        fill: false,
        tension: 0.42,
      },
      {
        label: t('usage_stats.cache_hit_rate'),
        data: cacheHitRateData,
        borderColor: TOKEN_FOCUS_CHART_COLORS.rate,
        backgroundColor: 'rgba(255, 255, 255, 0)',
        pointBackgroundColor: TOKEN_FOCUS_CHART_COLORS.rate,
        pointBorderColor: TOKEN_FOCUS_CHART_COLORS.rate,
        borderWidth: 1.4,
        pointRadius: 0,
        pointHoverRadius: 3,
        pointHitRadius: 10,
        fill: false,
        tension: 0.42,
        yAxisID: 'yRate',
        borderDash: [5, 4],
      },
    ],
  };
}
