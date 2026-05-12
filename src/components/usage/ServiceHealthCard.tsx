import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  collectUsageDetails,
  calculateServiceHealthData,
  type ServiceHealthData,
  type StatusBlockDetail,
} from '@/utils/usage';
import type { UsagePayload } from './hooks/useUsageData';
import { Card } from '@/components/ui/Card';
import styles from '@/pages/UsagePage.module.scss';

const COLOR_STOPS = [
  { r: 8, g: 145, b: 178 }, // #0891b2
  { r: 6, g: 182, b: 212 }, // #06b6d4
  { r: 34, g: 211, b: 238 }, // #22d3ee
] as const;

const TOOLTIP_OFFSET = 8;
const TOOLTIP_SAFE_WIDTH = 180;
const TOOLTIP_SAFE_HEIGHT = 72;

type TooltipHorizontalPosition = 'center' | 'left' | 'right';
type TooltipVerticalPosition = 'above' | 'below';

interface ActiveTooltipState {
  idx: number;
  anchorEl: HTMLDivElement;
  horizontal: TooltipHorizontalPosition;
  vertical: TooltipVerticalPosition;
  left: number;
  top: number;
  transform: string;
}

function rateToColor(rate: number): string {
  const t = Math.max(0, Math.min(1, rate));
  const segment = t < 0.5 ? 0 : 1;
  const localT = segment === 0 ? t * 2 : (t - 0.5) * 2;
  const from = COLOR_STOPS[segment];
  const to = COLOR_STOPS[segment + 1];
  const r = Math.round(from.r + (to.r - from.r) * localT);
  const g = Math.round(from.g + (to.g - from.g) * localT);
  const b = Math.round(from.b + (to.b - from.b) * localT);
  return `rgb(${r}, ${g}, ${b})`;
}

function getHealthStatus(rate: number): 'good' | 'warning' | 'bad' {
  if (rate > 95) return 'good';
  if (rate >= 80) return 'warning';
  return 'bad';
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${h}:${m}`;
}

// Green/Red status indicator component
const StatusIndicator = ({ rate, hasData, loading }: { rate: number; hasData: boolean; loading: boolean }) => {
  if (loading || !hasData) {
    return <span className={styles.statusIndicator} data-status="unknown" title="No data">--</span>;
  }
  const status = getHealthStatus(rate);
  const label = status === 'good' ? '✓' : status === 'warning' ? '⚠' : '!';
  return (
    <span className={styles.statusIndicator} data-status={status} title={`Success rate: ${rate.toFixed(1)}%`}>
      {label}
    </span>
  );
};

export interface ServiceHealthCardProps {
  usage: UsagePayload | null;
  loading: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  summary?: React.ReactNode;
}

export function ServiceHealthCard({ usage, loading, collapsible = false, defaultCollapsed = false, summary: customSummary }: ServiceHealthCardProps) {
  const [expanded, setExpanded] = useState(!defaultCollapsed);
  const handleHeaderClick = () => {
    if (collapsible) {
      setExpanded((prev) => !prev);
    }
  };
  const { t } = useTranslation();
  const [activeTooltip, setActiveTooltip] = useState<ActiveTooltipState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const healthData: ServiceHealthData = useMemo(() => {
    const details = usage ? collectUsageDetails(usage) : [];
    return calculateServiceHealthData(details);
  }, [usage]);

  const hasData = healthData.totalSuccess + healthData.totalFailure > 0;

  // Auto-generate summary when collapsible is true and no custom summary provided
  const autoSummary = useMemo(() => {
    if (!collapsible || customSummary !== undefined) {
      return customSummary;
    }

    const successRateText = loading ? '--' : hasData ? `${healthData.successRate.toFixed(1)}%` : '--';
    const successCountText = loading ? '--' : healthData.totalSuccess.toLocaleString();
    const failureCountText = loading ? '--' : healthData.totalFailure.toLocaleString();

    return (
      <span className={styles.healthSummary}>
        <StatusIndicator rate={healthData.successRate} hasData={hasData} loading={loading} />
        <span className={styles.healthSummaryRate}>{successRateText}</span>
        <span className={styles.healthSummaryDetail}>
          <span className={styles.healthSummarySuccess}>
            {t('status_bar.success_short')} {successCountText}
          </span>
          <span className={styles.healthSummarySeparator}>/</span>
          <span className={styles.healthSummaryFailure}>
            {t('status_bar.failure_short')} {failureCountText}
          </span>
        </span>
      </span>
    );
  }, [collapsible, customSummary, hasData, healthData, loading, t]);

  useEffect(() => {
    if (activeTooltip === null) return;
    const handler = (e: PointerEvent) => {
      if (gridRef.current && !gridRef.current.contains(e.target as Node)) {
        setActiveTooltip(null);
      }
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [activeTooltip]);

  const buildTooltipState = useCallback(
    (idx: number, anchorEl: HTMLDivElement | null): ActiveTooltipState | null => {
      if (!anchorEl || !anchorEl.isConnected) {
        return null;
      }

      const rect = anchorEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;

      let horizontal: TooltipHorizontalPosition = 'center';
      let left = centerX;

      if (centerX <= TOOLTIP_SAFE_WIDTH / 2) {
        horizontal = 'left';
        left = rect.left;
      } else if (centerX >= window.innerWidth - TOOLTIP_SAFE_WIDTH / 2) {
        horizontal = 'right';
        left = rect.right;
      }

      const vertical: TooltipVerticalPosition = rect.top <= TOOLTIP_SAFE_HEIGHT ? 'below' : 'above';
      const top = vertical === 'below' ? rect.bottom + TOOLTIP_OFFSET : rect.top - TOOLTIP_OFFSET;
      const translateX = horizontal === 'center' ? '-50%' : horizontal === 'right' ? '-100%' : '0';
      const translateY = vertical === 'below' ? '0' : '-100%';

      return {
        idx,
        anchorEl,
        horizontal,
        vertical,
        left: Math.round(left),
        top: Math.round(top),
        transform: `translate(${translateX}, ${translateY})`,
      };
    },
    []
  );

  useEffect(() => {
    if (!activeTooltip) return;

    const updateTooltipPosition = () => {
      if (!document.body.contains(activeTooltip.anchorEl)) {
        setActiveTooltip(null);
        return;
      }
      setActiveTooltip(buildTooltipState(activeTooltip.idx, activeTooltip.anchorEl));
    };

    window.addEventListener('resize', updateTooltipPosition);
    window.addEventListener('scroll', updateTooltipPosition, true);
    return () => {
      window.removeEventListener('resize', updateTooltipPosition);
      window.removeEventListener('scroll', updateTooltipPosition, true);
    };
  }, [activeTooltip, buildTooltipState]);

  const openTooltip = useCallback((idx: number, anchorEl: HTMLDivElement) => {
    const tooltipState = buildTooltipState(idx, anchorEl);
    if (tooltipState) {
      setActiveTooltip(tooltipState);
    }
  }, [buildTooltipState]);

  const handlePointerEnter = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
      if (e.pointerType === 'mouse') {
        openTooltip(idx, e.currentTarget);
      }
    },
    [openTooltip]
  );

  const handlePointerLeave = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') {
      setActiveTooltip(null);
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
      if (e.pointerType === 'touch') {
        e.preventDefault();
        const anchorEl = e.currentTarget;
        setActiveTooltip((prev) => (prev?.idx === idx ? null : buildTooltipState(idx, anchorEl)));
      }
    },
    [buildTooltipState]
  );

  const renderTooltip = (detail: StatusBlockDetail, tooltipState: ActiveTooltipState) => {
    const total = detail.success + detail.failure;
    const posClass =
      tooltipState.horizontal === 'left'
        ? styles.healthTooltipLeft
        : tooltipState.horizontal === 'right'
          ? styles.healthTooltipRight
          : '';
    const vertClass = tooltipState.vertical === 'below' ? styles.healthTooltipBelow : '';
    const timeRange = `${formatDateTime(detail.startTime)} – ${formatDateTime(detail.endTime)}`;
    const tooltip = (
      <div
        className={`${styles.healthTooltip} ${posClass} ${vertClass}`}
        style={{
          position: 'fixed',
          left: `${tooltipState.left}px`,
          top: `${tooltipState.top}px`,
          bottom: 'auto',
          right: 'auto',
          transform: tooltipState.transform,
        }}
      >
        <span className={styles.healthTooltipTime}>{timeRange}</span>
        {total > 0 ? (
          <span className={styles.healthTooltipStats}>
            <span className={styles.healthTooltipSuccess}>
              {t('status_bar.success_short')} {detail.success}
            </span>
            <span className={styles.healthTooltipFailure}>
              {t('status_bar.failure_short')} {detail.failure}
            </span>
            <span className={styles.healthTooltipRate}>({(detail.rate * 100).toFixed(1)}%)</span>
          </span>
        ) : (
          <span className={styles.healthTooltipStats}>{t('status_bar.no_requests')}</span>
        )}
      </div>
    );

    return typeof document === 'undefined' ? tooltip : createPortal(tooltip, document.body);
  };

  const rateClass = !hasData
    ? ''
    : getHealthStatus(healthData.successRate) === 'good'
      ? styles.healthRateHigh
      : getHealthStatus(healthData.successRate) === 'warning'
        ? styles.healthRateMedium
        : styles.healthRateLow;
  const successPercent = Math.max(0, Math.min(100, hasData ? healthData.successRate : 0));

  return (
    <Card
      title={t('service_health.title')}
      collapsible={collapsible}
      defaultCollapsed={defaultCollapsed}
      headerExpanded={expanded}
      onHeaderClick={handleHeaderClick}
      summary={autoSummary}
      extra={
        !collapsible || expanded ? (
          <div className={styles.healthMeta}>
            <span className={styles.healthWindow}>{t('service_health.window')}</span>
            <span className={`${styles.healthRate} ${rateClass}`}>
              {loading ? '--' : hasData ? `${healthData.successRate.toFixed(1)}%` : '--'}
            </span>
          </div>
        ) : undefined
      }
    >
      <div className={styles.healthStatusBar}>
        <div className={styles.healthStatusBarMeta}>
          <span className={styles.healthStatusBarLabel}>{t('service_health.title')}</span>
          <span className={`${styles.healthStatusBarValue} ${rateClass}`}>
            {loading ? '--' : hasData ? `${healthData.successRate.toFixed(1)}%` : '--'}
          </span>
        </div>
        <div className={styles.healthProgressTrack} aria-hidden="true">
          <div
            className={`${styles.healthProgressFill} ${rateClass}`}
            style={{ width: `${successPercent}%` }}
          />
        </div>
      </div>
      <div className={styles.healthGridScroller}>
        <div className={styles.healthGrid} ref={gridRef}>
          {healthData.blockDetails.map((detail, idx) => {
            const isIdle = detail.rate === -1;
            const blockStyle = isIdle ? undefined : { backgroundColor: rateToColor(detail.rate) };
            const isActive = activeTooltip?.idx === idx;

            return (
              <div
                key={idx}
                className={`${styles.healthBlockWrapper} ${isActive ? styles.healthBlockActive : ''}`}
                onPointerEnter={(e) => handlePointerEnter(e, idx)}
                onPointerLeave={handlePointerLeave}
                onPointerDown={(e) => handlePointerDown(e, idx)}
              >
                <div
                  className={`${styles.healthBlock} ${isIdle ? styles.healthBlockIdle : ''}`}
                  style={blockStyle}
                />
                {isActive && activeTooltip && renderTooltip(detail, activeTooltip)}
              </div>
            );
          })}
        </div>
      </div>
      {!collapsible || expanded ? (
        <>
          <div className={styles.healthLegend}>
            <span className={styles.healthLegendLabel}>{t('service_health.oldest')}</span>
            <div className={styles.healthLegendColors}>
              <div className={`${styles.healthLegendBlock} ${styles.healthBlockIdle}`} />
              <div className={styles.healthLegendBlock} style={{ backgroundColor: '#0891b2' }} />
              <div className={styles.healthLegendBlock} style={{ backgroundColor: '#06b6d4' }} />
              <div className={styles.healthLegendBlock} style={{ backgroundColor: '#22d3ee' }} />
            </div>
            <span className={styles.healthLegendLabel}>{t('service_health.newest')}</span>
          </div>
        </>
      ) : null}
    </Card>
  );
}
