import { useThemeStore } from '@/stores';
import { useMemo, type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Line } from 'react-chartjs-2';
import {
  IconDiamond,
  IconDollarSign,
  IconSatellite,
  IconTimer,
  IconTrendingUp,
} from '@/components/ui/icons';
import {
  LATENCY_SOURCE_FIELD,
  calculateLatencyStatsFromDetails,
  calculateCost,
  formatCompactNumber,
  formatDurationMs,
  formatPerMinuteValue,
  formatUsd,
  collectUsageDetails,
  extractTotalTokens,
  type ModelPrice,
} from '@/utils/usage';
import { sparklineOptions } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import type { SparklineBundle } from './hooks/useSparklines';
import styles from '@/pages/UsagePage.module.scss';

interface StatCardData {
  key: string;
  label: string;
  icon: ReactNode;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  value: string;
  valueForAnimation?: number;
  valueFormatter?: (value: number) => string;
  meta?: ReactNode;
  trend: SparklineBundle | null;
}

export interface StatCardsProps {
  usage: UsagePayload | null;
  loading: boolean;
  modelPrices: Record<string, ModelPrice>;
  nowMs: number;
  sparklines: {
    requests: SparklineBundle | null;
    tokens: SparklineBundle | null;
    rpm: SparklineBundle | null;
    tpm: SparklineBundle | null;
    cost: SparklineBundle | null;
  };
}

interface CountUpProps {
  value: number;
  formatter: (value: number) => string;
  durationMs?: number;
}

function CountUpValue({ value, formatter, durationMs = 850 }: CountUpProps) {
  const previousValueRef = useRef(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const start = previousValueRef.current;
    const end = value;
    previousValueRef.current = value;

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      setDisplay(end);
      return;
    }

    if (Math.abs(end - start) < 1) {
      setDisplay(end);
      return;
    }

    const startAt = performance.now();
    let rafId = 0;

    const tick = (timestamp: number) => {
      const elapsed = timestamp - startAt;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = start + (end - start) * eased;
      setDisplay(next);

      if (progress < 1) {
        rafId = requestAnimationFrame(tick);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [durationMs, value]);

  return <>{formatter(display)}</>;
}


function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000_000) {
    return (tokens / 1_000_000_000).toFixed(2) + 'B';
  } else if (tokens >= 1_000_000) {
    const inMillions = tokens / 1_000_000;
    if (inMillions >= 1000) {
      return (tokens / 1_000_000_000).toFixed(2) + 'B';
    }
    return inMillions.toFixed(2) + 'M';
  }
  return formatCompactNumber(tokens);
}

export function StatCards({ usage, loading, modelPrices, nowMs, sparklines }: StatCardsProps) {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';
  const { t } = useTranslation();
  const latencyHint = t('usage_stats.latency_unit_hint', {
    field: LATENCY_SOURCE_FIELD,
    unit: t('usage_stats.duration_unit_ms'),
  });

  const hasPrices = Object.keys(modelPrices).length > 0;

  const { tokenBreakdown, rateStats, totalCost, latencyStats } = useMemo(() => {
    const empty = {
      tokenBreakdown: { cachedTokens: 0, reasoningTokens: 0 },
      rateStats: { rpm: 0, tpm: 0, windowMinutes: 30, requestCount: 0, tokenCount: 0 },
      totalCost: 0,
      latencyStats: {
        averageMs: null as number | null,
        totalMs: null as number | null,
        sampleCount: 0,
      },
    };

    if (!usage) return empty;
    const details = collectUsageDetails(usage);
    if (!details.length) return empty;

    const latencyStats = calculateLatencyStatsFromDetails(details);

    let cachedTokens = 0;
    let reasoningTokens = 0;
    let totalCost = 0;

    const now = nowMs;
    const windowMinutes = 30;
    const windowStart = now - windowMinutes * 60 * 1000;
    let requestCount = 0;
    let tokenCount = 0;
    const hasValidNow = Number.isFinite(now) && now > 0;

    details.forEach((detail) => {
      const tokens = detail.tokens;
      cachedTokens += Math.max(
        typeof tokens.cached_tokens === 'number' ? Math.max(tokens.cached_tokens, 0) : 0,
        typeof tokens.cache_tokens === 'number' ? Math.max(tokens.cache_tokens, 0) : 0
      );
      if (typeof tokens.reasoning_tokens === 'number') {
        reasoningTokens += tokens.reasoning_tokens;
      }

      const timestamp = detail.__timestampMs ?? 0;
      if (
        hasValidNow &&
        Number.isFinite(timestamp) &&
        timestamp >= windowStart &&
        timestamp <= now
      ) {
        requestCount += 1;
        tokenCount += extractTotalTokens(detail);
      }

      if (hasPrices) {
        totalCost += calculateCost(detail, modelPrices);
      }
    });

    const denominator = windowMinutes > 0 ? windowMinutes : 1;
    return {
      tokenBreakdown: { cachedTokens, reasoningTokens },
      rateStats: {
        rpm: requestCount / denominator,
        tpm: tokenCount / denominator,
        windowMinutes,
        requestCount,
        tokenCount,
      },
      totalCost,
      latencyStats,
    };
  }, [hasPrices, modelPrices, nowMs, usage]);

  const baseAccent = '#06b6d4';
  const baseAccentSoft = 'rgba(6, 182, 212, 0.13)';
  const baseAccentBorder = 'rgba(6, 182, 212, 0.4)';

  const statsCards: StatCardData[] = [
    {
      key: 'requests',
      label: t('usage_stats.total_requests'),
      icon: <IconSatellite size={16} />,
      accent: baseAccent,
      accentSoft: baseAccentSoft,
      accentBorder: baseAccentBorder,
      value: (usage?.total_requests ?? 0).toLocaleString(),
      valueForAnimation: usage?.total_requests ?? 0,
      valueFormatter: (num) => Math.round(num).toLocaleString(),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#3fb28f' }} />
            {t('usage_stats.success_requests')}: {(usage?.success_count ?? 0)}
          </span>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#cd6f63' }} />
            {t('usage_stats.failed_requests')}: {(usage?.failure_count ?? 0)}
          </span>
          {latencyStats.sampleCount > 0 && (
            <span className={styles.statMetaItem} title={latencyHint}>
              {t('usage_stats.avg_time')}:{' '}
              {formatDurationMs(latencyStats.averageMs)}
            </span>
          )}
        </>
      ),
      trend: sparklines.requests,
    },
    {
      key: 'tokens',
      label: t('usage_stats.total_tokens'),
      icon: <IconDiamond size={16} />,
      accent: baseAccent,
      accentSoft: baseAccentSoft,
      accentBorder: baseAccentBorder,
      value: formatTokenCount(usage?.total_tokens ?? 0),
      valueForAnimation: usage?.total_tokens ?? 0,
      valueFormatter: (num) => formatTokenCount(Math.max(0, Math.round(num))),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.cached_tokens')}:{' '}
            {formatTokenCount(tokenBreakdown.cachedTokens)}
          </span>
          <span className={styles.statMetaItem}>
            {t('usage_stats.reasoning_tokens')}:{' '}
            {formatTokenCount(tokenBreakdown.reasoningTokens)}
          </span>
        </>
      ),
      trend: sparklines.tokens,
    },
    {
      key: 'rpm',
      label: t('usage_stats.rpm_30m'),
      icon: <IconTimer size={16} />,
      accent: baseAccent,
      accentSoft: baseAccentSoft,
      accentBorder: baseAccentBorder,
      value: formatPerMinuteValue(rateStats.rpm),
      valueForAnimation: rateStats.rpm,
      valueFormatter: (num) => formatPerMinuteValue(num),
      meta: (
        <span className={styles.statMetaItem}>
          {t('usage_stats.total_requests')}:{' '}
          {rateStats.requestCount.toLocaleString()}
        </span>
      ),
      trend: sparklines.rpm,
    },
    {
      key: 'tpm',
      label: t('usage_stats.tpm_30m'),
      icon: <IconTrendingUp size={16} />,
      accent: baseAccent,
      accentSoft: baseAccentSoft,
      accentBorder: baseAccentBorder,
      value: formatPerMinuteValue(rateStats.tpm),
      valueForAnimation: rateStats.tpm,
      valueFormatter: (num) => formatPerMinuteValue(num),
      meta: (
        <span className={styles.statMetaItem}>
          {t('usage_stats.total_tokens')}:{' '}
          {formatTokenCount(rateStats.tokenCount)}
        </span>
      ),
      trend: sparklines.tpm,
    },
    {
      key: 'cost',
      label: t('usage_stats.total_cost'),
      icon: <IconDollarSign size={16} />,
      accent: baseAccent,
      accentSoft: baseAccentSoft,
      accentBorder: baseAccentBorder,
      value: hasPrices ? formatUsd(totalCost) : '--',
      valueForAnimation: hasPrices ? totalCost : undefined,
      valueFormatter: (num) => formatUsd(Math.max(0, num)),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.total_tokens')}:{' '}
            {formatCompactNumber(usage?.total_tokens ?? 0)}
          </span>
          {!hasPrices && (
            <span className={`${styles.statMetaItem} ${styles.statSubtle}`}>
              {t('usage_stats.cost_need_price')}
            </span>
          )}
        </>
      ),
      trend: hasPrices ? sparklines.cost : null,
    },
  ];

  return (
    <div className={styles.statsGrid}>
      {statsCards.map((card) => (
        <div
          key={card.key}
          className={styles.statCard}
          style={
            {
              '--accent': card.accent,
              '--accent-soft': card.accentSoft,
              '--accent-border': card.accentBorder,
            } as CSSProperties
          }
        >
          <div className={styles.statCardHeader}>
            <div className={styles.statLabelGroup}>
              <span className={styles.statLabel}>{card.label}</span>
            </div>
            <span className={styles.statIconBadge}>{card.icon}</span>
          </div>

          <div className={styles.statValue}>
            {loading || card.valueForAnimation === undefined || !card.valueFormatter ? (
              card.value
            ) : (
              <CountUpValue value={card.valueForAnimation} formatter={card.valueFormatter} />
            )}
          </div>

          {card.meta && <div className={styles.statMetaRow}>{card.meta}</div>}

          <div className={styles.statTrend}>
            {card.trend ? (
              <Line
                data={card.trend.data}
                options={{
                  ...sparklineOptions,
                  plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false },
                  },
                  animation: { duration: 0 },
                  elements: {
                    line: { ...(sparklineOptions.elements?.line || {}), borderColor: card.accent },
                    point: { ...(sparklineOptions.elements?.point || {}), radius: 0 },
                  },
                }}
                className={`${styles.sparkline} ${isDark ? '' : 'sparkline-light'}`}
              />
            ) : (
              <div className={styles.statTrendPlaceholder} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
