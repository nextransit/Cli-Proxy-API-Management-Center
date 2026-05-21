import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import type { ModelStatsSummary } from '@/utils/usage';
import { formatUsd } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface ModelTokenDoughnutProps {
  modelStats: ModelStatsSummary[];
  hasPrices: boolean;
  loading: boolean;
  isDark: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

interface GradientColor {
  base: string;
  light: string;
}

const DOUGHNUT_COLORS: GradientColor[] = [
  { base: '#1d4ed8', light: '#60a5fa' }, // 蓝
  { base: '#ca8a04', light: '#facc15' }, // 金
  { base: '#15803d', light: '#4ade80' }, // 绿
  { base: '#7e22ce', light: '#c084fc' }, // 紫
  { base: '#b91c1c', light: '#f87171' }, // 红
  { base: '#0e7490', light: '#22d3ee' }, // 青
  { base: '#c2410c', light: '#fb923c' }, // 橙
];

const MAX_SEGMENTS = 7;

function toGradient(ctx: CanvasRenderingContext2D, area: { top: number; bottom: number }, color: GradientColor): CanvasGradient {
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
  collapsible = false,
  defaultCollapsed = false,
}: ModelTokenDoughnutProps) {
  const { t } = useTranslation();

  const { chartData, chartOptions, totalTokens, segments } = useMemo(() => {
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

    const data: ChartData<'doughnut', number[], string> = {
      labels: segments.map((s) => s.label),
      datasets: [
        {
          data: segments.map((s) => s.tokens),
          backgroundColor: (ctx) => {
            const { chart } = ctx;
            const area = chart.chartArea;
            if (!area) return segments[ctx.dataIndex]?.color.base ?? '#6b7280';
            return toGradient(chart.ctx, area, segments[ctx.dataIndex]?.color ?? { base: '#6b7280', light: '#d1d5db' });
          },
          borderColor: 'transparent',
          borderWidth: 0,
          hoverBorderWidth: 2,
          hoverBorderColor: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)',
          borderJoinStyle: 'round' as CanvasLineJoin,
        },
      ],
    };

    const gridColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(17,24,39,0.10)';
    const textColor = isDark ? 'rgba(255,255,255,0.87)' : '#111827';
    const subColor = isDark ? 'rgba(255,255,255,0.55)' : '#6b7280';

    const options: ChartOptions<'doughnut'> = {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '58%',
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDark ? 'rgba(17,24,39,0.94)' : 'rgba(255,255,255,0.98)',
          titleColor: textColor,
          bodyColor: subColor,
          borderColor: gridColor,
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
    };

    return { chartData: data, chartOptions: options, totalTokens: total, segments };
  }, [modelStats, isDark, hasPrices, t]);

  if (loading) {
    return (
      <Card title={t('usage_stats.model_token_distribution')} collapsible={collapsible} defaultCollapsed={defaultCollapsed}>
        <div className={styles.hint}>{t('common.loading')}</div>
      </Card>
    );
  }

  if (segments.length === 0) {
    return (
      <Card title={t('usage_stats.model_token_distribution')} collapsible={collapsible} defaultCollapsed={defaultCollapsed}>
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      </Card>
    );
  }

  return (
    <Card title={t('usage_stats.model_token_distribution')} collapsible={collapsible} defaultCollapsed={defaultCollapsed}>
      <div className={styles.doughnutLayout}>
        <div className={styles.doughnutChart}>
          <div className={styles.doughnutCenter}>
            <span className={styles.doughnutTotal}>{formatTokens(totalTokens)}</span>
            <span className={styles.doughnutLabel}>{t('usage_stats.total_tokens')}</span>
          </div>
          <Doughnut data={chartData} options={chartOptions} />
        </div>
        <div className={styles.doughnutLegend}>
          {segments.map((seg) => (
            <div key={seg.label} className={styles.doughnutLegendItem}>
              <span
                className={styles.doughnutLegendDot}
                style={{
                  background: `linear-gradient(180deg, ${seg.color.light}, ${seg.color.base})`,
                }}
              />
              <span className={styles.doughnutLegendName}>{seg.label}</span>
              <span className={styles.doughnutLegendValue}>{formatTokens(seg.tokens)}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
