import { memo, useState, useCallback, type KeyboardEvent, type MouseEvent } from 'react';
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
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, label, summary, [role="button"], [role="switch"], [data-card-header-ignore-click]';

function shouldIgnoreHeaderToggle(target: EventTarget | null, currentTarget: Element) {
  if (!(target instanceof Element)) {
    return false;
  }
  const interactiveElement = target.closest(INTERACTIVE_SELECTOR);
  return Boolean(interactiveElement && interactiveElement !== currentTarget);
}

export const TrendTabsCard = memo(function TrendTabsCard({
  tabs,
  activeTab,
  onTabChange,
  lineSelector,
  collapsible = false,
  defaultCollapsed = false,
}: TrendTabsCardProps) {
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

  const showLineSelector =
    !isCollapsed &&
    lineSelector !== undefined &&
    (!lineSelector.visibleOnTabs || lineSelector.visibleOnTabs.includes(activeTab));

  return (
    <div className={styles.trendTabsCard}>
      <div
        className={`${styles.trendTabsHeader} ${collapsible ? styles.trendTabsHeaderClickable : ''} ${isCollapsed ? styles.trendTabsHeaderCollapsed : ''}`}
        onClick={handleHeaderClick}
        onKeyDown={handleHeaderKeyDown}
        role={collapsible ? 'button' : undefined}
        tabIndex={collapsible ? 0 : undefined}
        aria-expanded={collapsible ? expanded : undefined}
      >
        <div className={styles.trendTabsHeaderLeft}>
          {collapsible && (
            <span className={`${styles.trendTabsChevron} ${isCollapsed ? styles.trendTabsChevronCollapsed : ''}`}>
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
          )}
          <h3 className={styles.trendTabsTitle}>{t('usage_stats.trend_analysis')}</h3>
        </div>
        {!isCollapsed && (
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
        )}
        {showLineSelector && (
          <div className={styles.trendTabsExtra}>
            <ChartLineSelector {...lineSelector} />
          </div>
        )}
      </div>

      <div className={`${styles.trendTabsBody} ${isCollapsed ? styles.trendTabsBodyCollapsed : ''}`}>
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
});
