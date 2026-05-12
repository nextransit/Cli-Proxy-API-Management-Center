import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCompactNumber, formatUsd, collectUsageDetails, extractTotalTokens, calculateCost } from '@/utils/usage';
import type { UsagePayload } from './hooks/useUsageData';
import type { ModelPrice } from '@/utils/usage';
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
}

const EMPTY_PERIOD_STATS: PeriodStats = {
  cost: 0,
  tokens: 0,
  requests: 0,
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
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const IconToken = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const IconCount = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </svg>
);

export function SummaryCards({ usage, modelPrices }: SummaryCardsProps) {
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
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0).getTime();

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
      } else if (timestampMs >= yesterdayStart && timestampMs < todayStart) {
        yesterday.cost += cost;
        yesterday.tokens += totalTokens;
        yesterday.requests += 1;
      }

      if (timestampMs >= monthStart) {
        month.cost += cost;
        month.tokens += totalTokens;
        month.requests += 1;
      } else if (timestampMs >= previousMonthStart && timestampMs < monthStart) {
        previousMonth.cost += cost;
        previousMonth.tokens += totalTokens;
        previousMonth.requests += 1;
      }
    }

    return { today, yesterday, month, previousMonth };
  }, [usage, modelPrices]);

  const compareYesterday = t('usage_stats.vs_yesterday', 'vs 昨日');

  const cards = [
    {
      key: 'todayRequests',
      label: t('usage_stats.today_requests') || '今日请求',
      num: stats.today.requests.toLocaleString(),
      unit: '',
      icon: <IconCount />,
      accent: '#f59e0b',
      trend: buildTrend(stats.today.requests, stats.yesterday.requests, compareYesterday),
    },
    {
      key: 'todayTokens',
      label: t('usage_stats.today_tokens') || '今日 Token',
      num: formatTokenCount(stats.today.tokens),
      unit: '',
      icon: <IconToken />,
      accent: '#6366f1',
      trend: buildTrend(stats.today.tokens, stats.yesterday.tokens, compareYesterday),
    },
    {
      key: 'todayCost',
      label: t('usage_stats.today_cost') || '今日花费',
      num: formatUsd(stats.today.cost),
      unit: '',
      icon: <IconDollar />,
      accent: '#10b981',
      trend: buildTrend(stats.today.cost, stats.yesterday.cost, compareYesterday),
    },
  ];

  return (
    <div className={styles.summaryCards}>
      {cards.map((card) => (
        <div key={card.key} className={styles.summaryCard}>
          <div className={styles.summaryCardIcon} style={{ backgroundColor: card.accent + '20', color: card.accent }}>
            {card.icon}
          </div>
          <div className={styles.summaryCardContent}>
            <div className={styles.summaryCardLabel}>{card.label}</div>
            <div className={styles.summaryCardValue}>
              <span className={styles.summaryCardNumber}>{card.num}</span>
            </div>
            <div className={`${styles.summaryCardTrend} ${getTrendClassName(card.trend.direction)}`}>
              {card.trend.label}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
