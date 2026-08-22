import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import * as echarts from 'echarts';
import {
  formatUsd,
  collectUsageDetails,
  formatHourLabel,
  formatDayLabel,
  calculateCost,
  type ModelStatsSummary,
  type ModelPrice,
  type UsageTimeRange,
} from '@/utils/usage';
import { useThemeStore } from '@/stores';
import { useEChartsResize } from '@/hooks/useEChartsResize';
import { registerCliThemes } from '@/utils/echarts/registerThemes';
import { TelemetryChart } from '@/components/charts/TelemetryChart';
import { GranularityCapsule } from '@/components/charts/GranularityCapsule';
import styles from '@/pages/UsagePage.module.scss';

registerCliThemes();

interface DoughnutRingProps {
  option: echarts.EChartsOption;
  height: number;
  className?: string;
}

function DoughnutRing({ option, height, className }: DoughnutRingProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.EChartsType | null>(null);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const instance = echarts.init(
      container,
      resolvedTheme === 'dark' ? 'cli-dark' : 'cli-light',
      { renderer: 'canvas' }
    );
    instanceRef.current = instance;
    return () => {
      instance.dispose();
      instanceRef.current = null;
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    instance.setOption(option, { notMerge: false, lazyUpdate: true });
  }, [option]);

  useEChartsResize(containerRef, () => {
    instanceRef.current?.resize();
  });

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height }}
      data-testid="doughnut-mount"
    />
  );
}


export interface ModelTokenDoughnutProps {
  modelStats: ModelStatsSummary[];
  hasPrices: boolean;
  loading: boolean;
  isDark: boolean;
  scopedUsage: unknown;
  chartPeriod: 'hour' | 'day';
  hourWindowHours?: number;
  modelPrices: Record<string, ModelPrice>;
  timeRange: UsageTimeRange;
  onChartPeriodChange?: (next: 'hour' | 'day') => void;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
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
  timeRange: UsageTimeRange;
  onChartPeriodChange?: (next: 'hour' | 'day') => void;
}

function TokenUsageTrendChart({
  scopedUsage,
  chartPeriod,
  hourWindowHours,
  modelPrices,
  hasPrices,
  isDark,
  timeRange,
  onChartPeriodChange,
}: TokenUsageTrendChartProps) {
  const { t } = useTranslation();

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

  const option = useMemo<echarts.EChartsOption>(() => {
    const inputLabel = t('usage_stats.input_tokens') || 'Input';
    const outputLabel = t('usage_stats.output_tokens') || 'Output';
    const cacheCreationLabel = t('usage_stats.cache_creation') || 'Cache Creation';
    const cacheHitLabel = t('usage_stats.cache_hit') || 'Cache Hit';
    const cacheHitRateLabel = t('usage_stats.cache_hit_rate') || 'Cache Hit Rate';

    return {
      backgroundColor: 'transparent',
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

  return (
    <TelemetryChart
      title={t('usage_stats.token_usage_trend') || 'Token Usage Trend'}
      option={option}
      height={260}
      extraControls={
        <GranularityCapsule
          cardId="usage_doughnut"
          value={chartPeriod}
          onChange={(next) => onChartPeriodChange?.(next)}
          timeRange={timeRange}
        />
      }
    />
  );
}

const TOKEN_DIST_INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, label, summary, [role="button"], [role="switch"], [data-card-header-ignore-click]';

function shouldIgnoreHeaderToggle(target: EventTarget | null, currentTarget: Element) {
  if (!(target instanceof Element)) {
    return false;
  }
  const interactiveElement = target.closest(TOKEN_DIST_INTERACTIVE_SELECTOR);
  return Boolean(interactiveElement && interactiveElement !== currentTarget);
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
  timeRange,
  onChartPeriodChange,
  collapsible = false,
  defaultCollapsed = false,
}: ModelTokenDoughnutProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const isCollapsed = !expanded;

  const handleHeaderClick = useCallback(
    (event?: MouseEvent<HTMLDivElement>) => {
      if (!collapsible) return;
      if (event && shouldIgnoreHeaderToggle(event.target, event.currentTarget)) {
        return;
      }
      setExpanded((prev) => !prev);
    },
    [collapsible]
  );

  const handleHeaderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!collapsible) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (shouldIgnoreHeaderToggle(event.target, event.currentTarget)) {
        return;
      }
      event.preventDefault();
      setExpanded((prev) => !prev);
    },
    [collapsible]
  );

  const headerClass = [styles.tokenDistHeader, collapsible ? styles.tokenDistHeaderClickable : '', isCollapsed ? styles.tokenDistHeaderCollapsed : '']
    .filter(Boolean)
    .join(' ');
  const bodyClass = [styles.tokenDistContent, isCollapsed ? styles.tokenDistContentCollapsed : '']
    .filter(Boolean)
    .join(' ');

  const tokenDistChevron = collapsible ? (
    <span className={`${styles.tokenDistChevron} ${isCollapsed ? styles.tokenDistChevronCollapsed : ''}`}>
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M4 6L8 10L12 6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  ) : null;

  const { doughnutOption, totalTokens, segments } = useMemo(() => {
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

    const ringBorder = isDark ? '#0f172a' : '#ffffff';
    const textColor = isDark ? '#f8fafc' : '#111827';
    const tooltipBg = isDark ? 'rgba(15,23,42,0.94)' : 'rgba(255,255,255,0.98)';
    const tooltipBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(17,24,39,0.1)';

    const data = segments.map((s) => ({
      name: s.label,
      value: s.tokens,
      itemStyle: { color: s.color.base },
    }));

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animationDuration: 800,
      animationEasing: 'cubicOut',
      tooltip: {
        trigger: 'item',
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: 12,
        textStyle: { color: textColor, fontSize: 12 },
        formatter: (params: unknown) => {
          const item = params as { name?: string; data?: { name?: string } | number; value?: number; dataIndex?: number };
          const idx = typeof item.dataIndex === 'number' ? item.dataIndex : 0;
          const seg = segments[idx];
          if (!seg) return '';
          const pct = total > 0 ? ((seg.tokens / total) * 100).toFixed(1) : '0';
          const lines = [`${seg.label}: ${formatTokens(seg.tokens)} (${pct}%)`];
          if (hasPrices && seg.cost > 0) {
            lines.push(`${t('usage_stats.cost_trend')}: ${formatUsd(seg.cost)}`);
          }
          return lines.join('<br/>');
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '78%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderColor: ringBorder,
            borderWidth: 3,
            borderRadius: 6,
          },
          label: { show: false },
          labelLine: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 6,
            itemStyle: {
              borderWidth: 4,
              borderColor: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)',
            },
          },
          data,
        },
      ],
    };

    return { doughnutOption: option, totalTokens: total, segments };
  }, [modelStats, isDark, hasPrices, t]);

  if (loading) {
    return (
      <div className={styles.tokenDistCard}>
        <div
          className={headerClass}
          onClick={handleHeaderClick}
          onKeyDown={handleHeaderKeyDown}
          role={collapsible ? 'button' : undefined}
          tabIndex={collapsible ? 0 : undefined}
          aria-expanded={collapsible ? expanded : undefined}
        >
          <h3 className={styles.tokenDistTitle}>
            {tokenDistChevron}
            {t('usage_stats.model_token_distribution')}
          </h3>
        </div>
        <div className={bodyClass}>
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
        <div
          className={headerClass}
          onClick={handleHeaderClick}
          onKeyDown={handleHeaderKeyDown}
          role={collapsible ? 'button' : undefined}
          tabIndex={collapsible ? 0 : undefined}
          aria-expanded={collapsible ? expanded : undefined}
        >
          <h3 className={styles.tokenDistTitle}>
            {tokenDistChevron}
            {t('usage_stats.model_token_distribution')}
          </h3>
        </div>
        <div className={bodyClass}>
          <div className={styles.hint}>{t('usage_stats.no_data')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tokenDistCard}>
      <div
        className={headerClass}
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKeyDown}
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? expanded : undefined}
      >
        <h3 className={styles.tokenDistTitle}>
          {tokenDistChevron}
          {t('usage_stats.model_token_distribution')}
        </h3>
      </div>

      <div className={bodyClass}>
        <div className={styles.tokenDistChart}>
          <div className={styles.tokenDistCenter}>
            <span className={styles.tokenDistTotal}>{formatTokens(totalTokens)}</span>
            <span className={styles.tokenDistLabel}>{t('usage_stats.total_tokens')}</span>
          </div>
          <DoughnutRing option={doughnutOption} height={220} />
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
            timeRange={timeRange}
            onChartPeriodChange={onChartPeriodChange}
          />
        </div>
      </div>
    </div>
  );
}
