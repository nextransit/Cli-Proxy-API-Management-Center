import { useTranslation } from 'react-i18next';
import { UsageChart, ChartLineSelector, CostTrendChart } from '@/components/usage';
import type { UsageChartProps } from '@/components/usage/UsageChart';
import type { ChartLineSelectorProps } from '@/components/usage/ChartLineSelector';
import type { CostTrendChartProps } from '@/components/usage/CostTrendChart';
import styles from '@/pages/UsagePage.module.scss';

export interface TrendTab {
  key: string;
  label: string;
  chartProps: Omit<UsageChartProps, 'title' | 'showPeriodControls'>;
  costChartProps?: Omit<CostTrendChartProps, 'title'>;
}

export interface TrendTabsCardProps {
  tabs: TrendTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  lineSelector?: Omit<ChartLineSelectorProps, 'className'> & { visibleOnTabs?: string[] };
}

export function TrendTabsCard({
  tabs,
  activeTab,
  onTabChange,
  lineSelector,
}: TrendTabsCardProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.trendTabsCard}>
      <div className={styles.trendTabsHeader}>
        <h3 className={styles.trendTabsTitle}>{t('usage_stats.trend_analysis')}</h3>
        <div className={styles.trendTabsBar} role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={
                activeTab === tab.key
                  ? styles.trendTabActive
                  : styles.trendTab
              }
              onClick={() => onTabChange(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {lineSelector && (!lineSelector.visibleOnTabs || lineSelector.visibleOnTabs.includes(activeTab)) && (
          <div className={styles.trendTabsExtra}>
            <ChartLineSelector {...lineSelector} />
          </div>
        )}
      </div>

      <div className={styles.trendTabsBody}>
        {tabs.map((tab) => (
          <div
            key={tab.key}
            className={
              activeTab === tab.key
                ? styles.trendTabPanel
                : styles.trendTabPanelHidden
            }
            aria-hidden={activeTab !== tab.key}
          >
            {tab.costChartProps ? (
              <CostTrendChart {...tab.costChartProps} />
            ) : (
              <UsageChart {...tab.chartProps} title={tab.label} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
