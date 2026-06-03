export interface ThemeColors {
  textPrimary: string;
  textSecondary: string;
  border: string;
  borderMuted: string;
  bgPrimary: string;
  accent: string;
}

const KEYS: Array<[keyof ThemeColors, string]> = [
  ['textPrimary', '--text-primary'],
  ['textSecondary', '--text-secondary'],
  ['border', '--border-color'],
  ['borderMuted', '--border-muted'],
  ['bgPrimary', '--bg-primary'],
  ['accent', '--accent'],
];

const readVar = (name: string): string => {
  if (typeof window === 'undefined' || typeof getComputedStyle === 'undefined') {
    return '';
  }
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
};

export function getThemeColors(): ThemeColors {
  const result = {} as ThemeColors;
  for (const [key, varName] of KEYS) {
    result[key] = readVar(varName);
  }
  return result;
}
