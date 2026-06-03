import { describe, it, expect } from 'vitest';
import { buildEChartsTrendOption } from './chartConfig';
import type { ChartData } from '../usage';
import type { ThemeColors } from '../echarts/themeBridge';

const theme: ThemeColors = {
  textPrimary: '#e2e8f0',
  textSecondary: 'rgba(226, 232, 240, 0.66)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderMuted: 'rgba(255, 255, 255, 0.06)',
  bgPrimary: '#000000',
  accent: '#06b6d4',
};

const sampleData: ChartData = {
  labels: ['00:00', '01:00', '02:00'],
  datasets: [
    {
      label: 'Token Volume',
      data: [100, 200, 150],
      borderColor: '#06b6d4',
      backgroundColor: 'rgba(6, 182, 212, 0.16)',
      hoverBorderColor: '#06b6d4',
      hoverBackgroundColor: 'rgba(6, 182, 212, 0.4)',
      fill: true,
      tension: 0.4,
    },
  ],
};

describe('buildEChartsTrendOption', () => {
  it('returns an EChartsOption with category xAxis data from labels', () => {
    const option = buildEChartsTrendOption(sampleData, theme, { isNarrowScreen: false });
    expect(option.xAxis).toMatchObject({ type: 'category' });
    // @ts-expect-error - EChartsAxisBase has data on category
    expect(option.xAxis?.data).toEqual(['00:00', '01:00', '02:00']);
  });

  it('emits one line series per dataset with the dataset color', () => {
    const option = buildEChartsTrendOption(sampleData, theme, { isNarrowScreen: false });
    expect(Array.isArray(option.series)).toBe(true);
    const series = option.series as Array<Record<string, unknown>>;
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      name: 'Token Volume',
      type: 'line',
    });
  });

  it('includes dataZoom when isNarrowScreen is true', () => {
    const option = buildEChartsTrendOption(sampleData, theme, { isNarrowScreen: true });
    expect(option.dataZoom).toBeDefined();
    expect(Array.isArray(option.dataZoom)).toBe(true);
    const zooms = option.dataZoom as Array<{ type: string }>;
    expect(zooms.some((z) => z.type === 'inside')).toBe(true);
    expect(zooms.some((z) => z.type === 'slider')).toBe(true);
  });

  it('omits dataZoom when isNarrowScreen is false', () => {
    const option = buildEChartsTrendOption(sampleData, theme, { isNarrowScreen: false });
    expect(option.dataZoom).toBeUndefined();
  });

  it('applies the requested animation duration and easing', () => {
    const option = buildEChartsTrendOption(sampleData, theme, {
      isNarrowScreen: false,
      animationDuration: 350,
      animationEasing: 'linear',
    });
    expect(option.animationDuration).toBe(350);
    expect(option.animationEasing).toBe('linear');
  });

  it('uses sampling: lttb for dense series', () => {
    const option = buildEChartsTrendOption(sampleData, theme, { isNarrowScreen: false });
    const series = option.series as Array<Record<string, unknown>>;
    expect(series[0]?.sampling).toBe('lttb');
  });
});
