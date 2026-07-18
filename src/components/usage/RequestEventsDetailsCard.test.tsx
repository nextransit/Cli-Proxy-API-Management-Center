import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RequestEventsDetailsCard } from './RequestEventsDetailsCard';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock('@/services/api/authFiles', () => ({
  authFilesApi: {
    list: vi.fn(async () => ({ files: [] })),
  },
}));

vi.mock('@/components/RequestTraceDrawer', () => ({
  RequestTraceDrawer: () => null,
}));

vi.mock('@/components/ui/Select', () => ({
  Select: () => null,
}));

vi.mock('@/pages/UsagePage.module.scss', () => ({
  default: new Proxy({}, { get: (_target, property) => String(property) }),
}));

const buildUsage = (details: Array<Record<string, unknown>>) => ({
  apis: {
    'POST /v1/responses': {
      models: {
        'gpt-test': {
          details,
        },
      },
    },
  },
});

const buildDetail = (timestamp: string, latencyMs: number) => ({
  timestamp,
  source: 'codex',
  auth_index: 'account-1',
  status_code: 200,
  latency_ms: latencyMs,
  tokens: {
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
  },
});

const renderCard = (usage: unknown) => (
  <RequestEventsDetailsCard
    usage={usage}
    loading={false}
    geminiKeys={[]}
    claudeConfigs={[]}
    codexConfigs={[]}
    vertexConfigs={[]}
    openaiProviders={[]}
  />
);

describe('<RequestEventsDetailsCard /> live updates', () => {
  it('scrolls the event list to the top only when event content changes', async () => {
    const firstDetail = buildDetail('2026-07-16T10:00:00Z', 1200);
    const { rerender } = render(renderCard(buildUsage([firstDetail])));
    const table = screen.getByRole('table');
    const tableWrapper = table.parentElement;

    expect(tableWrapper).not.toBeNull();
    if (!tableWrapper) return;

    tableWrapper.scrollTop = 180;
    rerender(renderCard(buildUsage([{ ...firstDetail }])));
    expect(tableWrapper.scrollTop).toBe(180);

    rerender(
      renderCard(
        buildUsage([
          firstDetail,
          buildDetail('2026-07-16T10:00:01Z', 900),
        ])
      )
    );

    await waitFor(() => {
      expect(tableWrapper.scrollTop).toBe(0);
    });
  });
});
