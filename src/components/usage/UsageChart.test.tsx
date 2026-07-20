import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { EChartsOption } from 'echarts';
import { UsageChart } from './UsageChart';
import {
  MODEL_TREND_PALETTE,
  TAIL_LINE_COLOR,
} from '@/utils/usage/chartPalette';
import type { UsageDetail } from '@/utils/usage';

// Capture the option that <UsageChart /> hands to the chart container so the
// test can assert on per-dataset colors without mounting ECharts.
const lastOptionRef: { current: EChartsOption | null } = { current: null };

vi.mock('@/components/charts/TelemetryChart', () => ({
  TelemetryChart: (props: { option: EChartsOption }) => {
    lastOptionRef.current = props.option;
    return <div data-testid="mock-telemetry-chart" />;
  },
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

const NINE_MODEL_NAMES = [
  'model-a', // rank 0 → highest requests
  'model-b',
  'model-c',
  'model-d',
  'model-e',
  'model-f',
  'model-g',
  'model-h', // rank 7
  'model-i', // rank 8 → tail
];

// Decreasing request counts so the natural input order matches descending rank
// for the top 8 models; model-i is the lowest at rank 8.
const REQUESTS_PER_MODEL = [900, 800, 700, 600, 500, 400, 300, 200, 100];

const buildDetails = (
  baseTimestamp: number,
  modelNames: string[],
  requestsPerModel: number[],
): UsageDetail[] => {
  const details: UsageDetail[] = [];
  modelNames.forEach((modelName, modelIndex) => {
    const requests = requestsPerModel[modelIndex] ?? 0;
    for (let i = 0; i < requests; i += 1) {
      details.push({
        timestamp: new Date(baseTimestamp).toISOString(),
        source: 'openai',
        auth_index: `auth-${modelIndex}`,
        tokens: {
          input_tokens: 1,
          output_tokens: 1,
          reasoning_tokens: 0,
          cached_tokens: 0,
          total_tokens: 2,
        },
        failed: false,
        __modelName: modelName,
        __timestampMs: baseTimestamp + i * 1000,
      });
    }
  });
  return details;
};

const renderUsageChart = (
  scopedDetails: UsageDetail[],
  resolvedChartLines: string[],
) => {
  lastOptionRef.current = null;
  return render(
    <UsageChart
      title="Token Volume"
      metric="requests"
      scopedDetails={scopedDetails}
      chartCompareMode="model"
      clientApiKeyInfoMap={new Map()}
      resolvedChartLines={resolvedChartLines}
      hourWindowHours={1}
      focusedModel={null}
      loading={false}
      isMobile={false}
      isNarrowScreen={false}
      emptyText="no data"
      timeRange="24h"
      period="hour"
      onPeriodChange={() => undefined}
      cardId="test-usage-chart"
    />,
  );
};

const getSeriesColors = (option: EChartsOption): string[] => {
  const series = option.series as Array<{ lineStyle?: { color?: string } }> | undefined;
  if (!Array.isArray(series)) return [];
  return series.map((entry) => entry.lineStyle?.color ?? '');
};

describe('<UsageChart /> rank-based coloring', () => {
  it('assigns each dataset a color from MODEL_TREND_PALETTE based on its rank', () => {
    // Use a fixed recent timestamp so the generated hour labels are deterministic.
    const baseTimestamp = Date.UTC(2026, 6, 15, 10, 0, 0); // 2026-07-15 10:00:00Z
    const scopedDetails = buildDetails(
      baseTimestamp,
      NINE_MODEL_NAMES,
      REQUESTS_PER_MODEL,
    );

    renderUsageChart(scopedDetails, [...NINE_MODEL_NAMES]);

    const option = lastOptionRef.current;
    expect(option).not.toBeNull();
    if (!option) return;

    const colors = getSeriesColors(option);
    expect(colors).toHaveLength(9);
    expect(colors[0]).toBe(MODEL_TREND_PALETTE[0]);
    expect(colors[7]).toBe(MODEL_TREND_PALETTE[7]);
    expect(colors[8]).toBe(TAIL_LINE_COLOR);
  });
});