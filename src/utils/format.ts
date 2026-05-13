import { parseTimestamp } from './timestamp';

/**
 * Formatting utilities migrated from the original string helpers.
 */

const resolveDefaultLocale = (): string | undefined => {
  const fromDocument =
    typeof document !== 'undefined' ? document.documentElement?.lang?.trim() : '';
  if (fromDocument) return fromDocument;
  const fromNavigator = typeof navigator !== 'undefined' ? navigator.language?.trim() : '';
  return fromNavigator || undefined;
};

export function parseValidDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  const date =
    value instanceof Date
      ? value
      : parseTimestamp(value) ?? new Date(String(value));

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Hide the middle part of an API key and keep only the first and last characters.
 */
export function maskApiKey(key: string): string {
  const trimmed = String(key || '').trim();
  if (!trimmed) {
    return '';
  }

  const MASKED_LENGTH = 10;
  const visibleChars = trimmed.length < 4 ? 1 : 2;
  const start = trimmed.slice(0, visibleChars);
  const end = trimmed.slice(-visibleChars);
  const maskedLength = Math.max(MASKED_LENGTH - visibleChars * 2, 1);
  const masked = '*'.repeat(maskedLength);

  return `${start}${masked}${end}`;
}

/**
 * Format a byte count as a human-readable file size.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Format a date and time value.
 */
export function formatDateTime(date: string | Date, locale?: string): string {
  const d = typeof date === 'string' ? parseTimestamp(date) ?? new Date(date) : date;

  if (isNaN(d.getTime())) {
    return '';
  }

  const resolvedLocale = locale?.trim() || resolveDefaultLocale();
  return d.toLocaleString(resolvedLocale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Format a date-like value and return an explicit fallback when the value is absent or invalid.
 */
export function formatDateTimeOrFallback(
  value: unknown,
  locale?: string,
  fallback = '-'
): string {
  const date = parseValidDate(value);
  if (!date) return fallback;

  const resolvedLocale = locale?.trim() || resolveDefaultLocale();
  return date.toLocaleString(resolvedLocale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Format a date-like value as a calendar date and hide invalid build metadata.
 */
export function formatDateOrFallback(
  value: unknown,
  locale?: string,
  fallback = ''
): string {
  const date = parseValidDate(value);
  if (!date) return fallback;

  const resolvedLocale = locale?.trim() || resolveDefaultLocale();
  return date.toLocaleDateString(resolvedLocale);
}

/**
 * Format Unix timestamps in seconds, milliseconds, microseconds, or nanoseconds.
 */
export function formatUnixTimestamp(value: unknown, locale?: string): string {
  if (value === null || value === undefined || value === '') return '';

  const asNumber = typeof value === 'number' ? value : Number(value);
  const date = (() => {
    if (!Number.isFinite(asNumber) || Number.isNaN(asNumber)) {
      return parseTimestamp(value) ?? new Date(String(value));
    }

    const abs = Math.abs(asNumber);

    // 秒：常见 10 位（~1e9）
    if (abs < 1e11) return new Date(asNumber * 1000);

    // 毫秒：常见 13 位（~1e12）
    if (abs < 1e14) return new Date(asNumber);

    // 微秒：常见 16 位（~1e15）
    if (abs < 1e17) return new Date(Math.round(asNumber / 1000));

    // 纳秒：常见 19 位（~1e18）
    return new Date(Math.round(asNumber / 1e6));
  })();

  if (Number.isNaN(date.getTime())) return '';
  return locale ? date.toLocaleString(locale) : date.toLocaleString();
}

/**
 * Format a number with locale-aware grouping.
 */
export function formatNumber(num: number, locale?: string): string {
  const resolvedLocale = locale?.trim() || resolveDefaultLocale();
  return num.toLocaleString(resolvedLocale);
}

/**
 * Truncate long text and append an ellipsis.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
}
