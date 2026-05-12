import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import styles from '@/pages/UsagePage.module.scss';

export type ChartCompareMode = 'model' | 'credential';

export interface ChartLineOption {
  value: string;
  label: string;
}

export interface ChartLineSelectorProps {
  chartLines: string[];
  modelNames: string[];
  credentialOptions?: ChartLineOption[];
  compareMode?: ChartCompareMode;
  onCompareModeChange?: (mode: ChartCompareMode) => void;
  maxLines?: number;
  onChange: (lines: string[]) => void;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

export function ChartLineSelector(props: ChartLineSelectorProps) {
  const { t } = useTranslation();
  const {
    chartLines,
    modelNames,
    credentialOptions = [],
    compareMode = 'model',
    onCompareModeChange,
    maxLines = 9,
    onChange,
  } = props;
  const [drawerOpen, setDrawerOpen] = useState(false);

  const lineOptions = useMemo(() => {
    const allLabel =
      compareMode === 'credential'
        ? t('usage_stats.chart_line_all_credentials')
        : t('usage_stats.chart_line_all');
    const specificOptions =
      compareMode === 'credential'
        ? credentialOptions
        : modelNames.map((name) => ({ value: name, label: name }));

    return [{ value: 'all', label: allLabel }, ...specificOptions];
  }, [compareMode, credentialOptions, modelNames, t]);

  const handleAdd = () => {
    if (chartLines.length >= maxLines) return;
    const unusedOption = lineOptions.find(
      (option) => option.value !== 'all' && !chartLines.includes(option.value)
    );
    if (unusedOption) {
      onChange([...chartLines, unusedOption.value]);
    } else {
      onChange([...chartLines, 'all']);
    }
  };

  const handleRemove = (index: number) => {
    if (chartLines.length <= 1) return;
    const newLines = [...chartLines];
    newLines.splice(index, 1);
    onChange(newLines);
  };

  const handleChange = (index: number, value: string) => {
    const newLines = [...chartLines];
    newLines[index] = value;
    onChange(newLines);
  };

  const handleModeChange = (mode: ChartCompareMode) => {
    if (mode === compareMode) return;
    onCompareModeChange?.(mode);
    onChange(['all']);
  };

  return (
    <>
      <div className={styles.chartLineDock}>
        <button
          type="button"
          className={styles.chartConfigButton}
          onClick={() => setDrawerOpen(true)}
          aria-label={t('usage_stats.chart_line_config')}
        >
          <span className={styles.chartLineDockIcon} aria-hidden="true">⌁</span>
          <span className={styles.chartLineCount}>
            {chartLines.length}/{maxLines}
          </span>
          <span className={styles.chartLineDockDivider} aria-hidden="true" />
          <span>⚙ {t('usage_stats.chart_line_config')}</span>
        </button>
      </div>

      {drawerOpen && (
        <div className={styles.curveDrawerLayer} role="dialog" aria-modal="true">
          <button
            type="button"
            className={styles.curveDrawerBackdrop}
            aria-label={t('usage_stats.chart_line_close')}
            onClick={() => setDrawerOpen(false)}
          />
          <aside className={styles.curveDrawer}>
            <div className={styles.curveDrawerHeader}>
              <div>
                <h2>{t('usage_stats.chart_line_config')}</h2>
                <p>{t('usage_stats.chart_line_hint')}</p>
              </div>
              <button
                type="button"
                className={styles.curveDrawerClose}
                aria-label={t('usage_stats.chart_line_close')}
                onClick={() => setDrawerOpen(false)}
              >
                ×
              </button>
            </div>

            <div className={styles.curveModeTabs} role="group" aria-label={t('usage_stats.chart_compare_mode')}>
              <button
                type="button"
                className={compareMode === 'model' ? styles.curveModeButtonActive : styles.curveModeButton}
                onClick={() => handleModeChange('model')}
              >
                {t('usage_stats.chart_compare_by_model')}
              </button>
              <button
                type="button"
                className={
                  compareMode === 'credential' ? styles.curveModeButtonActive : styles.curveModeButton
                }
                onClick={() => handleModeChange('credential')}
              >
                {t('usage_stats.chart_compare_by_credential')}
              </button>
            </div>

            <div className={styles.curveDrawerBody}>
              <div className={styles.chartLineList}>
            {chartLines.map((line, index) => (
              <div key={index} className={styles.chartLineItem}>
                <span className={styles.chartLineLabel}>
                  {t(`usage_stats.chart_line_label_${index + 1}`)}
                </span>
                <Select
                  value={line}
                  options={lineOptions}
                  onChange={(value) => handleChange(index, value)}
                />
                {chartLines.length > 1 && (
                  <Button variant="danger" size="sm" onClick={() => handleRemove(index)}>
                    {t('usage_stats.chart_line_delete')}
                  </Button>
                )}
              </div>
            ))}
              </div>
            </div>

            <div className={styles.curveDrawerFooter}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAdd}
                disabled={chartLines.length >= maxLines}
              >
                {t('usage_stats.chart_line_add')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDrawerOpen(false)}>
                {t('usage_stats.chart_line_close')}
              </Button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
