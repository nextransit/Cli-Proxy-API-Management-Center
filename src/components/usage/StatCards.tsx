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
import type { ModelPrice } from '@/utils/usage';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import styles from '@/pages/UsagePage.module.scss';


export interface StatCardsProps {
  usage: UsagePayload | null;
  loading?: boolean;
  modelPrices: Record<string, ModelPrice>;
  requestsChartData?: unknown;
  requestsChartOptions?: unknown;
  tokensChartData?: unknown;
  tokensChartOptions?: unknown;
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
    return '¥0.000';
  }
  return `¥${num.toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
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
        totalCost: null as number | null,
        hasPrices: false,
        detailsComplete: false,
        outcomesComplete: false,
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
      // Failed requests must never contribute to token totals, latency
      // averages, or cost rollups.
      if (detail.failed) return;

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

    // Prefer the backend-supplied success-only counters; fall back to the
    // filtered detail scan when those fields are absent.
    const backendSuccess = toSafeNumber(usage.success_count);
    const backendFailure = toSafeNumber(usage.failure_count);
    const backendTotal = toSafeNumber(usage.total_requests);
    const useBackendCounters =
      backendSuccess > 0 || backendFailure > 0 || backendTotal > 0;
    const totalRequests = useBackendCounters
      ? Math.max(backendSuccess + backendFailure, backendTotal, successRequests)
      : successRequests;
    const resolvedSuccessRequests = useBackendCounters ? backendSuccess : successRequests;
    const resolvedFailureRequests = useBackendCounters ? backendFailure : failureRequests;
    const resolvedTotalTokens =
      usage.total_tokens ?? inputTokens + outputTokens + cachedTokens + reasoningTokens;
    const detailsComplete = details.length >= totalRequests;
    const outcomesComplete =
      totalRequests === 0 || resolvedSuccessRequests + resolvedFailureRequests >= totalRequests;

    return {
      totalRequests,
      successRequests: resolvedSuccessRequests,
      failureRequests: resolvedFailureRequests,
      avgLatency: detailsComplete && latencyCount > 0 ? totalLatency / latencyCount : null,
      totalTokens: resolvedTotalTokens,
      inputTokens,
      outputTokens,
      cachedTokens,
      reasoningTokens,
      totalCost: detailsComplete ? totalCost : null,
      hasPrices,
      detailsComplete,
      outcomesComplete,
    };
  }, [usage, modelPrices]);

  const tokenKnownTotal =
    stats.inputTokens + stats.outputTokens + stats.cachedTokens + stats.reasoningTokens;
  const tokenBarTotal = tokenKnownTotal > 0 ? tokenKnownTotal : stats.totalTokens;
  const cnyReference = (stats.totalCost ?? 0) * USD_TO_CNY_REFERENCE_RATE;
  const preciseRequestsTitle = stats.totalRequests.toLocaleString();
  const preciseTokensTitle = stats.totalTokens.toLocaleString();
  const preciseCostTitle =
    stats.hasPrices && stats.totalCost !== null
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

  const successPrimaryTitle =
    stats.outcomesComplete && stats.successRequests > 0
      ? stats.successRequests.toLocaleString()
      : preciseRequestsTitle;
  const failureSecondaryTitle =
    stats.outcomesComplete && stats.failureRequests > 0
      ? stats.failureRequests.toLocaleString()
      : '';
  const requestsFooterTitle =
    `${t('usage_stats.total_label', '总计')} ${stats.totalRequests.toLocaleString()}` +
    ` / ${t('usage_stats.failure_short', '失败')} ${stats.failureRequests.toLocaleString()}` +
    (stats.avgLatency !== null
      ? ` · ⏱ ${formatDurationMs(stats.avgLatency)}`
      : '');
  const requestsSummary = (
    <div className={styles.metricSummaryStack} title={successPrimaryTitle}>
      <div
        className={`${styles.metricMainValue} ${styles.primarySuccess}`}
        title={successPrimaryTitle}
      >
        {stats.outcomesComplete && stats.successRequests > 0
          ? stats.successRequests.toLocaleString()
          : stats.totalRequests.toLocaleString()}
      </div>
      <div className={styles.metricSubLine} title={requestsFooterTitle}>
        <span className={styles.metricSubMuted}>
          {t('usage_stats.total_label', '总计')} {stats.totalRequests.toLocaleString()}
        </span>
        <span className={styles.subSep}>/</span>
        <span className={styles.failText} title={failureSecondaryTitle}>
          {t('usage_stats.failure_short', '失败')} {stats.failureRequests.toLocaleString()}
        </span>
      </div>
    </div>
  );

  const tokensPrimary = formatMetricValue(formatTokenCount(stats.totalTokens));
  const tokensSummary = (
    <div className={styles.metricSummaryStack} title={preciseTokensTitle}>
      <div className={styles.metricMainValue} title={preciseTokensTitle}>
        {tokensPrimary}
      </div>
      <div className={styles.metricSubLine}>
        <span className={styles.metricSubMuted}>
          {t('usage_stats.tokens_input_caption', '输入')}{' '}
          {stats.detailsComplete ? formatTokenCount(stats.inputTokens) : '--'}
        </span>
        <span className={styles.subSep}>/</span>
        <span className={styles.metricSubMuted}>
          {t('usage_stats.tokens_output_caption', '输出')}{' '}
          {stats.detailsComplete ? formatTokenCount(stats.outputTokens) : '--'}
        </span>
      </div>
    </div>
  );

  const costPrimary =
    stats.hasPrices && stats.totalCost !== null
      ? formatUsd(stats.totalCost)
      : '--';
  const costSummary = (
    <div className={styles.metricSummaryStack} title={preciseCostTitle}>
      <div
        className={`${styles.metricMainValue} ${styles.metricCostValue}`}
        title={preciseCostTitle}
      >
        {formatMetricValue(costPrimary)}
      </div>
      <div className={styles.metricSubLine}>
        <span className={styles.metricSubMuted}>
          {stats.hasPrices && stats.totalCost !== null
            ? `≈ ${formatCny(cnyReference)} · ${t('usage_stats.reference_fx')}`
            : t('usage_stats.no_price_data', '尚未配置模型单价')}
        </span>
      </div>
    </div>
  );

  return (
    <div className={styles.statsGrid} aria-busy={showSkeleton || undefined}>
      <section
        className={`${styles.metricCard} ${styles.metricCardLifetime}`}
        aria-label={t('usage_stats.total_success_requests', '总成功请求')}
        data-accent="requests"
      >
        <div className={styles.metricCardHeader}>
          <span className={styles.metricCardTitle}>
            {t('usage_stats.total_success_requests', '总成功请求')}
          </span>
          {stats.outcomesComplete && (
            <span
              className={styles.successRateBadge}
              title={`${t('usage_stats.success_rate', '成功率')}: ${requestSuccessRate.toFixed(1)}%`}
            >
              {requestSuccessRate.toFixed(1)}% {t('usage_stats.success_rate_badge', '成功率')}
            </span>
          )}
        </div>
        <div className={styles.metricCardBody}>
          {showSkeleton ? skeletonSummary : requestsSummary}
        </div>
      </section>

      <section
        className={`${styles.metricCard} ${styles.metricCardLifetime}`}
        aria-label={t('usage_stats.total_tokens')}
        data-accent="tokens"
      >
        <div className={styles.metricCardHeader}>
          <span className={styles.metricCardTitle}>{t('usage_stats.total_tokens')}</span>
          <span
            className={styles.cacheHitRate}
            title={t('usage_stats.cache_hit_rate_tooltip')}
          >
            ⚡{' '}
            {stats.detailsComplete && tokenBarTotal > 0
              ? `${((stats.cachedTokens / tokenBarTotal) * 100).toFixed(1)}%`
              : '--'}
          </span>
        </div>
        <div className={styles.metricCardBody}>
          {showSkeleton ? skeletonSummary : tokensSummary}
        </div>
      </section>

      <section
        className={`${styles.metricCard} ${styles.metricCardLifetime}`}
        aria-label={t('usage_stats.total_cost')}
        data-accent="cost"
      >
        <div className={styles.metricCardHeader}>
          <span className={styles.metricCardTitle}>{t('usage_stats.total_cost')}</span>
        </div>
        <div className={styles.metricCardBody}>{showSkeleton ? skeletonSummary : costSummary}</div>
      </section>
    </div>
  );
}
