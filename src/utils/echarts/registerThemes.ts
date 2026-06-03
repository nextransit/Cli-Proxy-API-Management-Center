import * as echarts from 'echarts';

const FONT_FAMILY = 'Roboto Mono, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const buildBase = () => ({
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: FONT_FAMILY,
    color: '#e2e8f0',
  },
  color: ['#06b6d4', '#22d3ee', '#67e8f9', '#0891b2', '#a78bfa', '#f472b6', '#facc15', '#34d399'],
});

export const CLI_DARK_THEME: echarts.EChartsOption = {
  ...buildBase(),
  title: { textStyle: { color: '#e2e8f0' } },
  categoryAxis: {
    axisLine: { lineStyle: { color: '#1f2937' } },
    axisTick: { lineStyle: { color: '#1f2937' } },
    axisLabel: { color: 'rgba(226, 232, 240, 0.66)' },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: 'rgba(226, 232, 240, 0.58)' },
    splitLine: { lineStyle: { color: 'rgba(255, 255, 255, 0.06)' } },
  },
};

export const CLI_LIGHT_THEME: echarts.EChartsOption = {
  ...buildBase(),
  textStyle: { fontFamily: FONT_FAMILY, color: '#0f172a' },
  title: { textStyle: { color: '#0f172a' } },
  categoryAxis: {
    axisLine: { lineStyle: { color: 'rgba(17, 24, 39, 0.16)' } },
    axisTick: { lineStyle: { color: 'rgba(17, 24, 39, 0.16)' } },
    axisLabel: { color: 'rgba(17, 24, 39, 0.66)' },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: 'rgba(17, 24, 39, 0.58)' },
    splitLine: { lineStyle: { color: 'rgba(17, 24, 39, 0.06)' } },
  },
};

let registered = false;

export function registerCliThemes(): void {
  if (registered) return;
  echarts.registerTheme('cli-dark', CLI_DARK_THEME);
  echarts.registerTheme('cli-light', CLI_LIGHT_THEME);
  registered = true;
}
