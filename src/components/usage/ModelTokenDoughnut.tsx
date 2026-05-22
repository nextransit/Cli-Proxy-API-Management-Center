import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions, ScriptableContext } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import type { ModelStatsSummary } from '@/utils/usage';
import { formatUsd } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface ModelTokenDoughnutProps {
  modelStats: ModelStatsSummary[];
  hasPrices: boolean;
  loading: boolean;
  isDark: boolean;
}

interface GradientColor {
  base: string;
  light: string;
}

const DOUGHNUT_COLORS: GradientColor[] = [
  { base: '#1d4ed8', light: '#60a5fa' },
  { base: '#ca8a04', light: '#facc15' },
  { base: '#15803d', light: '#4ade80' },
  { base: '#7e22ce', light: '#c084fc' },
  { base: '#b91c1c', light: '#f87171' },
  { base: '#0e7490', light: '#22d3ee' },
  { base: '#c2410c', light: '#fb923c' },
];

const MAX_SEGMENTS = 7;

function toGradient(
  ctx: CanvasRenderingContext2D,
  area: { top: number; bottom: number },
  color: GradientColor,
): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, color.light);
  gradient.addColorStop(1, color.base);
  return gradient;
}

function formatTokens(num: number): string {
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toLocaleString();
}

export function ModelTokenDoughnut({
  modelStats,
  hasPrices,
  loading,
  isDark,
}: ModelTokenDoughnutProps) {
  const { t } = useTranslation();

  const { chartData, chartOptions, totalTokens, segments, maxTokens } = useMemo(() => {
    const sorted = [...modelStats].sort((a, b) => b.tokens - a.tokens);
    const top = sorted.slice(0, MAX_SEGMENTS - 1);
    const otherTokens = sorted.slice(MAX_SEGMENTS - 1).reduce((sum, s) => sum + s.tokens, 0);

    const segments: { label: string; tokens: number; cost: number; color: GradientColor }[] = [];
    top.forEach((s, i) => {
      segments.push({
        label: s.model,
        tokens: s.tokens,
        cost: s.cost,
        color: DOUGHNUT_COLORS[i % DOUGHNUT_COLORS.length],
      });
    });
    if (otherTokens > 0) {
      segments.push({
        label: t('usage_stats.others'),
        tokens: otherTokens,
        cost: 0,
        color: { base: '#6b7280', light: '#d1d5db' },
      });
    }

    const total = segments.reduce((sum, s) => sum + s.tokens, 0);
    const max = Math.max(...segments.map((s) => s.tokens), 1);

    const data: ChartData<'doughnut', number[], string> = {
      labels: segments.map((s) => s.label),
      datasets: [
        {
          data: segments.map((s) => s.tokens),
          backgroundColor: (ctx: ScriptableContext<'doughnut'>) => {
            const { chart } = ctx;
            const area = chart.chartArea;
            if (!area) return segments[ctx.dataIndex]?.color.base ?? '#6b7280';
            return toGradient(chart.ctx, area, segments[ctx.dataIndex]?.color ?? { base: '#6b7280', light: '#d1d5db' });
          },
          borderColor: isDark ? '#0f172a' : '#ffffff',
          borderWidth: 3,
          borderRadius: 6,
          hoverBorderWidth: 4,
          hoverBorderColor: isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.18)',
          borderJoinStyle: 'round' as CanvasLineJoin,
          spacing: 2,
        },
      ],
    };

    const textColor = isDark ? '#f8fafc' : '#111827';
    const subColor = isDark ? '#64748b' : '#6b7280';
    const borderColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(17,24,39,0.1)';

    const options: ChartOptions<'doughnut'> = {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      animation: {
        animateScale: true,
        animateRotate: true,
        duration: 800,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? 'rgba(15,23,42,0.94)' : 'rgba(255,255,255,0.98)',
          titleColor: textColor,
          bodyColor: subColor,
          borderColor,
          borderWidth: 1,
          padding: 12,
          displayColors: true,
          usePointStyle: true,
          boxPadding: 4,
          callbacks: {
            label: (ctx) => {
              const seg = segments[ctx.dataIndex];
              if (!seg) return '';
              const pct = total > 0 ? ((seg.tokens / total) * 100).toFixed(1) : '0';
              const parts = [`  ${seg.label}: ${formatTokens(seg.tokens)} (${pct}%)`];
              if (hasPrices && seg.cost > 0) {
                parts.push(`  ${t('usage_stats.cost_trend')}: ${formatUsd(seg.cost)}`);
              }
              return parts;
            },
          },
        },
      },
      hover: {
        mode: 'nearest' as const,
        intersect: true,
      },
    };

    return { chartData: data, chartOptions: options, totalTokens: total, segments, maxTokens: max };
  }, [modelStats, isDark, hasPrices, t]);

  if (loading) {
    return (
      <div className={styles.tokenDistCard}>
        <div className={styles.tokenDistHeader}>
          <h3 className={styles.tokenDistTitle}>{t('usage_stats.model_token_distribution')}</h3>
        </div>
        <div className={styles.tokenDistContent}>
          <div className={styles.hint}>{t('common.loading')}</div>
        </div>
      </div>
    );
  }

  if (segments.length === 0) {
    return (
      <div className={styles.tokenDistCard}>
        <div className={styles.tokenDistHeader}>
          <h3 className={styles.tokenDistTitle}>{t('usage_stats.model_token_distribution')}</h3>
        </div>
        <div className={styles.tokenDistContent}>
          <div className={styles.hint}>{t('usage_stats.no_data')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.tokenDistCard}>
      <div className={styles.tokenDistHeader}>
        <h3 className={styles.tokenDistTitle}>{t('usage_stats.model_token_distribution')}</h3>
        <span className={styles.tokenDistBadge}>
          {t('usage_stats.total_tokens')}: {formatTokens(totalTokens)}
        </span>
      </div>

      <div className={styles.tokenDistContent}>
        <div className={styles.tokenDistChart}>
          <div className={styles.tokenDistCenter}>
            <span className={styles.tokenDistTotal}>{formatTokens(totalTokens)}</span>
            <span className={styles.tokenDistLabel}>{t('usage_stats.total_tokens')}</span>
          </div>
          <Doughnut data={chartData} options={chartOptions} />
        </div>

        <div className={styles.tokenDistGrid}>
          {segments.map((seg) => {
            const pct = totalTokens > 0 ? (seg.tokens / totalTokens) * 100 : 0;
            const barWidth = maxTokens > 0 ? (seg.tokens / maxTokens) * 100 : 0;

            return (
              <div key={seg.label} className={styles.tokenDistItem}>
                <div
                  className={styles.tokenDistProgress}
                  style={{ width: `${barWidth}%` }}
                />
                <div className={styles.tokenDistItemInfo}>
                  <span
                    className={styles.tokenDistDot}
                    style={{
                      background: `linear-gradient(135deg, ${seg.color.light}, ${seg.color.base})`,
                      boxShadow: `0 0 8px ${seg.color.light}66`,
                    }}
                  />
                  <span className={styles.tokenDistName} title={seg.label}>
                    {seg.label}
                  </span>
                </div>
                <div className={styles.tokenDistItemValue}>
                  <span className={styles.tokenDistValue}>{formatTokens(seg.tokens)}</span>
                  <span className={styles.tokenDistPercent}>{pct.toFixed(1)}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
