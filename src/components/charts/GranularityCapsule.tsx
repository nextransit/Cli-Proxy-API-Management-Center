import { useTranslation } from 'react-i18next';
import type { Granularity } from '@/hooks/useGranularity';
import type { UsageTimeRange } from '@/utils/usage';
import styles from './GranularityCapsule.module.scss';

export interface GranularityCapsuleProps {
  cardId: string;
  value: Granularity;
  onChange: (next: Granularity) => void;
  timeRange: UsageTimeRange;
  disabled?: boolean;
}

export function GranularityCapsule({
  cardId,
  value,
  onChange,
  timeRange,
  disabled = false,
}: GranularityCapsuleProps) {
  const { t } = useTranslation();
  const dayDisabled = disabled || timeRange === 'today';

  return (
    <div
      className={styles.capsule}
      role="group"
      aria-label={t('usage_stats.chart_granularity')}
      data-card-id={cardId}
    >
      <button
        type="button"
        className={`${styles.button} ${value === 'hour' ? styles.buttonActive : ''}`}
        aria-pressed={value === 'hour'}
        disabled={disabled}
        onClick={() => onChange('hour')}
      >
        {t('usage_stats.granularity_hour_short')}
      </button>
      <button
        type="button"
        className={`${styles.button} ${value === 'day' ? styles.buttonActive : ''}`}
        aria-pressed={value === 'day'}
        disabled={dayDisabled}
        title={dayDisabled ? t('usage_stats.granularity_day_disabled_today') : undefined}
        onClick={() => onChange('day')}
      >
        {t('usage_stats.granularity_day_short')}
      </button>
    </div>
  );
}
