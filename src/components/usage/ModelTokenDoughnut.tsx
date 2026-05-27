import { useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions, ScriptableContext } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import * as echarts from 'echarts';
import {
  formatUsd,
  collectUsageDetails,
  formatHourLabel,
  formatDayLabel,
  calculateCost,
  type ModelStatsSummary,
  type ModelPrice,
} from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface ModelTokenDoughnutProps {
  modelStats: ModelStatsSummary[];
  hasPrices: boolean;
  loading: boolean;
  isDark: boolean;
  scopedUsage: unknown;
  chartPeriod: 'hour' | 'day';
  hourWindowHours?: number;
  modelPrices: Record<string, ModelPrice>;
}

interface GradientColor {
  base: string;
  light: string;
}

const DOUGHNUT_COLORS: GradientColor[] = [
  { base: '#38bdf8', light: '#7dd3fc' },
  { base: '#fbbf24', light: '#fcd34d' },
  { base: '#34d399', light: '#6ee7b7' },
  { base: '#a855f7', light: '#c084fc' },
  { base: '#f43f5e', light: '#fb7185' },
  { base: '#64748b', light: '#94a3b8' },
  { base: '#22d3ee', light: '#67e8f9' },
];

const MAX_SEGMENTS = 7;

function toGradient(
  ctx: CanvasRenderingContext2D,
  area: { top: number; bottom: number },
  color: GradientColor
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, color.light);
  gradient.addColorStop(1, color.base);
  return gradient;
}

function formatTokens(num: number): string {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toLocaleString();
}

function toTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(value, 0) : 0;
}

interface TokenUsageTrendChartProps {
  scopedUsage: unknown;
  chartPeriod: 'hour' | 'day';
  hourWindowHours?: number;
  modelPrices: Record<string, ModelPrice>;
  hasPrices: boolean;
  isDark: boolean;
}

function TokenUsageTrendChart({
  scopedUsage,
  chartPeriod,
  hourWindowHours,
  modelPrices,
  hasPrices,
  isDark,
}: TokenUsageTrendChartProps) {
  const { t } = useTranslation();
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const details = useMemo(() => collectUsageDetails(scopedUsage), [scopedUsage]);

  const {
    labels,
    inputData,
    outputData,
    cacheCreationData,
    cacheReadData,
    cacheHitRateData,
    costData,
  } = useMemo(() => {
    const hourlyLabels =
      chartPeriod === 'hour'
        ? (() => {
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
          })()
        : [];

    const dailyLabels =
      chartPeriod === 'day'
        ? Array.from(
            new Set(
              details
                .map((detail) => formatDayLabel(new Date(detail.__timestampMs || 0)))
                .filter(Boolean)
            )
          ).sort()
        : [];

    const labelsList = chartPeriod === 'hour' ? hourlyLabels : dailyLabels;
    const labelIndexMap = new Map(labelsList.map((l, idx) => [l, idx]));

    const inpData = new Array(labelsList.length).fill(0);
    const outData = new Array(labelsList.length).fill(0);
    const ccData = new Array(labelsList.length).fill(0);
    const crData = new Array(labelsList.length).fill(0);
    const cData = new Array(labelsList.length).fill(0);

    details.forEach((detail) => {
      const timestamp = detail.__timestampMs || 0;
      if (timestamp <= 0) return;

      const label =
        chartPeriod === 'hour'
          ? (() => {
              const date = new Date(timestamp);
              date.setMinutes(0, 0, 0);
              return formatHourLabel(date);
            })()
          : formatDayLabel(new Date(timestamp));

      const idx = labelIndexMap.get(label);
      if (idx === undefined) return;

      const tokens = detail.tokens || {};
      const cacheRead = toTokenCount(tokens.cached_tokens);
      inpData[idx] += Math.max(toTokenCount(tokens.input_tokens) - cacheRead, 0);
      outData[idx] += toTokenCount(tokens.output_tokens);
      ccData[idx] += toTokenCount(tokens.cache_tokens);
      crData[idx] += cacheRead;
      cData[idx] += calculateCost(detail, modelPrices);
    });

    const chrData = labelsList.map((_, index) => {
      const inp = inpData[index];
      const cr = crData[index];
      const total = inp + cr;
      return total > 0 ? Number(((cr / total) * 100).toFixed(1)) : 0;
    });

    return {
      labels: labelsList,
      inputData: inpData,
      outputData: outData,
      cacheCreationData: ccData,
      cacheReadData: crData,
      cacheHitRateData: chrData,
      costData: cData,
    };
  }, [details, chartPeriod, hourWindowHours, modelPrices]);

  useEffect(() => {
    if (!chartRef.current) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.dispose();
    }

    const chart = echarts.init(chartRef.current, isDark ? 'dark' : 'light');
    chartInstanceRef.current = chart;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = new ResizeObserver(() => chart.resize());
    resizeObserverRef.current.observe(chartRef.current);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      chart.dispose();
      if (chartInstanceRef.current === chart) {
        chartInstanceRef.current = null;
      }
    };
  }, [isDark]);

  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;

    const inputLabel = t('usage_stats.input_tokens') || 'Input';
    const outputLabel = t('usage_stats.output_tokens') || 'Output';
    const cacheCreationLabel = t('usage_stats.cache_creation') || 'Cache Creation';
    const cacheHitLabel = t('usage_stats.cache_hit') || 'Cache Hit';
    const cacheHitRateLabel = t('usage_stats.cache_hit_rate') || 'Cache Hit Rate';

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      title: {
        text: t('usage_stats.token_usage_trend') || 'Token Usage Trend',
        textStyle: {
          fontSize: 13,
          fontWeight: 'bold',
          color: isDark ? '#f8fafc' : '#111827',
        },
        top: 0,
        left: 0,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: isDark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.98)',
        textStyle: { color: isDark ? '#f8fafc' : '#111827' },
        borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(17,24,39,0.1)',
        borderWidth: 1,
        padding: 10,
        formatter: (params: unknown) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          const firstParam = params[0] as { axisValue?: string | number; dataIndex?: number };
          const header = `<strong>${firstParam.axisValue ?? ''}</strong>`;
          const lines = [header];

          const dataIndex = typeof firstParam.dataIndex === 'number' ? firstParam.dataIndex : 0;
          const inputVal = inputData[dataIndex] || 0;
          const outputVal = outputData[dataIndex] || 0;
          const cacheCreationVal = cacheCreationData[dataIndex] || 0;
          const cacheReadVal = cacheReadData[dataIndex] || 0;
          const hitRateVal = cacheHitRateData[dataIndex] || 0;
          const costVal = costData[dataIndex] || 0;

          lines.push(
            `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:9px;height:9px;background-color:#3b82f6;"></span>${inputLabel}: ${inputVal.toLocaleString()}`
          );
          lines.push(
            `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:9px;height:9px;background-color:#10b981;"></span>${outputLabel}: ${outputVal.toLocaleString()}`
          );
          lines.push(
            `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:9px;height:9px;background-color:#f59e0b;"></span>${cacheCreationLabel}: ${cacheCreationVal.toLocaleString()}`
          );
          lines.push(
            `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:9px;height:9px;background-color:#06b6d4;"></span>${cacheHitLabel}: ${cacheReadVal.toLocaleString()}`
          );
          lines.push(
            `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:9px;height:9px;background-color:#8b5cf6;"></span>${cacheHitRateLabel}: ${hitRateVal.toFixed(1)}%`
          );
          if (hasPrices && costVal > 0) {
            lines.push(
              `<hr style="border-color:rgba(255,255,255,0.15);margin:5px 0;" />Cost: ${formatUsd(costVal)}`
            );
          }
          return lines.join('<br/>');
        },
      },
      legend: {
        show: true,
        top: 0,
        right: 0,
        data: [inputLabel, outputLabel, cacheCreationLabel, cacheHitLabel, cacheHitRateLabel],
        textStyle: {
          color: isDark ? '#9CA3AF' : '#6B7280',
          fontSize: 10,
        },
        itemWidth: 10,
        itemHeight: 6,
      },
      grid: {
        left: 8,
        right: 8,
        top: 38,
        bottom: 12,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: labels,
        axisLabel: {
          color: isDark ? '#94a3b8' : '#6b7280',
          fontSize: 9,
        },
        axisTick: { show: false },
        axisLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          axisLabel: {
            color: isDark ? '#94a3b8' : '#6b7280',
            fontSize: 9,
            formatter: (value: number) => formatTokens(value),
          },
          splitLine: {
            lineStyle: {
              color: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.15)',
            },
          },
        },
        {
          type: 'value',
          min: 0,
          max: 100,
          axisLabel: {
            color: isDark ? '#94a3b8' : '#6b7280',
            fontSize: 9,
            formatter: '{value}%',
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: inputLabel,
          type: 'line',
          data: inputData,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: '#3b82f6' },
          lineStyle: { width: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(59, 130, 246, 0.12)' },
              { offset: 1, color: 'rgba(59, 130, 246, 0.01)' },
            ]),
          },
        },
        {
          name: outputLabel,
          type: 'line',
          data: outputData,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: '#10b981' },
          lineStyle: { width: 2 },
        },
        {
          name: cacheCreationLabel,
          type: 'line',
          data: cacheCreationData,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: '#f59e0b' },
          lineStyle: { width: 2 },
        },
        {
          name: cacheHitLabel,
          type: 'line',
          data: cacheReadData,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: '#06b6d4' },
          lineStyle: { width: 2 },
        },
        {
          name: cacheHitRateLabel,
          type: 'line',
          yAxisIndex: 1,
          data: cacheHitRateData,
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: '#8b5cf6' },
          lineStyle: { width: 2, type: 'dashed' },
        },
      ],
    };

    chart.setOption(option, { notMerge: false, lazyUpdate: true });
  }, [
    labels,
    inputData,
    outputData,
    cacheCreationData,
    cacheReadData,
    cacheHitRateData,
    costData,
    isDark,
    t,
    hasPrices,
  ]);

  return <div ref={chartRef} style={{ width: '100%', height: 260 }} />;
}

export function ModelTokenDoughnut({
  modelStats,
  hasPrices,
  loading,
  isDark,
  scopedUsage,
  chartPeriod,
  hourWindowHours,
  modelPrices,
}: ModelTokenDoughnutProps) {
  const { t } = useTranslation();

  const { chartData, chartOptions, totalTokens, segments } = useMemo(() => {
    const sorted = [...modelStats].sort((a, b) => b.tokens - a.tokens);
    const top = sorted.slice(0, MAX_SEGMENTS - 1);
    const otherTokens = sorted.slice(MAX_SEGMENTS - 1).reduce((sum, s) => sum + s.tokens, 0);

    const segments: {
      label: string;
      tokens: number;
      cost: number;
      color: GradientColor;
    }[] = [];
    top.forEach((s, i) => {
      segments.push({
        label: s.model,
        tokens: s.tokens,
        cost: s.cost,
        color: DOUGHNUT_COLORS[i % DOUGHNUT_COLORS.length],
      });
    });
    if (otherTokens > 0) {
      segments.push({
        label: t('usage_stats.others'),
        tokens: otherTokens,
        cost: 0,
        color: { base: '#64748b', light: '#94a3b8' },
      });
    }

    const total = segments.reduce((sum, s) => sum + s.tokens, 0);

    const data: ChartData<'doughnut', number[], string> = {
      labels: segments.map((s) => s.label),
      datasets: [
        {
          data: segments.map((s) => s.tokens),
          backgroundColor: (ctx: ScriptableContext<'doughnut'>) => {
            const { chart } = ctx;
            const area = chart.chartArea;
            if (!area) return segments[ctx.dataIndex]?.color.base ?? '#64748b';
            return toGradient(
              chart.ctx,
              area,
              segments[ctx.dataIndex]?.color ?? { base: '#64748b', light: '#94a3b8' }
            );
          },
          borderColor: isDark ? '#0f172a' : '#ffffff',
          borderWidth: 3,
          borderRadius: 6,
          hoverBorderWidth: 4,
          hoverBorderColor: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)',
          borderJoinStyle: 'round' as CanvasLineJoin,
          spacing: 2,
        },
      ],
    };

    const textColor = isDark ? '#f8fafc' : '#111827';
    const subColor = isDark ? '#64748b' : '#6b7280';
    const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(17,24,39,0.1)';

    const options: ChartOptions<'doughnut'> = {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      animation: {
        animateScale: true,
        animateRotate: true,
        duration: 800,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? 'rgba(15,23,42,0.94)' : 'rgba(255,255,255,0.98)',
          titleColor: textColor,
          bodyColor: subColor,
          borderColor,
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          usePointStyle: true,
          boxPadding: 4,
          callbacks: {
            label: (ctx) => {
              const seg = segments[ctx.dataIndex];
              if (!seg) return '';
              const pct = total > 0 ? ((seg.tokens / total) * 100).toFixed(1) : '0';
              const parts = [`  ${seg.label}: ${formatTokens(seg.tokens)} (${pct}%)`];
              if (hasPrices && seg.cost > 0) {
                parts.push(`  ${t('usage_stats.cost_trend')}: ${formatUsd(seg.cost)}`);
              }
              return parts;
            },
          },
        },
      },
      hover: {
        mode: 'nearest' as const,
        intersect: true,
      },
    };

    return { chartData: data, chartOptions: options, totalTokens: total, segments };
  }, [modelStats, isDark, hasPrices, t]);

  if (loading) {
    return (
      <div className={styles.tokenDistCard}>
        <div className={styles.tokenDistHeader}>
          <h3 className={styles.tokenDistTitle}>{t('usage_stats.model_token_distribution')}</h3>
        </div>
        <div className={styles.tokenDistContent}>
          <div className={styles.tokenDistChartPlaceholder}>
            <div className={styles.tokenDistChartSkeleton} />
          </div>
          <div className={styles.tokenDistLegendPlaceholder}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className={styles.tokenDistLegendItemSkeleton}>
                <div className={styles.tokenDistLegendDotSkeleton} />
                <div className={styles.tokenDistLegendTextSkeleton} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className={styles.tokenDistCard}>
        <div className={styles.tokenDistHeader}>
          <h3 className={styles.tokenDistTitle}>{t('usage_stats.model_token_distribution')}</h3>
        </div>
        <div className={styles.tokenDistContent}>
          <div className={styles.hint}>{t('usage_stats.no_data')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tokenDistCard}>
      <div className={styles.tokenDistHeader}>
        <h3 className={styles.tokenDistTitle}>{t('usage_stats.model_token_distribution')}</h3>
        <span className={styles.tokenDistBadge}>
          {t('usage_stats.total_tokens')}: {formatTokens(totalTokens)}
        </span>
      </div>

      <div className={styles.tokenDistContent}>
        <div className={styles.tokenDistChart}>
          <div className={styles.tokenDistCenter}>
            <span className={styles.tokenDistTotal}>{formatTokens(totalTokens)}</span>
            <span className={styles.tokenDistLabel}>{t('usage_stats.total_tokens')}</span>
          </div>
          <Doughnut data={chartData} options={chartOptions} />
        </div>

        <div className={styles.tokenDistGrid}>
          {segments.map((seg) => {
            const pct = totalTokens > 0 ? (seg.tokens / totalTokens) * 100 : 0;

            return (
              <div key={seg.label} className={styles.tokenDistItem}>
                <div className={styles.tokenDistItemTop}>
                  <div className={styles.tokenDistItemInfo}>
                    <span
                      className={styles.tokenDistDot}
                      style={{
                        background: seg.color.base,
                        boxShadow: `0 0 6px ${seg.color.base}66`,
                      }}
                    />
                    <span className={styles.tokenDistName} title={seg.label}>
                      {seg.label}
                    </span>
                  </div>
                  <div className={styles.tokenDistItemValue}>
                    <span className={styles.tokenDistValue}>{formatTokens(seg.tokens)}</span>
                    <span className={styles.tokenDistPercent}>{pct.toFixed(1)}%</span>
                  </div>
                </div>
                <div className={styles.tokenDistItemTrack}>
                  <div
                    className={styles.tokenDistItemProgress}
                    style={{ width: `${pct}%`, backgroundColor: seg.color.base }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.tokenDistStructureChart}>
          <TokenUsageTrendChart
            scopedUsage={scopedUsage}
            chartPeriod={chartPeriod}
            hourWindowHours={hourWindowHours}
            modelPrices={modelPrices}
            hasPrices={hasPrices}
            isDark={isDark}
          />
        </div>
      </div>
    </div>
  );
}
