import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatCompactNumber,
  formatUsd,
  collectUsageDetails,
  extractTotalTokens,
  calculateCost,
} from '@/utils/usage';
import type { UsagePayload } from './hooks/useUsageData';
import type { ModelPrice } from '@/utils/usage';
import { Skeleton, SkeletonBlock } from '@/components/ui/Skeleton';
import styles from '@/pages/UsagePage.module.scss';

interface SummaryCardsProps {
  usage: UsagePayload | null;
  loading?: boolean;
  modelPrices: Record<string, ModelPrice>;
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

type TrendDirection = 'up' | 'down' | 'flat';

interface SummaryTrend {
  label: string;
  direction: TrendDirection;
}

interface PeriodStats {
  cost: number;
  tokens: number;
  requests: number;
  successRequests: number;
  failureRequests: number;
  totalRequests: number;
  detailRequests: number;
}

const EMPTY_PERIOD_STATS: PeriodStats = {
  cost: 0,
  tokens: 0,
  requests: 0,
  successRequests: 0,
  failureRequests: 0,
  totalRequests: 0,
  detailRequests: 0,
};

const formatLocalDateKey = (timestampMs: number): string => {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDailyAggregate = (
  usage: UsagePayload,
  field: 'requests_by_day' | 'tokens_by_day',
  dayKey: string
): number | null => {
  const rawMap = usage[field];
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return null;
  }
  const value = Number((rawMap as Record<string, unknown>)[dayKey]);
  return Number.isFinite(value) ? Math.max(value, 0) : null;
};

const buildTrend = (current: number, previous: number, compareLabel: string): SummaryTrend => {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) {
    return { label: `-- ${compareLabel}`, direction: 'flat' };
  }

  const percent = ((current - previous) / previous) * 100;
  const direction: TrendDirection = percent > 0 ? 'up' : percent < 0 ? 'down' : 'flat';
  const prefix = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
  return { label: `${prefix} ${Math.abs(percent).toFixed(1)}% ${compareLabel}`, direction };
};

const getTrendClassName = (direction: TrendDirection): string => {
  if (direction === 'up') return styles.summaryCardTrendUp;
  if (direction === 'down') return styles.summaryCardTrendDown;
  return styles.summaryCardTrendFlat;
};

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

export function SummaryCards({ usage, loading, modelPrices }: SummaryCardsProps) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    if (!usage) {
      return {
        today: EMPTY_PERIOD_STATS,
        yesterday: EMPTY_PERIOD_STATS,
        month: EMPTY_PERIOD_STATS,
        previousMonth: EMPTY_PERIOD_STATS,
      };
    }

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0
    ).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
    const previousMonthStart = new Date(
      now.getFullYear(),
      now.getMonth() - 1,
      1,
      0,
      0,
      0,
      0
    ).getTime();

    const today: PeriodStats = { ...EMPTY_PERIOD_STATS };
    const yesterday: PeriodStats = { ...EMPTY_PERIOD_STATS };
    const month: PeriodStats = { ...EMPTY_PERIOD_STATS };
    const previousMonth: PeriodStats = { ...EMPTY_PERIOD_STATS };

    const details = collectUsageDetails(usage);

    for (const detail of details) {
      const timestampMs = detail.__timestampMs || 0;
      if (timestampMs === 0) continue;

      const totalTokens = extractTotalTokens(detail);
      const cost = calculateCost(detail, modelPrices);

      if (timestampMs >= todayStart) {
        today.cost += cost;
        today.tokens += totalTokens;
        today.requests += 1;
        today.detailRequests += 1;
      } else if (timestampMs >= yesterdayStart && timestampMs < todayStart) {
        yesterday.cost += cost;
        yesterday.tokens += totalTokens;
        yesterday.requests += 1;
        yesterday.detailRequests += 1;
      }

      if (timestampMs >= monthStart) {
        month.cost += cost;
        month.tokens += totalTokens;
        month.requests += 1;
        month.successRequests += 1;
        month.totalRequests += 1;
        month.detailRequests += 1;
      } else if (timestampMs >= previousMonthStart && timestampMs < monthStart) {
        previousMonth.cost += cost;
        previousMonth.tokens += totalTokens;
        previousMonth.requests += 1;
        previousMonth.successRequests += 1;
        previousMonth.totalRequests += 1;
        previousMonth.detailRequests += 1;
      }
    }

    const todayKey = formatLocalDateKey(todayStart);
    const yesterdayKey = formatLocalDateKey(yesterdayStart);
    today.requests = getDailyAggregate(usage, 'requests_by_day', todayKey) ?? today.requests;
    today.tokens = getDailyAggregate(usage, 'tokens_by_day', todayKey) ?? today.tokens;
    yesterday.requests =
      getDailyAggregate(usage, 'requests_by_day', yesterdayKey) ?? yesterday.requests;
    yesterday.tokens = getDailyAggregate(usage, 'tokens_by_day', yesterdayKey) ?? yesterday.tokens;

    // Best-effort daily success/total aggregation. Falls back to treating
    // the day total as success-only when the backend does not expose
    // outcome breakdown by day.
    const aggregateOutcome = (usage as unknown as {
      success_count_by_day?: Record<string, number>;
    }).success_count_by_day;
    const aggregateFailure = (usage as unknown as {
      failure_count_by_day?: Record<string, number>;
    }).failure_count_by_day;
    const aggregateTotalReq = (usage as unknown as {
      total_requests_by_day?: Record<string, number>;
    }).total_requests_by_day;
    if (aggregateOutcome) {
      today.successRequests = Math.max(0, Number(aggregateOutcome[todayKey]) || 0);
      yesterday.successRequests = Math.max(0, Number(aggregateOutcome[yesterdayKey]) || 0);
    } else {
      today.successRequests = today.requests;
      yesterday.successRequests = yesterday.requests;
    }
    if (aggregateFailure) {
      today.failureRequests = Math.max(0, Number(aggregateFailure[todayKey]) || 0);
      yesterday.failureRequests = Math.max(0, Number(aggregateFailure[yesterdayKey]) || 0);
    } else {
      today.failureRequests = 0;
      yesterday.failureRequests = 0;
    }
    if (aggregateTotalReq) {
      today.totalRequests = Math.max(0, Number(aggregateTotalReq[todayKey]) || 0);
      yesterday.totalRequests = Math.max(0, Number(aggregateTotalReq[yesterdayKey]) || 0);
    } else {
      today.totalRequests = today.successRequests + today.failureRequests;
      yesterday.totalRequests = yesterday.successRequests + yesterday.failureRequests;
    }

    return { today, yesterday, month, previousMonth };
  }, [usage, modelPrices]);

  if (loading) {
    return (
      <div className={styles.statsGrid} aria-busy="true">
        {[1, 2, 3].map((i) => (
          <section key={i} className={styles.metricCard} aria-hidden="true">
            <div className={styles.metricCardHeader}>
              <span className={styles.metricCardIcon}>
                <Skeleton width={20} height={20} borderRadius={4} />
              </span>
              <span className={styles.metricCardTitle}>
                <SkeletonBlock width={80} height={12} />
              </span>
            </div>
            <div className={styles.metricCardBody}>
              <SkeletonBlock width={120} height={20} />
            </div>
          </section>
        ))}
      </div>
    );
  }

  const compareYesterday = t('usage_stats.vs_yesterday', 'vs 昨日');
  const todayCostComplete = stats.today.detailRequests >= stats.today.requests;
  const yesterdayCostComplete = stats.yesterday.detailRequests >= stats.yesterday.requests;

  const todaySuccessRateText =
    stats.today.totalRequests > 0
      ? ((stats.today.successRequests / stats.today.totalRequests) * 100).toFixed(1) + '%'
      : null;
  const cards = [
    {
      key: 'todayRequests',
      label: t('usage_stats.today_success_requests', '今日成功请求'),
      num: stats.today.successRequests.toLocaleString(),
      icon: <IconCount />,
      accent: '#10b981',
      accentKey: 'requests',
      successRate: todaySuccessRateText,
      totalLabel: t('usage_stats.total_label', '总计'),
      failureLabel: t('usage_stats.failure_short', '失败'),
      subValue: buildTrend(
        stats.today.successRequests,
        stats.yesterday.successRequests,
        compareYesterday
      ),
    },
    {
      key: 'todayTokens',
      label: t('usage_stats.today_tokens') || '今日 Token',
      num: formatTokenCount(stats.today.tokens),
      icon: <IconToken />,
      accent: '#a78bfa',
      accentKey: 'tokens',
      subValue: buildTrend(stats.today.tokens, stats.yesterday.tokens, compareYesterday),
    },
    {
      key: 'todayCost',
      label: t('usage_stats.today_cost') || '今日花费',
      num: todayCostComplete ? formatUsd(stats.today.cost) : '--',
      icon: <IconDollar />,
      accent: '#34d399',
      accentKey: 'cost',
      subValue: buildTrend(
        todayCostComplete ? stats.today.cost : Number.NaN,
        yesterdayCostComplete ? stats.yesterday.cost : Number.NaN,
        compareYesterday
      ),
    },
  ];

  return (
    <div className={styles.statsGrid} aria-busy={loading || undefined}>
      {cards.map((card) => {
        const successRateBadge =
          card.accentKey === 'requests' && card.successRate ? (
            <span
              className={styles.successRateBadge}
              title={`${t('usage_stats.success_rate', '成功率')}: ${card.successRate}`}
            >
              {card.successRate}
            </span>
          ) : null;
        const primaryTitle = String(card.num);
        const footer =
          card.accentKey === 'requests' ? (
            <>
              <span className={styles.dataCapsuleMuted}>
                {card.totalLabel} {stats.today.totalRequests.toLocaleString()}
              </span>
              <span className={styles.dot}>·</span>
              <span className={styles.failText}>
                {card.failureLabel} {stats.today.failureRequests.toLocaleString()}
              </span>
              <span className={styles.dot}>·</span>
              <span
                className={`${styles.metricSubLine} ${getTrendClassName(card.subValue.direction)}`}
              >
                {card.subValue.label}
              </span>
            </>
          ) : (
            <span
              className={`${styles.metricSubLine} ${getTrendClassName(card.subValue.direction)}`}
            >
              {card.subValue.label}
            </span>
          );
        return (
          <section
            key={card.key}
            className={`${styles.metricCard} ${styles.metricCardToday}`}
            aria-label={card.label}
            data-accent={card.accentKey}
          >
            <div className={styles.metricCardHeader}>
              <span className={styles.metricCardIcon}>{card.icon}</span>
              <span className={styles.metricCardTitle}>{card.label}</span>
              {successRateBadge}
            </div>
            <div className={styles.metricCardBody}>
              <div className={styles.metricSummaryStack} title={primaryTitle}>
                <div
                  className={`${styles.metricMainValue} ${card.accentKey === 'requests' ? styles.primarySuccess : ''}`}
                  title={primaryTitle}
                >
                  {card.num}
                </div>
                <div className={styles.metricSubLine}>{footer}</div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
