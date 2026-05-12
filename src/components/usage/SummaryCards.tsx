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
    // >= 1B (10亿), 显示为 B
    return (tokens / 1_000_000_000).toFixed(2) + 'B';
  } else if (tokens >= 1_000_000) {
    // >= 1M (100万), 如果 >= 1000M 则显示为 B
    const inMillions = tokens / 1_000_000;
    if (inMillions >= 1000) {
      return (tokens / 1_000_000_000).toFixed(2) + 'B';
    }
    return inMillions.toFixed(2) + 'M';
  }
  return formatCompactNumber(tokens);
}

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

const IconMonth = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

export function SummaryCards({ usage, modelPrices }: SummaryCardsProps) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    if (!usage) {
      return { todayCost: 0, todayTokens: 0, todayRequests: 0, monthCost: 0 };
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();

    let todayCost = 0;
    let todayTokens = 0;
    let todayRequests = 0;
    let monthCost = 0;

    const details = collectUsageDetails(usage);
    
    for (const detail of details) {
      const timestampMs = detail.__timestampMs || 0;
      if (timestampMs === 0) continue;

      const totalTokens = extractTotalTokens(detail);
      const cost = calculateCost(detail, modelPrices);

      if (timestampMs >= todayStart) {
        todayCost += cost;
        todayTokens += totalTokens;
        todayRequests += 1;
      }

      if (timestampMs >= monthStart) {
        monthCost += cost;
      }
    }

    return { todayCost, todayTokens, todayRequests, monthCost };
  }, [usage, modelPrices]);

  const cards = [
    {
      key: 'todayCost',
      label: t('usage_stats.today_cost') || '今日花费',
      value: formatUsd(stats.todayCost),
      icon: <IconDollar />,
      accent: '#10b981',
    },
    {
      key: 'todayTokens',
      label: t('usage_stats.today_tokens') || '今日 Token',
      value: formatTokenCount(stats.todayTokens),
      icon: <IconToken />,
      accent: '#6366f1',
    },
    {
      key: 'todayRequests',
      label: t('usage_stats.today_requests') || '今日请求',
      value: stats.todayRequests.toLocaleString(),
      icon: <IconCount />,
      accent: '#f59e0b',
    },
    {
      key: 'monthCost',
      label: t('usage_stats.month_cost') || '本月花费',
      value: formatUsd(stats.monthCost),
      icon: <IconMonth />,
      accent: '#8b5cf6',
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
            <div className={styles.summaryCardValue}>{card.value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
