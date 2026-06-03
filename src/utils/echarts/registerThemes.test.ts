import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('echarts', () => ({
  registerTheme: vi.fn(),
}));

import * as echarts from 'echarts';

const registerThemeMock = echarts.registerTheme as unknown as ReturnType<typeof vi.fn>;

describe('registerCliThemes', () => {
  beforeEach(async () => {
    vi.resetModules();
    registerThemeMock.mockClear();
    await import('./registerThemes');
  });

  afterEach(() => {
    registerThemeMock.mockClear();
  });

  it('registers both cli-dark and cli-light themes on first call', async () => {
    const { registerCliThemes, CLI_DARK_THEME, CLI_LIGHT_THEME } = await import('./registerThemes');
    registerCliThemes();
    expect(registerThemeMock).toHaveBeenCalledWith('cli-dark', CLI_DARK_THEME);
    expect(registerThemeMock).toHaveBeenCalledWith('cli-light', CLI_LIGHT_THEME);
  });

  it('is idempotent across multiple calls (registers only once)', async () => {
    const { registerCliThemes } = await import('./registerThemes');
    registerCliThemes();
    registerCliThemes();
    registerCliThemes();
    expect(registerThemeMock).toHaveBeenCalledTimes(2);
  });

  it('cli-dark and cli-light expose the same baseline option keys', async () => {
    const { CLI_DARK_THEME, CLI_LIGHT_THEME } = await import('./registerThemes');
    for (const key of ['backgroundColor', 'textStyle']) {
      expect(CLI_DARK_THEME).toHaveProperty(key);
      expect(CLI_LIGHT_THEME).toHaveProperty(key);
    }
  });
});
