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

describe('buildEChartsTrendOption - stacked area', () => {
  const theme = {
    textPrimary: '#e5e7eb',
    textSecondary: '#9ca3af',
    bgPrimary: '#111827',
    border: '#374151',
    borderMuted: '#4b5563',
    accent: '#06b6d4',
  } as const;

  const data: ChartData = {
    labels: ['00:00', '01:00', '02:00'],
    datasets: Array.from({ length: 8 }, (_, i) => ({
      label: `model-${i + 1}`,
      data: [i + 1, (i + 1) * 2, (i + 1) * 3],
      borderColor: ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B',
                    '#EC4899', '#06B6D4', '#F43F5E', '#64748B'][i] as string,
      backgroundColor: 'transparent',
      fill: true,
      tension: 0.35,
    })),
  };

  it('enables stack: "total" on every series', () => {
    const option = buildEChartsTrendOption(data, theme, { isNarrowScreen: false });
    const series = option.series as Array<{ stack?: string }>;
    expect(series).toHaveLength(8);
    for (const s of series) {
      expect(s.stack).toBe('total');
    }
  });

  it('sets smooth: false on every series (stacked area prefers straight edges)', () => {
    const option = buildEChartsTrendOption(data, theme, { isNarrowScreen: false });
    const series = option.series as Array<{ smooth?: boolean }>;
    for (const s of series) {
      expect(s.smooth).toBe(false);
    }
  });

  it('uses a vertical gradient areaStyle with opacityTop > opacityBottom', () => {
    const option = buildEChartsTrendOption(data, theme, { isNarrowScreen: false });
    const series = option.series as Array<{ areaStyle: { color: unknown } }>;
    for (const s of series) {
      const css = s.areaStyle.color as string;
      expect(typeof css).toBe('string');
      expect(css).toContain('linear-gradient');
      // 180deg = top first, bottom second; the larger alpha (0.55) should precede the smaller (0.2)
      const topIdx = css.indexOf(', 0.55)');
      const bottomIdx = css.indexOf(', 0.2)');
      expect(topIdx).toBeGreaterThan(-1);
      expect(bottomIdx).toBeGreaterThan(topIdx);
    }
  });

  it('emphasis.lineStyle.width is reduced to 2 (was 3)', () => {
    const option = buildEChartsTrendOption(data, theme, { isNarrowScreen: false });
    const series = option.series as Array<{ emphasis: { lineStyle: { width: number } } }>;
    for (const s of series) {
      expect(s.emphasis.lineStyle.width).toBe(2);
    }
  });
});

describe('buildEChartsTrendOption - 8 series with palette', () => {
  const theme: ThemeColors = {
    textPrimary: '#e5e7eb',
    textSecondary: '#9ca3af',
    border: '#374151',
    borderMuted: '#374151',
    bgPrimary: '#111827',
    accent: '#06b6d4',
  };

  const palette = [
    '#3B82F6', '#10B981', '#8B5CF6', '#F59E0B',
    '#EC4899', '#06B6D4', '#F43F5E', '#64748B',
  ];

  const data: ChartData = {
    labels: ['00:00', '01:00', '02:00'],
    datasets: Array.from({ length: 8 }, (_, i) => ({
      label: `model-${i + 1}`,
      data: [i + 1, (i + 1) * 2, (i + 1) * 3],
      borderColor: palette[i] as string,
      backgroundColor: 'transparent',
      fill: true,
      tension: 0.35,
    })),
  };

  it('returns a legend with 8 entries and built-in all/inverse selector', () => {
    const option = buildEChartsTrendOption(data, theme, { isNarrowScreen: false });
    const legend = option.legend as { data: string[]; selector: string[] };
    expect(legend).toBeDefined();
    expect(legend.data).toHaveLength(8);
    expect(legend.selector).toEqual(expect.arrayContaining(['all', 'inverse']));
  });

  it('configures per-series emphasis.focus and blur.opacity', () => {
    const option = buildEChartsTrendOption(data, theme, { isNarrowScreen: false });
    const series = option.series as Array<{
      emphasis: { focus: string };
      blur: { lineStyle: { opacity: number } };
    }>;
    expect(series).toHaveLength(8);
    for (const s of series) {
      expect(s.emphasis.focus).toBe('series');
      expect(s.blur.lineStyle.opacity).toBe(0.15);
    }
  });

  it('uses a uniform line width of 1 across all series (stacked area)', () => {
    const option = buildEChartsTrendOption(data, theme, { isNarrowScreen: false });
    const series = option.series as Array<{ lineStyle: { width: number } }>;
    for (const s of series) {
      expect(s.lineStyle.width).toBe(1);
    }
  });
});

describe('buildEChartsTrendOption - tooltip formatter', () => {
  const theme: ThemeColors = {
    textPrimary: '#e5e7eb',
    textSecondary: '#9ca3af',
    border: '#374151',
    borderMuted: '#4b5563',
    bgPrimary: '#111827',
    accent: '#06b6d4',
  };

  const data: ChartData = {
    labels: ['00:00'],
    datasets: [
      { label: 'low',  data: [1],   borderColor: '#3B82F6', backgroundColor: '', fill: true, tension: 0.35 },
      { label: 'high', data: [100], borderColor: '#10B981', backgroundColor: '', fill: true, tension: 0.35 },
      { label: 'mid',  data: [50],  borderColor: '#8B5CF6', backgroundColor: '', fill: true, tension: 0.35 },
    ],
  };

  it('sorts rows by descending value and includes color + percentage', () => {
    const option = buildEChartsTrendOption(data, theme, { isNarrowScreen: false });
    const tooltip = option.tooltip as { formatter: (params: unknown) => string };
    const params = [
      { seriesName: 'low',  value: 1,   color: '#3B82F6', axisValueLabel: '00:00' },
      { seriesName: 'high', value: 100, color: '#10B981', axisValueLabel: '00:00' },
      { seriesName: 'mid',  value: 50,  color: '#8B5CF6', axisValueLabel: '00:00' },
    ];
    const html = tooltip.formatter(params as never);
    // Order: high (100), mid (50), low (1)
    const highIdx = html.indexOf('high');
    const midIdx  = html.indexOf('mid');
    const lowIdx  = html.indexOf('low');
    expect(highIdx).toBeGreaterThan(-1);
    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
    // Color swatch + percent markup present
    expect(html).toContain('#10B981');
    expect(html).toContain('66.2%'); // 100 / 151 ≈ 66.2
  });

  it('returns empty string for invalid params', () => {
    const option = buildEChartsTrendOption(data, theme, { isNarrowScreen: false });
    const tooltip = option.tooltip as { formatter: (p: unknown) => string };
    expect(tooltip.formatter([])).toBe('');
    expect(tooltip.formatter(null as never)).toBe('');
  });
});

describe('buildEChartsTrendOption - theme propagation', () => {
  const lightTheme: ThemeColors = {
    textPrimary: '#111827',
    textSecondary: '#6b7280',
    border: '#e5e7eb',
    borderMuted: '#d1d5db',
    bgPrimary: '#ffffff',
    accent: '#3b82f6',
  };

  const darkTheme: ThemeColors = {
    textPrimary: '#f9fafb',
    textSecondary: '#9ca3af',
    border: '#374151',
    borderMuted: '#4b5563',
    bgPrimary: '#111827',
    accent: '#06b6d4',
  };

  const data: ChartData = {
    labels: ['00:00'],
    datasets: [
      { label: 'm', data: [1], borderColor: '#000', backgroundColor: '', fill: true, tension: 0.35 },
    ],
  };

  it('propagates theme colors into legend text and tooltip background', () => {
    const lightOption = buildEChartsTrendOption(data, lightTheme, { isNarrowScreen: false });
    const darkOption = buildEChartsTrendOption(data, darkTheme, { isNarrowScreen: false });

    const lightLegend = lightOption.legend as { textStyle: { color: string } };
    const darkLegend = darkOption.legend as { textStyle: { color: string } };
    expect(lightLegend.textStyle.color).toBe(lightTheme.textPrimary);
    expect(darkLegend.textStyle.color).toBe(darkTheme.textPrimary);
    expect(lightLegend.textStyle.color).not.toBe(darkLegend.textStyle.color);

    const lightTooltip = lightOption.tooltip as { backgroundColor: string };
    const darkTooltip = darkOption.tooltip as { backgroundColor: string };
    expect(lightTooltip.backgroundColor).toBe(lightTheme.bgPrimary);
    expect(darkTooltip.backgroundColor).toBe(darkTheme.bgPrimary);
    expect(lightTooltip.backgroundColor).not.toBe(darkTooltip.backgroundColor);
  });
});
