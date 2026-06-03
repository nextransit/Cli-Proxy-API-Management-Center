import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getThemeColors, type ThemeColors } from './themeBridge';

const setVar = (name: string, value: string) => {
  document.documentElement.style.setProperty(name, value);
};

const clearVar = (name: string) => {
  document.documentElement.style.removeProperty(name);
};

beforeEach(() => {
  setVar('--text-primary', '#ffffff');
  setVar('--text-secondary', '#a0aec0');
  setVar('--border-color', '#1a202c');
  setVar('--border-muted', '#0f172a');
  setVar('--bg-primary', '#000000');
  setVar('--accent', '#06b6d4');
});

afterEach(() => {
  [
    '--text-primary',
    '--text-secondary',
    '--border-color',
    '--border-muted',
    '--bg-primary',
    '--accent',
  ].forEach(clearVar);
});

describe('getThemeColors', () => {
  it('returns all expected color keys', () => {
    const colors: ThemeColors = getThemeColors();
    expect(colors).toHaveProperty('textPrimary');
    expect(colors).toHaveProperty('textSecondary');
    expect(colors).toHaveProperty('border');
    expect(colors).toHaveProperty('borderMuted');
    expect(colors).toHaveProperty('bgPrimary');
    expect(colors).toHaveProperty('accent');
  });

  it('reads the current values of CSS variables', () => {
    setVar('--text-primary', '#abcdef');
    const colors = getThemeColors();
    expect(colors.textPrimary).toBe('#abcdef');
    expect(colors.accent).toBe('#06b6d4');
  });

  it('returns empty strings when a variable is not set', () => {
    clearVar('--text-primary');
    const colors = getThemeColors();
    expect(colors.textPrimary).toBe('');
  });
});
