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
  onHover?: (label: string | null) => void;
  onLeave?: () => void;
  onClick?: (label: string | null) => void;
}

function DoughnutRing({ option, height, className, onHover, onLeave, onClick }: DoughnutRingProps) {
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

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const mouseover = (params: { name?: string }) => onHover?.(params.name ?? null);
    const mouseout = () => onLeave?.();
    const click = (params: { name?: string }) => onClick?.(params.name ?? null);
    instance.on('mouseover', 'series', mouseover);
    instance.on('mouseout', 'series', mouseout);
    instance.on('click', 'series', click);
    return () => {
      instance.off('mouseover', mouseover);
      instance.off('mouseout', mouseout);
      instance.off('click', click);
    };
  }, [onHover, onLeave, onClick]);

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

const TOP_N_OPTIONS = [5, 8, 12] as const;
type TopN = typeof TOP_N_OPTIONS[number];
const DEFAULT_TOP_N: TopN = 8;

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
  const [topN, setTopN] = useState<TopN>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_TOP_N;
    const stored = Number.parseInt(localStorage.getItem('usage.tokenDist.topN') ?? '', 10);
    return (TOP_N_OPTIONS as readonly number[]).includes(stored) ? (stored as TopN) : DEFAULT_TOP_N;
  });
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [showOthersDrawer, setShowOthersDrawer] = useState(false);
  const isCollapsed = !expanded;

  const handleTopNChange = useCallback((next: TopN) => {
    setTopN(next);
    try {
      localStorage.setItem('usage.tokenDist.topN', String(next));
    } catch {
      // Ignore storage errors.
    }
  }, []);

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

  const { doughnutOption, totalTokens, segments, others } = useMemo(() => {
    const sorted = [...modelStats].sort((a, b) => b.tokens - a.tokens);
    const top = sorted.slice(0, topN);
    const tail = sorted.slice(topN);
    const otherTokens = tail.reduce((sum, s) => sum + s.tokens, 0);

    const segmentList: {
      label: string;
      tokens: number;
      cost: number;
      color: GradientColor;
    }[] = [];
    top.forEach((s, i) => {
      segmentList.push({
        label: s.model,
        tokens: s.tokens,
        cost: s.cost,
        color: DOUGHNUT_COLORS[i % DOUGHNUT_COLORS.length],
      });
    });
    if (otherTokens > 0) {
      segmentList.push({
        label: t('usage_stats.others'),
        tokens: otherTokens,
        cost: 0,
        color: { base: '#64748b', light: '#94a3b8' },
      });
    }

    const total = segmentList.reduce((sum, s) => sum + s.tokens, 0);

    const ringBorder = isDark ? '#0f172a' : '#ffffff';
    const textColor = isDark ? '#f8fafc' : '#111827';
    const tooltipBg = isDark ? 'rgba(15,23,42,0.94)' : 'rgba(255,255,255,0.98)';
    const tooltipBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(17,24,39,0.1)';

    const data = segmentList.map((s) => ({
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
          const seg = segmentList[idx];
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

    return { doughnutOption: option, totalTokens: total, segments: segmentList, others: tail };
  }, [modelStats, isDark, hasPrices, t, topN]);

  // Resolve the currently hovered (or selected) segment, falling back to the total.
  const focusedSegment = useMemo(() => {
    if (!hoveredLabel) return null;
    return segments.find((s) => s.label === hoveredLabel) ?? null;
  }, [hoveredLabel, segments]);

  const centerTokens = focusedSegment ? focusedSegment.tokens : totalTokens;
  const centerLabel = focusedSegment ? focusedSegment.label : t('usage_stats.total_tokens');
  const centerPercent = focusedSegment && totalTokens > 0
    ? ((focusedSegment.tokens / totalTokens) * 100).toFixed(1) + '%'
    : null;

  const handleLegendHover = useCallback((label: string | null) => setHoveredLabel(label), []);
  const handleLegendLeave = useCallback(() => setHoveredLabel(null), []);
  const handleLegendClick = useCallback((label: string | null) => {
    if (!label) {
      setSelectedModel(null);
      return;
    }
    if (label === t('usage_stats.others')) {
      setShowOthersDrawer(true);
      return;
    }
    setSelectedModel((current) => (current === label ? null : label));
  }, [t]);

  const renderDrilldown = () => {
    if (!selectedModel) return null;
    const seg = segments.find((s) => s.label === selectedModel);
    if (!seg) return null;
    const stat = modelStats.find((s) => s.model === selectedModel);
    if (!stat) return null;
    const inputTokens = stat.inputTokens ?? 0;
    const outputTokens = stat.outputTokens ?? 0;
    const reasoningTokens = stat.reasoningTokens ?? 0;
    const cachedTokens = stat.cachedTokens ?? 0;
    const denom = inputTokens + outputTokens + reasoningTokens + cachedTokens || 1;
    const rows = [
      { label: t('usage_stats.input_tokens'), value: inputTokens, color: '#00E5FF' },
      { label: t('usage_stats.output_tokens'), value: outputTokens, color: '#22c55e' },
      { label: t('usage_stats.reasoning_short'), value: reasoningTokens, color: '#a78bfa' },
      { label: t('usage_stats.cached_short'), value: cachedTokens, color: '#7C4DFF' },
    ];
    return (
      <div className={styles.tokenDistDetail} role="dialog" aria-label={selectedModel}>
        <div className={styles.tokenDistDetailHeader}>
          <span className={styles.tokenDistDetailTitle}>{selectedModel}</span>
          <button
            type="button"
            className={styles.tokenDistDetailClose}
            onClick={() => setSelectedModel(null)}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>
        <div className={styles.tokenDistDetailRows}>
          {rows.map((row) => (
            <div key={row.label} className={styles.tokenDistDetailRow}>
              <span
                className={styles.tokenDistDetailDot}
                style={{ background: row.color }}
              />
              <span className={styles.tokenDistDetailLabel}>{row.label}</span>
              <span className={styles.tokenDistDetailValue}>{formatTokens(row.value)}</span>
              <span className={styles.tokenDistDetailPercent}>
                {((row.value / denom) * 100).toFixed(1)}%
              </span>
              <span className={styles.tokenDistDetailTrack}>
                <span
                  className={styles.tokenDistDetailProgress}
                  style={{ width: `${(row.value / denom) * 100}%`, background: row.color }}
                />
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderOthersDrawer = () => {
    if (!showOthersDrawer || others.length === 0) return null;
    return (
      <div className={styles.tokenDistDetail} role="dialog" aria-label={t('usage_stats.others')}>
        <div className={styles.tokenDistDetailHeader}>
          <span className={styles.tokenDistDetailTitle}>{t('usage_stats.others')}</span>
          <button
            type="button"
            className={styles.tokenDistDetailClose}
            onClick={() => setShowOthersDrawer(false)}
            aria-label={t('common.close')}
          >
            ×
          </button>
        </div>
        <div className={styles.tokenDistDetailRows}>
          {others.map((s) => (
            <div key={s.model} className={styles.tokenDistDetailRow}>
              <span className={styles.tokenDistDetailLabel} title={s.model}>{s.model}</span>
              <span className={styles.tokenDistDetailValue}>{formatTokens(s.tokens)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

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
        <div
          className={styles.tokenDistTopNControl}
          onClick={(event) => event.stopPropagation()}
        >
          <label className={styles.tokenDistTopNLabel}>{t('usage_stats.top_n')}</label>
          <select
            className={styles.tokenDistTopNSelect}
            value={topN}
            onChange={(event) => handleTopNChange(Number.parseInt(event.target.value, 10) as TopN)}
            aria-label={t('usage_stats.top_n')}
          >
            {TOP_N_OPTIONS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={bodyClass}>
        <div className={styles.tokenDistChart}>
          <div className={styles.tokenDistCenter}>
            <span className={styles.tokenDistTotal}>{formatTokens(centerTokens)}</span>
            <span className={styles.tokenDistLabel}>
              {centerLabel}
              {centerPercent ? ` · ${centerPercent}` : ''}
            </span>
          </div>
          <DoughnutRing
            option={doughnutOption}
            height={220}
            onHover={handleLegendHover}
            onLeave={handleLegendLeave}
            onClick={handleLegendClick}
          />
        </div>

        <div className={styles.tokenDistGrid}>
          {segments.map((seg) => {
            const pct = totalTokens > 0 ? (seg.tokens / totalTokens) * 100 : 0;
            const isHovered = hoveredLabel === seg.label;
            const isSelected = selectedModel === seg.label;
            const dimmed = hoveredLabel !== null && !isHovered;
            const isOthers = seg.label === t('usage_stats.others');
            return (
              <div
                key={seg.label}
                className={[
                  styles.tokenDistItem,
                  isHovered ? styles.tokenDistItemHovered : '',
                  isSelected ? styles.tokenDistItemSelected : '',
                  dimmed ? styles.tokenDistItemDimmed : '',
                ].filter(Boolean).join(' ')}
                onMouseEnter={() => handleLegendHover(seg.label)}
                onMouseLeave={handleLegendLeave}
                onClick={() => handleLegendClick(seg.label)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleLegendClick(seg.label);
                  }
                }}
              >
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
                {isOthers && others.length > 0 ? (
                  <div className={styles.tokenDistItemHint}>
                    {t('usage_stats.click_to_view_long_tail', { count: others.length })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        {renderDrilldown()}
        {renderOthersDrawer()}
      </div>
    </div>
  );
}
