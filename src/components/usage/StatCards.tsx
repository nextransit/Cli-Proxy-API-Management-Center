import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatCompactNumber,
  formatUsd,
  calculateCost,
  collectUsageDetails,
  extractLatencyMs,
} from '@/utils/usage';
import type { UsagePayload } from './hooks/useUsageData';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import styles from '@/pages/UsagePage.module.scss';

const IconCount = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 3v18h18" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </svg>
);

const IconToken = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const IconDollar = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

export interface StatCardsProps {
  usage: UsagePayload | null;
  loading?: boolean;
  modelPrices: Record<string, any>;
  requestsChartData?: any;
  requestsChartOptions?: any;
  tokensChartData?: any;
  tokensChartOptions?: any;
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000_000) {
    return (tokens / 1_000_000_000).toFixed(2) + 'B';
  } else if (tokens >= 1_000_000) {
    const inMillions = tokens / 1_000_000;
    return inMillions.toFixed(2) + 'M';
  }
  return formatCompactNumber(tokens);
}

function formatDurationMs(ms: number | null): string {
  if (ms === null || ms === undefined) return '--';
  if (ms >= 1000) return (ms / 1000).toFixed(2) + 's';
  return ms.toFixed(0) + 'ms';
}

const USD_TO_CNY_REFERENCE_RATE = 7.24;

function toSafeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0;
}

function formatCny(value: number): string {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return '¥0.00';
  }
  return `¥${num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function percentOf(value: number, total: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function formatMetricValue(value: string) {
  const match = value.match(/^([^A-Za-z]+)([A-Za-z]+)$/);
  if (!match) {
    return value;
  }
  return (
    <>
      <span>{match[1]}</span>
      <span className={styles.metricUnit}>{match[2]}</span>
    </>
  );
}

export function StatCards({ usage, loading, modelPrices = {} }: StatCardsProps) {
  const { t } = useTranslation();
  const showSkeleton = Boolean(loading && !usage);

  const stats = useMemo(() => {
    if (!usage) {
      return {
        totalRequests: 0,
        successRequests: 0,
        failureRequests: 0,
        avgLatency: null as number | null,
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        totalCost: 0,
        hasPrices: false,
      };
    }
    const details = collectUsageDetails(usage);
    let successRequests = 0;
    let failureRequests = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let reasoningTokens = 0;
    let totalCost = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    const hasPrices = Object.keys(modelPrices).length > 0;

    details.forEach((detail) => {
      if (!detail.failed) successRequests++;
      else failureRequests++;

      const tokens = detail.tokens || {};
      inputTokens += toSafeNumber(tokens.input_tokens);
      outputTokens += toSafeNumber(tokens.output_tokens);
      cachedTokens += Math.max(
        toSafeNumber(tokens.cached_tokens),
        toSafeNumber(tokens.cache_tokens)
      );
      reasoningTokens += toSafeNumber(tokens.reasoning_tokens);
      const latencyMs = extractLatencyMs(detail);
      if (latencyMs !== null) {
        totalLatency += latencyMs;
        latencyCount++;
      }
      if (hasPrices) totalCost += calculateCost(detail, modelPrices);
    });

    return {
      totalRequests: usage.total_requests ?? details.length,
      successRequests,
      failureRequests,
      avgLatency: latencyCount > 0 ? totalLatency / latencyCount : null,
      totalTokens:
        usage.total_tokens ?? inputTokens + outputTokens + cachedTokens + reasoningTokens,
      inputTokens,
      outputTokens,
      cachedTokens,
      reasoningTokens,
      totalCost,
      hasPrices,
    };
  }, [usage, modelPrices]);

  const tokenKnownTotal =
    stats.inputTokens + stats.outputTokens + stats.cachedTokens + stats.reasoningTokens;
  const tokenBarTotal = tokenKnownTotal > 0 ? tokenKnownTotal : stats.totalTokens;
  const cnyReference = stats.totalCost * USD_TO_CNY_REFERENCE_RATE;
  const preciseRequestsTitle = stats.totalRequests.toLocaleString();
  const preciseTokensTitle = stats.totalTokens.toLocaleString();
  const preciseCostTitle = stats.hasPrices
    ? `${formatUsd(stats.totalCost)} · ${formatCny(cnyReference)}`
    : undefined;
  const requestSuccessRate = percentOf(stats.successRequests, stats.totalRequests);

  const skeletonSummary = (
    <>
      <SkeletonBlock width="66%" height={30} />
      <SkeletonBlock width="86%" height={18} />
      <SkeletonBlock width="72%" height={10} />
    </>
  );

  const requestsSummary = (
    <div className={styles.metricSummary} title={preciseRequestsTitle}>
      <span className={styles.metricMainValue}>
        {formatMetricValue(formatCompactNumber(stats.totalRequests))}
      </span>
      <span className={styles.metricSubDetails}>
        <span className={`${styles.dataCapsule} ${styles.dataCapsuleSuccess}`}>
          ✓ {stats.successRequests.toLocaleString()}
        </span>
        <span className={`${styles.dataCapsule} ${styles.dataCapsuleFailure}`}>
          ! {stats.failureRequests.toLocaleString()}
        </span>
      </span>
      <span className={styles.metricSubLine}>
        ⏱ {t('usage_stats.avg_latency_short')}: {formatDurationMs(stats.avgLatency)}
      </span>
      <span
        className={styles.metricMiniProgress}
        title={`${t('usage_stats.success_rate')}: ${requestSuccessRate.toFixed(1)}%`}
      >
        <span
          className={styles.metricMiniProgressSuccess}
          style={{ width: `${requestSuccessRate}%` }}
        />
        <span
          className={styles.metricMiniProgressFailure}
          style={{ width: `${100 - requestSuccessRate}%` }}
        />
      </span>
    </div>
  );

  const tokensSummary = (
    <div className={styles.metricSummary} title={preciseTokensTitle}>
      <span className={styles.metricMainValue}>
        {formatMetricValue(formatTokenCount(stats.totalTokens))}
      </span>
      <span className={styles.metricSubDetails}>
        <span className={`${styles.dataCapsule} ${styles.dataCapsuleInput}`}>
          ↙ {t('usage_stats.input_short')}: {formatTokenCount(stats.inputTokens)}
        </span>
        <span className={`${styles.dataCapsule} ${styles.dataCapsuleOutput}`}>
          ↗ {t('usage_stats.output_short')}: {formatTokenCount(stats.outputTokens)}
        </span>
      </span>
      <span
        className={styles.tokenRatioTrack}
        title={`${t('usage_stats.input_tokens')}: ${stats.inputTokens.toLocaleString()} · ${t('usage_stats.output_tokens')}: ${stats.outputTokens.toLocaleString()}`}
      >
        <span
          className={styles.tokenRatioInput}
          style={{ width: `${percentOf(stats.inputTokens, tokenBarTotal)}%` }}
        />
        <span
          className={styles.tokenRatioOutput}
          style={{ width: `${percentOf(stats.outputTokens, tokenBarTotal)}%` }}
        />
        <span
          className={styles.tokenRatioCached}
          style={{ width: `${percentOf(stats.cachedTokens, tokenBarTotal)}%` }}
        />
        <span
          className={styles.tokenRatioReasoning}
          style={{ width: `${percentOf(stats.reasoningTokens, tokenBarTotal)}%` }}
        />
      </span>
    </div>
  );

  const costSummary = (
    <div className={styles.metricSummary} title={preciseCostTitle}>
      <span className={`${styles.metricMainValue} ${styles.metricCostValue}`}>
        {stats.hasPrices ? formatMetricValue(formatUsd(stats.totalCost)) : '--'}
      </span>
      {stats.hasPrices && (
        <span className={styles.metricSubLine}>
          ≈ {formatCny(cnyReference)} ({t('usage_stats.reference_fx')})
        </span>
      )}
    </div>
  );

  return (
    <div className={styles.statsGrid} aria-busy={showSkeleton || undefined}>
      <section className={styles.metricCard} aria-label={t('usage_stats.total_requests')}>
        <div className={styles.metricCardHeader}>
          <span className={styles.metricCardIcon}>
            <IconCount />
          </span>
          <span className={styles.metricCardTitle}>{t('usage_stats.total_requests')}</span>
        </div>
        <div className={styles.metricCardBody}>
          {showSkeleton ? skeletonSummary : requestsSummary}
        </div>
      </section>

      <section className={styles.metricCard} aria-label={t('usage_stats.total_tokens')}>
        <div className={styles.metricCardHeader}>
          <span className={styles.metricCardIcon}>
            <IconToken />
          </span>
          <span className={styles.metricCardTitle}>{t('usage_stats.total_tokens')}</span>
        </div>
        <div className={styles.metricCardBody}>
          {showSkeleton ? skeletonSummary : tokensSummary}
        </div>
      </section>

      <section className={styles.metricCard} aria-label={t('usage_stats.total_cost')}>
        <div className={styles.metricCardHeader}>
          <span className={styles.metricCardIcon}>
            <IconDollar />
          </span>
          <span className={styles.metricCardTitle}>{t('usage_stats.total_cost')}</span>
        </div>
        <div className={styles.metricCardBody}>{showSkeleton ? skeletonSummary : costSummary}</div>
      </section>
    </div>
  );
}
