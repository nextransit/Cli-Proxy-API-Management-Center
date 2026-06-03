import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock echarts to avoid canvas operations in jsdom.
vi.mock('echarts', () => {
  const init = vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  }));
  const registerTheme = vi.fn();
  return {
    default: { init, registerTheme },
    init,
    registerTheme,
  };
});

import { TelemetryChart } from './TelemetryChart';

describe('<TelemetryChart />', () => {
  it('renders the title in the header', () => {
    render(
      <TelemetryChart title="METRIC // TREND" option={{ series: [] }} />,
    );
    expect(screen.getByText('METRIC // TREND')).toBeInTheDocument();
  });

  it('renders the extraControls slot to the right of the title', () => {
    render(
      <TelemetryChart
        title="METRIC // TREND"
        option={{ series: [] }}
        extraControls={<button>HR</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'HR' })).toBeInTheDocument();
  });

  it('renders a container div for the ECharts canvas mount', () => {
    const { container } = render(
      <TelemetryChart title="METRIC // TREND" option={{ series: [] }} />,
    );
    // Find the div with the canvasMount class. Match by data attribute to avoid coupling to CSS module hashes.
    const mount = container.querySelector('[data-testid="echarts-mount"]');
    expect(mount).toBeInTheDocument();
  });

  it('passes the loading flag through to the indicator dot styling', () => {
    const { container } = render(
      <TelemetryChart title="METRIC // TREND" option={{ series: [] }} loading />,
    );
    // The dot has a data-loading attribute when loading.
    const dot = container.querySelector('[data-loading="true"]');
    expect(dot).toBeInTheDocument();
  });
});
