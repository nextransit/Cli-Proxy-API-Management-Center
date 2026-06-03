import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { useThemeStore } from '@/stores';
import { useEChartsResize } from '@/hooks/useEChartsResize';
import { getThemeColors } from '@/utils/echarts/themeBridge';
import { registerCliThemes } from '@/utils/echarts/registerThemes';
import styles from './TelemetryChart.module.scss';

registerCliThemes();

export interface TelemetryChartProps {
  title: string;
  option: echarts.EChartsOption;
  loading?: boolean;
  height?: number;
  extraControls?: React.ReactNode;
  onChartReady?: (instance: echarts.EChartsType) => void;
  onResize?: (size: { width: number; height: number }) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function TelemetryChart({
  title,
  option,
  loading = false,
  height = 256,
  extraControls,
  onChartReady,
  onResize,
  className,
  style,
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.EChartsType | null>(null);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  // (Re-)initialize when the resolved theme changes; ECharts binds theme at init.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const instance = echarts.init(
      container,
      resolvedTheme === 'dark' ? 'cli-dark' : 'cli-light',
      { renderer: 'canvas' },
    );
    instanceRef.current = instance;
    onChartReady?.(instance);

    return () => {
      instance.dispose();
      instanceRef.current = null;
    };
    // We intentionally only re-init on theme change; option updates are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);

  // Apply option updates without merging conflicts.
  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    instance.setOption(option, { notMerge: false, lazyUpdate: true });
  }, [option]);

  // Mirror the active theme colors onto the live option (cheap; uses CSS vars).
  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    const colors = getThemeColors();
    instance.setOption(
      {
        textStyle: { color: colors.textPrimary },
        backgroundColor: 'transparent',
      },
      { lazyUpdate: true },
    );
  }, [resolvedTheme]);

  useEChartsResize(containerRef, (_el, size) => {
    instanceRef.current?.resize();
    onResize?.(size);
  });

  return (
    <div className={`${styles.container} ${className ?? ''}`} style={style}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <span
            className={`${styles.indicatorDot} ${loading ? styles.loading : styles.active}`}
            data-loading={loading || undefined}
            aria-hidden="true"
          />
          <span className={styles.titleText}>{title}</span>
        </div>
        {extraControls ? <div className={styles.controlSlot}>{extraControls}</div> : null}
      </div>
      <div
        ref={containerRef}
        className={styles.canvas}
        style={{ height }}
        data-testid="echarts-mount"
      />
    </div>
  );
}
