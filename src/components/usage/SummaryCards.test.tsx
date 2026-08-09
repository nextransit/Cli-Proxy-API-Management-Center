import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SummaryCards } from './SummaryCards';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: string) => fallback ?? key,
    }),
  };
});

vi.mock('@/pages/UsagePage.module.scss', () => ({
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

describe('<SummaryCards /> daily aggregates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T15:00:00+08:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prefers persisted day totals and hides incomplete cost', () => {
    const { container } = render(
      <SummaryCards
        usage={{
          requests_by_day: {
            '2026-08-07': 135,
            '2026-08-08': 1_234,
          },
          tokens_by_day: {
            '2026-08-07': 10_000,
            '2026-08-08': 369_431_771,
          },
          apis: {
            key: {
              models: {
                model: {
                  details: [
                    {
                      timestamp: '2026-08-08T14:22:41+08:00',
                      tokens: {
                        input_tokens: 10,
                        output_tokens: 5,
                        total_tokens: 15,
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

    expect(container.textContent).toContain('1,234');
    expect(container.textContent).toContain('369.43M');
    expect(container.textContent).toContain('usage_stats.today_cost--');
  });
});
