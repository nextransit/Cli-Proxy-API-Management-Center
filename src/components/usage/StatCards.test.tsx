import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatCards } from './StatCards';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock('@/pages/UsagePage.module.scss', () => ({
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

describe('<StatCards /> aggregate consistency', () => {
  it('does not present retained detail samples as lifetime breakdowns', () => {
    const { container } = render(
      <StatCards
        usage={{
          total_requests: 601_203,
          success_count: 537_858,
          failure_count: 63_345,
          total_tokens: 82_062_672_391,
          apis: {
            key: {
              models: {
                model: {
                  details: [
                    {
                      timestamp: '2026-08-08T14:22:41+08:00',
                      latency_ms: 19_030,
                      failed: false,
                      tokens: {
                        input_tokens: 7_340_000,
                        output_tokens: 18_100,
                        total_tokens: 7_358_100,
                      },
                    },
                  ],
                },
              },
            },
          },
        }}
        modelPrices={{ model: { input: 1, output: 1, cached_input: 0 } }}
      />
    );

    expect(container.textContent).toContain('601.2K');
    expect(container.textContent).toContain('✓ 537,858');
    expect(container.textContent).toContain('! 63,345');
    expect(container.textContent).toContain('usage_stats.input_short: --');
    expect(container.textContent).toContain('usage_stats.output_short: --');
    expect(container.textContent).not.toContain('$0.097');
  });

  it('hides partial outcome counts for a filtered aggregate window', () => {
    const { container } = render(
      <StatCards
        usage={{
          total_requests: 1_804,
          success_count: 688,
          failure_count: 36,
          total_tokens: 1_009_167_601,
          apis: {
            key: {
              models: {
                model: {
                  details: [
                    {
                      timestamp: '2026-08-08T15:10:00+08:00',
                      latency_ms: 8_000,
                      failed: false,
                      tokens: {
                        input_tokens: 100,
                        output_tokens: 20,
                        total_tokens: 120,
                      },
                    },
                  ],
                },
              },
            },
          },
        }}
        modelPrices={{ model: { input: 1, output: 1, cached_input: 0 } }}
      />
    );

    expect(container.textContent).toContain('1.8K');
    expect(container.textContent).toContain('✓ --');
    expect(container.textContent).toContain('! --');
    expect(container.textContent).toContain('usage_stats.avg_latency_short: --');
    expect(container.textContent).toContain('usage_stats.input_short: --');
    expect(container.textContent).toContain('usage_stats.output_short: --');
  });
});
