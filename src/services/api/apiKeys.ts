/**
 * API 密钥管理
 */

import { apiClient } from './client';

export interface APIKeyRateLimits {
  rpm?: number;
  qps?: number;
  burst?: number;
}

export interface APIKeyConcurrencyLimits {
  max?: number;
  'queue-max'?: number;
  'queue-timeout-ms'?: number;
}

export interface APIKeyLifetimeTokenLimit {
  limit?: number;
}

export interface APIKeyPeriodicTokenLimit {
  limit?: number;
  window?: 'day' | 'month';
}

export interface APIKeyTokenLimits {
  lifetime?: APIKeyLifetimeTokenLimit;
  periodic?: APIKeyPeriodicTokenLimit;
}

export interface APIKeyLimitSettings {
  rate?: APIKeyRateLimits;
  concurrency?: APIKeyConcurrencyLimits;
  tokens?: APIKeyTokenLimits;
}

export interface APIKeyEntry {
  key: string;
  name?: string;
  description?: string;
  super?: boolean;
  models?: string[];
  limits?: APIKeyLimitSettings;
}

export interface APIKeyRuntimeEntry {
  key: string;
  name?: string;
  super?: boolean;
  models?: string[];
  rpm?: number;
  qps?: number;
  burst?: number;
  'concurrency-max'?: number;
  'queue-max'?: number;
  'queue-timeout-ms'?: number;
  'lifetime-limit'?: number;
  'lifetime-used': number;
  'periodic-limit'?: number;
  'periodic-window'?: string;
  'periodic-used': number;
  'periodic-from'?: string;
  'in-flight': number;
  queueing: number;
}

const normalizeModelPatterns = (input: unknown): string[] | undefined => {
  if (!Array.isArray(input)) return undefined;
  const seen = new Set<string>();
  const models: string[] = [];
  input.forEach((item) => {
    const value = String(item ?? '').trim().toLowerCase();
    if (!value || seen.has(value)) return;
    seen.add(value);
    models.push(value);
  });
  return models.length ? models : undefined;
};

const normalizeNumber = (input: unknown): number | undefined => {
  const value = Number(input);
  if (!Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  return Math.trunc(value);
};

const normalizeEntry = (raw: unknown): APIKeyEntry | null => {
  if (typeof raw === 'string') {
    const key = raw.trim();
    if (!key) return null;
    return { key };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const item = raw as Record<string, unknown>;
  const key = String(item.key ?? item['api-key'] ?? item.apiKey ?? '').trim();
  if (!key) return null;

  const rate = (item.limits as Record<string, unknown> | undefined)?.rate as
    | Record<string, unknown>
    | undefined;
  const concurrency = (item.limits as Record<string, unknown> | undefined)?.concurrency as
    | Record<string, unknown>
    | undefined;
  const tokens = (item.limits as Record<string, unknown> | undefined)?.tokens as
    | Record<string, unknown>
    | undefined;
  const periodicWindow = String(
    ((tokens?.periodic as Record<string, unknown> | undefined)?.window ?? '')
  ).trim();
  const normalizedWindow =
    periodicWindow === 'day' || periodicWindow === 'month' ? periodicWindow : undefined;

  const entry: APIKeyEntry = {
    key,
    name: String(item.name ?? '').trim() || undefined,
    description: String(item.description ?? '').trim() || undefined,
    super: Boolean(item.super ?? false),
    models: normalizeModelPatterns(item.models)
  };

  const limits: APIKeyLimitSettings = {};
  const normalizedRate: APIKeyRateLimits = {
    rpm: normalizeNumber(rate?.rpm),
    qps: normalizeNumber(rate?.qps),
    burst: normalizeNumber(rate?.burst)
  };
  if (
    normalizedRate.rpm !== undefined ||
    normalizedRate.qps !== undefined ||
    normalizedRate.burst !== undefined
  ) {
    limits.rate = normalizedRate;
  }

  const normalizedConcurrency: APIKeyConcurrencyLimits = {
    max: normalizeNumber(concurrency?.max),
    'queue-max': normalizeNumber(concurrency?.['queue-max']),
    'queue-timeout-ms': normalizeNumber(concurrency?.['queue-timeout-ms'])
  };
  if (
    normalizedConcurrency.max !== undefined ||
    normalizedConcurrency['queue-max'] !== undefined ||
    normalizedConcurrency['queue-timeout-ms'] !== undefined
  ) {
    limits.concurrency = normalizedConcurrency;
  }

  const lifetimeLimit = normalizeNumber(
    (tokens?.lifetime as Record<string, unknown> | undefined)?.limit
  );
  const periodicLimit = normalizeNumber(
    (tokens?.periodic as Record<string, unknown> | undefined)?.limit
  );
  if (lifetimeLimit !== undefined || periodicLimit !== undefined || normalizedWindow) {
    limits.tokens = {
      lifetime: lifetimeLimit !== undefined ? { limit: lifetimeLimit } : undefined,
      periodic:
        periodicLimit !== undefined || normalizedWindow
          ? { limit: periodicLimit, window: normalizedWindow as 'day' | 'month' | undefined }
          : undefined
    };
  }

  if (limits.rate || limits.concurrency || limits.tokens) {
    entry.limits = limits;
  }
  return entry;
};

const parseAPIKeyEntries = (payload: Record<string, unknown>): APIKeyEntry[] => {
  const source = payload['api-keys'] ?? payload.apiKeys ?? payload.items ?? [];
  if (!Array.isArray(source)) return [];

  const seen = new Set<string>();
  const entries: APIKeyEntry[] = [];
  source.forEach((item) => {
    const parsed = normalizeEntry(item);
    if (!parsed) return;
    if (seen.has(parsed.key)) return;
    seen.add(parsed.key);
    entries.push(parsed);
  });
  return entries;
};

const sanitizeEntryForSubmit = (entry: APIKeyEntry): APIKeyEntry => {
  const normalized = normalizeEntry(entry);
  return normalized ?? { key: String(entry.key ?? '').trim() };
};

export const apiKeysApi = {
  async listEntries(): Promise<APIKeyEntry[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    return parseAPIKeyEntries(data);
  },

  async list(): Promise<string[]> {
    const entries = await this.listEntries();
    return entries.map((entry) => entry.key);
  },

  replaceEntries: (entries: APIKeyEntry[]) =>
    apiClient.put('/api-keys', entries.map((entry) => sanitizeEntryForSubmit(entry))),

  replace: (keys: string[]) => apiClient.put('/api-keys', keys),

  update: (index: number, value: string) => apiClient.patch('/api-keys', { index, value }),

  updateEntry: (index: number, entry: APIKeyEntry) =>
    apiClient.patch('/api-keys', { index, value: sanitizeEntryForSubmit(entry) }),

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),

  deleteByKey: (key: string) => apiClient.delete(`/api-keys?key=${encodeURIComponent(key)}`),

  async runtime(): Promise<APIKeyRuntimeEntry[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys/runtime');
    const source = data.items ?? [];
    if (!Array.isArray(source)) return [];
    return source
      .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      .map((item) => item as APIKeyRuntimeEntry);
  },

  resetTokens: (key?: string) =>
    apiClient.post('/api-keys/reset-tokens', key ? { key } : {})
};
