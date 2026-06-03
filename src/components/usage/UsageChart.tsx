import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { TelemetryChart } from '@/components/charts/TelemetryChart';
import { GranularityCapsule } from '@/components/charts/GranularityCapsule';
import { useGranularity } from '@/hooks/useGranularity';
import { getThemeColors } from '@/utils/echarts/themeBridge';
import { buildEChartsTrendOption } from '@/utils/usage/chartConfig';
import type { ChartData, UsageTimeRange } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface UsageChartProps {
  isDark?: boolean;
  title: string;
  chartData: ChartData;
  loading: boolean;
  isMobile: boolean;
  isNarrowScreen: boolean;
  emptyText: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  summary?: React.ReactNode;
  extra?: React.ReactNode;
  timeRange: UsageTimeRange;
}

export function UsageChart({
  title,
  chartData,
  loading,
  isMobile: _isMobile,
  isNarrowScreen,
  emptyText,
  // isDark is accepted for API surface parity; TelemetryChart handles its own theme.
  isDark: _isDark,
  collapsible = false,
  defaultCollapsed = false,
  summary,
  extra,
  timeRange,
}: UsageChartProps) {
  const { granularity, setGranularity } = useGranularity('usage_trend');
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  const handleHeaderClick = () => {
    if (collapsible) {
      setExpanded(!expanded);
    }
  };

  const option = useMemo(() => {
    if (chartData.labels.length === 0) return null;
    const theme = getThemeColors();
    return buildEChartsTrendOption(chartData, theme, { isNarrowScreen });
  }, [chartData, isNarrowScreen]);

  if (collapsible) {
    return (
      <Card
        title={title}
        collapsible
        defaultCollapsed={defaultCollapsed}
        headerExpanded={expanded}
        onHeaderClick={handleHeaderClick}
        summary={summary}
        extra={extra}
      >
        {renderBody()}
      </Card>
    );
  }

  return (
    <TelemetryChart
      title={title}
      option={option ?? { series: [] }}
      loading={loading}
      extraControls={
        <GranularityCapsule
          cardId="usage_trend"
          value={granularity}
          onChange={setGranularity}
          timeRange={timeRange}
        />
      }
    />
  );

  function renderBody() {
    if (loading) {
      return (
        <div className={styles.chartSkeletonPlaceholder}>
          <div className={styles.chartSkeletonBars}>
            {[40, 65, 45, 80, 55, 70, 50, 85, 60, 75, 45, 90].map((h, i) => (
              <div key={i} className={styles.chartSkeletonBar} style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      );
    }
    if (chartData.labels.length === 0) {
      return <div className={styles.hint}>{emptyText}</div>;
    }
    return (
      <div className={styles.hint}>
        Collapsible UsageChart branch with data: {chartData.labels.length} labels
      </div>
    );
  }
}
