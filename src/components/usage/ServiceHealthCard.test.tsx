import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ServiceHealthCard } from './ServiceHealthCard';

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

describe('<ServiceHealthCard /> aggregate consistency', () => {
  it('hides health totals when retained details are incomplete', () => {
    const { container } = render(
      <ServiceHealthCard
        usage={{
          total_requests: 100,
          apis: {
            key: {
              models: {
                model: {
                  details: [
                    {
                      timestamp: '2026-08-08T15:10:00+08:00',
                      failed: false,
                    },
                  ],
                },
              },
            },
          },
        }}
        loading={false}
        collapsible
        defaultCollapsed
      />
    );

    expect(container.textContent).toContain('status_bar.success_short --');
    expect(container.textContent).toContain('status_bar.failure_short --');
    expect(container.textContent).not.toContain('100.0%');
  });
});
