import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import * as echarts from 'echarts';
import {
  formatUsd,
  type ModelStatsSummary,
  type ModelPrice,
  type UsageTimeRange,
} from '@/utils/usage';
import { useThemeStore } from '@/stores';
import { useEChartsResize } from '@/hooks/useEChartsResize';
import { registerCliThemes } from '@/utils/echarts/registerThemes';
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
  { base: '#4f46e5', light: '#6366f1' },
  { base: '#3b82f6', light: '#60a5fa' },
  { base: '#06b6d4', light: '#22d3ee' },
  { base: '#10b981', light: '#34d399' },
  { base: '#f59e0b', light: '#fbbf24' },
  { base: '#cbd5e1', light: '#e2e8f0' },
  { base: '#a78bfa', light: '#c4b5fd' },
];

const MAX_SEGMENTS = 7;

function formatTokens(num: number): string {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toLocaleString();
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
  scopedUsage: _scopedUsage,
  chartPeriod: _chartPeriod,
  hourWindowHours: _hourWindowHours,
  modelPrices: _modelPrices,
  timeRange: _timeRange,
  onChartPeriodChange: _onChartPeriodChange,
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
          radius: ['68%', '85%'],
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderColor: ringBorder,
            borderWidth: 2,
            borderRadius: 4,
          },
          label: { show: false },
          labelLine: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 4,
            itemStyle: {
              borderWidth: 3,
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
      </div>
    </div>
  );
}
