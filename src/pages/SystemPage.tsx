import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Input } from '@/components/ui/Input';
import { Select, type SelectOption } from '@/components/ui/Select';
import { IconGithub, IconBookOpen, IconExternalLink, IconCode, IconX } from '@/components/ui/icons';
import {
  useAuthStore,
  useConfigStore,
  useNotificationStore,
  useModelsStore,
  useThemeStore,
} from '@/stores';
import { configApi, versionApi } from '@/services/api';
import { apiKeysApi, type APIKeyEntry, type APIKeyRuntimeEntry } from '@/services/api/apiKeys';
import { classifyModels } from '@/utils/models';
import { STORAGE_KEY_AUTH } from '@/utils/constants';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import iconGemini from '@/assets/icons/gemini.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconGlm from '@/assets/icons/glm.svg';
import iconGrok from '@/assets/icons/grok.svg';
import iconDeepseek from '@/assets/icons/deepseek.svg';
import iconMinimax from '@/assets/icons/minimax.svg';
import styles from './SystemPage.module.scss';

const MODEL_CATEGORY_ICONS: Record<string, string | { light: string; dark: string }> = {
  gpt: { light: iconOpenaiLight, dark: iconOpenaiDark },
  claude: iconClaude,
  gemini: iconGemini,
  qwen: iconQwen,
  kimi: { light: iconKimiLight, dark: iconKimiDark },
  glm: iconGlm,
  grok: iconGrok,
  deepseek: iconDeepseek,
  minimax: iconMinimax,
};

const parseVersionSegments = (version?: string | null) => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

const compareVersions = (latest?: string | null, current?: string | null) => {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return 1;
    if (l < c) return -1;
  }
  return 0;
};

interface APIKeyPolicyFormState {
  key: string;
  name: string;
  description: string;
  superKey: boolean;
  modelsText: string;
  rpm: string;
  qps: string;
  burst: string;
  concurrencyMax: string;
  queueMax: string;
  queueTimeoutMs: string;
  lifetimeLimit: string;
  periodicLimit: string;
  periodicWindow: '' | 'day' | 'month';
}

const DEFAULT_API_KEY_FORM: APIKeyPolicyFormState = {
  key: '',
  name: '',
  description: '',
  superKey: false,
  modelsText: '',
  rpm: '',
  qps: '',
  burst: '',
  concurrencyMax: '',
  queueMax: '',
  queueTimeoutMs: '',
  lifetimeLimit: '',
  periodicLimit: '',
  periodicWindow: '',
};

const parseIntegerField = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed < 0 ? 0 : parsed;
};

const splitModelsText = (text: string): string[] | undefined => {
  const seen = new Set<string>();
  const models = text
    .split(/[\n,]/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
  return models.length ? models : undefined;
};

const normalizeModelPattern = (value: string): string => value.trim().toLowerCase();

const trimUndefined = (value: string): string | undefined => {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeAPIKeyEntryForSubmit = (entry: APIKeyEntry): APIKeyEntry => {
  const normalized: APIKeyEntry = {
    key: entry.key.trim(),
    name: trimUndefined(entry.name ?? ''),
    description: trimUndefined(entry.description ?? ''),
    super: Boolean(entry.super),
    models: entry.models?.length ? entry.models : undefined,
  };

  const rate = entry.limits?.rate;
  const concurrency = entry.limits?.concurrency;
  const tokens = entry.limits?.tokens;

  const normalizedRate = {
    rpm: rate?.rpm,
    qps: rate?.qps,
    burst: rate?.burst,
  };
  const normalizedConcurrency = {
    max: concurrency?.max,
    'queue-max': concurrency?.['queue-max'],
    'queue-timeout-ms': concurrency?.['queue-timeout-ms'],
  };
  const normalizedTokens = {
    lifetime: tokens?.lifetime?.limit !== undefined ? { limit: tokens.lifetime.limit } : undefined,
    periodic:
      tokens?.periodic?.limit !== undefined || tokens?.periodic?.window
        ? {
            limit: tokens?.periodic?.limit,
            window: tokens?.periodic?.window,
          }
        : undefined,
  };

  const hasRate =
    normalizedRate.rpm !== undefined ||
    normalizedRate.qps !== undefined ||
    normalizedRate.burst !== undefined;
  const hasConcurrency =
    normalizedConcurrency.max !== undefined ||
    normalizedConcurrency['queue-max'] !== undefined ||
    normalizedConcurrency['queue-timeout-ms'] !== undefined;
  const hasTokens = normalizedTokens.lifetime || normalizedTokens.periodic;

  if (hasRate || hasConcurrency || hasTokens) {
    normalized.limits = {};
    if (hasRate) normalized.limits.rate = normalizedRate;
    if (hasConcurrency) normalized.limits.concurrency = normalizedConcurrency;
    if (hasTokens) normalized.limits.tokens = normalizedTokens;
  }
  return normalized;
};

const formToAPIKeyEntry = (form: APIKeyPolicyFormState): APIKeyEntry => {
  const entry: APIKeyEntry = {
    key: form.key.trim(),
    name: trimUndefined(form.name),
    description: trimUndefined(form.description),
    super: form.superKey,
    models: splitModelsText(form.modelsText),
    limits: {
      rate: {
        rpm: parseIntegerField(form.rpm),
        qps: parseIntegerField(form.qps),
        burst: parseIntegerField(form.burst),
      },
      concurrency: {
        max: parseIntegerField(form.concurrencyMax),
        'queue-max': parseIntegerField(form.queueMax),
        'queue-timeout-ms': parseIntegerField(form.queueTimeoutMs),
      },
      tokens: {
        lifetime: { limit: parseIntegerField(form.lifetimeLimit) },
        periodic: {
          limit: parseIntegerField(form.periodicLimit),
          window: form.periodicWindow || undefined,
        },
      },
    },
  };
  return normalizeAPIKeyEntryForSubmit(entry);
};

const entryToForm = (entry: APIKeyEntry): APIKeyPolicyFormState => ({
  key: entry.key ?? '',
  name: entry.name ?? '',
  description: entry.description ?? '',
  superKey: Boolean(entry.super),
  modelsText: Array.isArray(entry.models) ? entry.models.join('\n') : '',
  rpm: entry.limits?.rate?.rpm !== undefined ? String(entry.limits.rate.rpm) : '',
  qps: entry.limits?.rate?.qps !== undefined ? String(entry.limits.rate.qps) : '',
  burst: entry.limits?.rate?.burst !== undefined ? String(entry.limits.rate.burst) : '',
  concurrencyMax:
    entry.limits?.concurrency?.max !== undefined ? String(entry.limits.concurrency.max) : '',
  queueMax:
    entry.limits?.concurrency?.['queue-max'] !== undefined
      ? String(entry.limits.concurrency['queue-max'])
      : '',
  queueTimeoutMs:
    entry.limits?.concurrency?.['queue-timeout-ms'] !== undefined
      ? String(entry.limits.concurrency['queue-timeout-ms'])
      : '',
  lifetimeLimit:
    entry.limits?.tokens?.lifetime?.limit !== undefined
      ? String(entry.limits.tokens.lifetime.limit)
      : '',
  periodicLimit:
    entry.limits?.tokens?.periodic?.limit !== undefined
      ? String(entry.limits.tokens.periodic.limit)
      : '',
  periodicWindow:
    entry.limits?.tokens?.periodic?.window === 'day' ||
    entry.limits?.tokens?.periodic?.window === 'month'
      ? entry.limits.tokens.periodic.window
      : '',
});

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const auth = useAuthStore();
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [modelStatus, setModelStatus] = useState<{
    type: 'success' | 'warning' | 'error' | 'muted';
    message: string;
  }>();
  const [requestLogModalOpen, setRequestLogModalOpen] = useState(false);
  const [requestLogDraft, setRequestLogDraft] = useState(false);
  const [requestLogTouched, setRequestLogTouched] = useState(false);
  const [requestLogSaving, setRequestLogSaving] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeysLoaded, setApiKeysLoaded] = useState(false);
  const [apiKeysError, setApiKeysError] = useState('');
  const [apiKeyEntries, setApiKeyEntries] = useState<APIKeyEntry[]>([]);
  const [apiKeyRuntimeLoading, setApiKeyRuntimeLoading] = useState(false);
  const [apiKeyRuntimeError, setApiKeyRuntimeError] = useState('');
  const [apiKeyRuntimeEntries, setApiKeyRuntimeEntries] = useState<APIKeyRuntimeEntry[]>([]);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);
  const [apiKeyModalSaving, setApiKeyModalSaving] = useState(false);
  const [apiKeyModalIndex, setApiKeyModalIndex] = useState<number | null>(null);
  const [apiKeyForm, setApiKeyForm] = useState<APIKeyPolicyFormState>(DEFAULT_API_KEY_FORM);
  const [modelWhitelistSearch, setModelWhitelistSearch] = useState('');
  const [customModelPattern, setCustomModelPattern] = useState('');
  const [resettingTokenKey, setResettingTokenKey] = useState('');
  const [resettingAllTokens, setResettingAllTokens] = useState(false);

  const apiKeysCache = useRef<string[]>([]);
  const versionTapCount = useRef(0);
  const versionTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);
  const requestLogEnabled = config?.requestLog ?? false;
  const requestLogDirty = requestLogDraft !== requestLogEnabled;
  const canEditRequestLog = auth.connectionStatus === 'connected' && Boolean(config);
  const canManageApiKeyPolicies = auth.connectionStatus === 'connected';
  const isEditingApiKey = apiKeyModalIndex !== null;
  const apiKeyRuntimeMap = useMemo(() => {
    const map = new Map<string, APIKeyRuntimeEntry>();
    apiKeyRuntimeEntries.forEach((item) => {
      map.set(item.key, item);
    });
    return map;
  }, [apiKeyRuntimeEntries]);
  const periodicWindowOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: t('system_info.api_key_field_periodic_window_none') },
      { value: 'day', label: t('system_info.api_key_runtime_window_day') },
      { value: 'month', label: t('system_info.api_key_runtime_window_month') },
    ],
    [t]
  );
  const policyLimitsDisabled = apiKeyForm.superKey;
  const selectedModelPatterns = useMemo(
    () => splitModelsText(apiKeyForm.modelsText) ?? [],
    [apiKeyForm.modelsText]
  );
  const selectedModelPatternSet = useMemo(
    () => new Set(selectedModelPatterns),
    [selectedModelPatterns]
  );
  const availableModelOptions = useMemo(() => {
    const seen = new Set<string>();
    return models
      .map((model) => ({
        ...model,
        normalizedName: normalizeModelPattern(model.name),
      }))
      .filter((model) => {
        if (!model.normalizedName || seen.has(model.normalizedName)) return false;
        seen.add(model.normalizedName);
        return true;
      })
      .sort((a, b) => a.normalizedName.localeCompare(b.normalizedName));
  }, [models]);
  const filteredAvailableModelOptions = useMemo(() => {
    const keyword = modelWhitelistSearch.trim().toLowerCase();
    if (!keyword) return availableModelOptions;
    return availableModelOptions.filter((model) => {
      const haystack = `${model.name} ${model.alias ?? ''} ${model.description ?? ''}`.toLowerCase();
      return haystack.includes(keyword);
    });
  }, [availableModelOptions, modelWhitelistSearch]);

  const appVersion = __APP_VERSION__ || t('system_info.version_unknown');
  const apiVersion = auth.serverVersion || t('system_info.version_unknown');
  const buildTime = auth.serverBuildDate
    ? new Date(auth.serverBuildDate).toLocaleString(i18n.language)
    : t('system_info.version_unknown');

  const getIconForCategory = (categoryId: string): string | null => {
    const iconEntry = MODEL_CATEGORY_ICONS[categoryId];
    if (!iconEntry) return null;
    if (typeof iconEntry === 'string') return iconEntry;
    return resolvedTheme === 'dark' ? iconEntry.dark : iconEntry.light;
  };

  const normalizeApiKeyList = useCallback((input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];

    input.forEach((item) => {
      const record =
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      const value =
        typeof item === 'string'
          ? item
          : record
            ? (record['api-key'] ?? record['apiKey'] ?? record.key ?? record.Key)
            : '';
      const trimmed = String(value ?? '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      keys.push(trimmed);
    });

    return keys;
  }, []);

  const resolveApiKeysForModels = useCallback(async () => {
    if (apiKeysCache.current.length) {
      return apiKeysCache.current;
    }

    const configKeys = normalizeApiKeyList(config?.apiKeys);
    if (configKeys.length) {
      apiKeysCache.current = configKeys;
      return configKeys;
    }

    try {
      const list = await apiKeysApi.list();
      const normalized = normalizeApiKeyList(list);
      if (normalized.length) {
        apiKeysCache.current = normalized;
      }
      return normalized;
    } catch (err) {
      console.warn('Auto loading API keys for models failed:', err);
      return [];
    }
  }, [config?.apiKeys, normalizeApiKeyList]);

  const syncApiKeysCache = useCallback(
    (entries: APIKeyEntry[]) => {
      apiKeysCache.current = normalizeApiKeyList(entries);
    },
    [normalizeApiKeyList]
  );

  const fetchAPIKeyEntries = useCallback(async () => {
    if (!canManageApiKeyPolicies) {
      setApiKeysLoaded(false);
      setApiKeysError('');
      setApiKeyEntries([]);
      return;
    }
    setApiKeysLoading(true);
    setApiKeysLoaded(false);
    setApiKeysError('');
    try {
      const entries = await apiKeysApi.listEntries();
      setApiKeyEntries(entries);
      syncApiKeysCache(entries);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      setApiKeysError(`${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`);
    } finally {
      setApiKeysLoading(false);
      setApiKeysLoaded(true);
    }
  }, [canManageApiKeyPolicies, syncApiKeysCache, t]);

  const fetchAPIKeyRuntime = useCallback(async () => {
    if (!canManageApiKeyPolicies) {
      setApiKeyRuntimeError('');
      setApiKeyRuntimeEntries([]);
      return;
    }
    setApiKeyRuntimeLoading(true);
    setApiKeyRuntimeError('');
    try {
      const runtime = await apiKeysApi.runtime();
      setApiKeyRuntimeEntries(runtime);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      setApiKeyRuntimeError(`${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`);
    } finally {
      setApiKeyRuntimeLoading(false);
    }
  }, [canManageApiKeyPolicies, t]);

  const openAPIKeyCreateModal = useCallback(() => {
    setApiKeyModalIndex(null);
    setApiKeyForm({ ...DEFAULT_API_KEY_FORM });
    setModelWhitelistSearch('');
    setCustomModelPattern('');
    setApiKeyModalOpen(true);
  }, []);

  const openAPIKeyEditModal = useCallback((entry: APIKeyEntry, index: number) => {
    setApiKeyModalIndex(index);
    setApiKeyForm(entryToForm(entry));
    setModelWhitelistSearch('');
    setCustomModelPattern('');
    setApiKeyModalOpen(true);
  }, []);

  const closeAPIKeyModal = useCallback(() => {
    if (apiKeyModalSaving) return;
    setApiKeyModalOpen(false);
    setApiKeyModalIndex(null);
    setApiKeyForm({ ...DEFAULT_API_KEY_FORM });
    setModelWhitelistSearch('');
    setCustomModelPattern('');
  }, [apiKeyModalSaving]);

  const addModelToWhitelist = useCallback((value: string) => {
    const normalized = normalizeModelPattern(value);
    if (!normalized) return;
    setApiKeyForm((prev) => {
      const current = splitModelsText(prev.modelsText) ?? [];
      if (current.includes(normalized)) return prev;
      return {
        ...prev,
        modelsText: [...current, normalized].join('\n'),
      };
    });
  }, []);

  const removeModelFromWhitelist = useCallback((value: string) => {
    const normalized = normalizeModelPattern(value);
    if (!normalized) return;
    setApiKeyForm((prev) => {
      const current = splitModelsText(prev.modelsText) ?? [];
      return {
        ...prev,
        modelsText: current.filter((item) => item !== normalized).join('\n'),
      };
    });
  }, []);

  const addCustomModelPattern = useCallback(() => {
    const normalized = normalizeModelPattern(customModelPattern);
    if (!normalized) return;
    addModelToWhitelist(normalized);
    setCustomModelPattern('');
  }, [addModelToWhitelist, customModelPattern]);

  const formatRuntimeDate = useCallback(
    (value?: string) => {
      if (!value) return '-';
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return value;
      return parsed.toLocaleString(i18n.language);
    },
    [i18n.language]
  );

  const formatPeriodicWindow = useCallback(
    (windowValue?: string) => {
      if (windowValue === 'day') return t('system_info.api_key_runtime_window_day');
      if (windowValue === 'month') return t('system_info.api_key_runtime_window_month');
      return t('system_info.api_key_runtime_not_configured');
    },
    [t]
  );

  const handleSaveAPIKeyPolicy = useCallback(async () => {
    if (!canManageApiKeyPolicies) return;
    const nextEntry = formToAPIKeyEntry(apiKeyForm);
    if (!nextEntry.key) {
      showNotification(`${t('notification.please_enter')} ${t('notification.api_key')}`, 'warning');
      return;
    }

    const duplicateIndex = apiKeyEntries.findIndex(
      (entry, index) => index !== apiKeyModalIndex && entry.key === nextEntry.key
    );
    if (duplicateIndex >= 0) {
      showNotification(t('system_info.api_key_policy_duplicate'), 'warning');
      return;
    }

    const nextEntries = [...apiKeyEntries];
    if (apiKeyModalIndex !== null) {
      nextEntries[apiKeyModalIndex] = nextEntry;
    } else {
      nextEntries.push(nextEntry);
    }

    setApiKeyModalSaving(true);
    try {
      await apiKeysApi.replaceEntries(nextEntries);
      setApiKeyEntries(nextEntries);
      syncApiKeysCache(nextEntries);
      showNotification(
        apiKeyModalIndex !== null
          ? t('notification.api_key_updated')
          : t('notification.api_key_added'),
        'success'
      );
      closeAPIKeyModal();
      void fetchAPIKeyRuntime();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      showNotification(
        `${apiKeyModalIndex !== null ? t('notification.update_failed') : t('notification.add_failed')}${
          message ? `: ${message}` : ''
        }`,
        'error'
      );
    } finally {
      setApiKeyModalSaving(false);
    }
  }, [
    apiKeyEntries,
    apiKeyForm,
    apiKeyModalIndex,
    canManageApiKeyPolicies,
    closeAPIKeyModal,
    fetchAPIKeyRuntime,
    showNotification,
    syncApiKeysCache,
    t,
  ]);

  const handleDeleteAPIKeyPolicy = useCallback(
    (entry: APIKeyEntry, index: number) => {
      showConfirmation({
        title: t('system_info.api_key_policy_title'),
        message: t('api_keys.delete_confirm'),
        variant: 'danger',
        confirmText: t('common.delete'),
        onConfirm: async () => {
          try {
            await apiKeysApi.deleteByKey(entry.key);
            const nextEntries = apiKeyEntries.filter((_, itemIndex) => itemIndex !== index);
            setApiKeyEntries(nextEntries);
            syncApiKeysCache(nextEntries);
            showNotification(t('notification.api_key_deleted'), 'success');
            void fetchAPIKeyRuntime();
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : typeof error === 'string' ? error : '';
            showNotification(
              `${t('notification.delete_failed')}${message ? `: ${message}` : ''}`,
              'error'
            );
          }
        },
      });
    },
    [apiKeyEntries, fetchAPIKeyRuntime, showConfirmation, showNotification, syncApiKeysCache, t]
  );

  const handleResetAPIKeyTokens = useCallback(
    async (apiKey?: string) => {
      if (!canManageApiKeyPolicies) return;
      if (apiKey) {
        setResettingTokenKey(apiKey);
      } else {
        setResettingAllTokens(true);
      }
      try {
        await apiKeysApi.resetTokens(apiKey);
        showNotification(t('system_info.api_key_runtime_tokens_reset_success'), 'success');
        await fetchAPIKeyRuntime();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : typeof error === 'string' ? error : '';
        showNotification(
          `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
      } finally {
        setResettingTokenKey('');
        setResettingAllTokens(false);
      }
    },
    [canManageApiKeyPolicies, fetchAPIKeyRuntime, showNotification, t]
  );

  const handleResetAllTokens = useCallback(() => {
    showConfirmation({
      title: t('system_info.api_key_runtime_reset_all'),
      message: t('system_info.api_key_runtime_reset_all_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        await handleResetAPIKeyTokens();
      },
    });
  }, [handleResetAPIKeyTokens, showConfirmation, t]);

  const fetchModels = async ({ forceRefresh = false }: { forceRefresh?: boolean } = {}) => {
    if (auth.connectionStatus !== 'connected') {
      setModelStatus({
        type: 'warning',
        message: t('notification.connection_required'),
      });
      return;
    }

    if (!auth.apiBase) {
      showNotification(t('notification.connection_required'), 'warning');
      return;
    }

    if (forceRefresh) {
      apiKeysCache.current = [];
    }

    setModelStatus({ type: 'muted', message: t('system_info.models_loading') });
    try {
      const apiKeys = await resolveApiKeysForModels();
      const candidateKeys = apiKeys.length ? apiKeys : [''];
      let list: Awaited<ReturnType<typeof fetchModelsFromStore>> = [];
      let lastError: unknown;

      for (let index = 0; index < candidateKeys.length; index += 1) {
        try {
          list = await fetchModelsFromStore(
            auth.apiBase,
            candidateKeys[index] || undefined,
            forceRefresh
          );
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (lastError) {
        throw lastError;
      }

      const hasModels = list.length > 0;
      setModelStatus({
        type: hasModels ? 'success' : 'warning',
        message: hasModels
          ? t('system_info.models_count', { count: list.length })
          : t('system_info.models_empty'),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
      const suffix = message ? `: ${message}` : '';
      const text = `${t('system_info.models_error')}${suffix}`;
      setModelStatus({ type: 'error', message: text });
    }
  };

  const handleClearLoginStorage = () => {
    showConfirmation({
      title: t('system_info.clear_login_title', { defaultValue: 'Clear Login Storage' }),
      message: t('system_info.clear_login_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: () => {
        auth.logout();
        if (typeof localStorage === 'undefined') return;
        const keysToRemove = [STORAGE_KEY_AUTH, 'isLoggedIn', 'apiBase', 'apiUrl', 'managementKey'];
        keysToRemove.forEach((key) => localStorage.removeItem(key));
        showNotification(t('notification.login_storage_cleared'), 'success');
      },
    });
  };

  const openRequestLogModal = useCallback(() => {
    setRequestLogTouched(false);
    setRequestLogDraft(requestLogEnabled);
    setRequestLogModalOpen(true);
  }, [requestLogEnabled]);

  const handleInfoVersionTap = useCallback(() => {
    versionTapCount.current += 1;
    if (versionTapTimer.current) {
      clearTimeout(versionTapTimer.current);
    }

    if (versionTapCount.current >= 7) {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
      openRequestLogModal();
      return;
    }

    versionTapTimer.current = setTimeout(() => {
      versionTapCount.current = 0;
      versionTapTimer.current = null;
    }, 1500);
  }, [openRequestLogModal]);

  const handleRequestLogClose = useCallback(() => {
    setRequestLogModalOpen(false);
    setRequestLogTouched(false);
  }, []);

  const handleRequestLogSave = async () => {
    if (!canEditRequestLog) return;
    if (!requestLogDirty) {
      setRequestLogModalOpen(false);
      return;
    }

    const previous = requestLogEnabled;
    setRequestLogSaving(true);
    updateConfigValue('request-log', requestLogDraft);

    try {
      await configApi.updateRequestLog(requestLogDraft);
      clearCache('request-log');
      showNotification(t('notification.request_log_updated'), 'success');
      setRequestLogModalOpen(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      updateConfigValue('request-log', previous);
      showNotification(
        `${t('notification.update_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRequestLogSaving(false);
    }
  };

  const handleVersionCheck = useCallback(async () => {
    setCheckingVersion(true);
    try {
      const data = await versionApi.checkLatest();
      const latestRaw = data?.['latest-version'] ?? data?.latest_version ?? data?.latest ?? '';
      const latest = typeof latestRaw === 'string' ? latestRaw : String(latestRaw ?? '');
      const comparison = compareVersions(latest, auth.serverVersion);

      if (!latest) {
        showNotification(t('system_info.version_check_error'), 'error');
        return;
      }

      if (comparison === null) {
        showNotification(t('system_info.version_current_missing'), 'warning');
        return;
      }

      if (comparison > 0) {
        showNotification(t('system_info.version_update_available', { version: latest }), 'warning');
      } else {
        showNotification(t('system_info.version_is_latest'), 'success');
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : typeof error === 'string' ? error : '';
      const suffix = message ? `: ${message}` : '';
      showNotification(`${t('system_info.version_check_error')}${suffix}`, 'error');
    } finally {
      setCheckingVersion(false);
    }
  }, [auth.serverVersion, showNotification, t]);

  useEffect(() => {
    fetchConfig().catch(() => {
      // ignore
    });
  }, [fetchConfig]);

  useEffect(() => {
    if (requestLogModalOpen && !requestLogTouched) {
      setRequestLogDraft(requestLogEnabled);
    }
  }, [requestLogModalOpen, requestLogTouched, requestLogEnabled]);

  useEffect(() => {
    return () => {
      if (versionTapTimer.current) {
        clearTimeout(versionTapTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!canManageApiKeyPolicies) {
      setApiKeysLoaded(false);
      setApiKeysError('');
      setApiKeyEntries([]);
      setApiKeyRuntimeError('');
      setApiKeyRuntimeEntries([]);
      return;
    }
    void fetchAPIKeyEntries();
    void fetchAPIKeyRuntime();
  }, [auth.apiBase, canManageApiKeyPolicies, fetchAPIKeyEntries, fetchAPIKeyRuntime]);

  useEffect(() => {
    if (canManageApiKeyPolicies && (!apiKeysLoaded || apiKeysLoading)) return;
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    auth.connectionStatus,
    auth.apiBase,
    canManageApiKeyPolicies,
    apiKeysLoaded,
    apiKeysLoading,
    apiKeyEntries.length,
  ]);

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('system_info.title')}</h1>
      <div className={styles.content}>
        <Card className={styles.aboutCard}>
          <div className={styles.aboutHeader}>
            <img src={INLINE_LOGO_JPEG} alt="CPAMC" className={styles.aboutLogo} />
            <div className={styles.aboutTitle}>{t('system_info.about_title')}</div>
          </div>

          <div className={styles.aboutInfoGrid}>
            <button
              type="button"
              className={`${styles.infoTile} ${styles.tapTile}`}
              onClick={handleInfoVersionTap}
            >
              <div className={styles.tileHeader}>
                <div className={styles.tileLabel}>{t('footer.version')}</div>
              </div>
              <div className={styles.tileValue}>{appVersion}</div>
            </button>

            <div className={styles.infoTile}>
              <div className={styles.tileHeader}>
                <div className={styles.tileLabel}>{t('footer.api_version')}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={styles.tileAction}
                  onClick={() => void handleVersionCheck()}
                  loading={checkingVersion}
                  title={t('system_info.version_check_button')}
                  aria-label={t('system_info.version_check_button')}
                >
                  {t('system_info.version_check_button')}
                </Button>
              </div>
              <div className={styles.tileValue}>{apiVersion}</div>
            </div>

            <div className={styles.infoTile}>
              <div className={styles.tileLabel}>{t('footer.build_date')}</div>
              <div className={styles.tileValue}>{buildTime}</div>
            </div>

            <div className={styles.infoTile}>
              <div className={styles.tileLabel}>{t('connection.status')}</div>
              <div className={styles.tileValue}>{t(`common.${auth.connectionStatus}_status`)}</div>
              <div className={styles.tileSub}>{auth.apiBase || '-'}</div>
            </div>
          </div>
        </Card>

        <Card title={t('system_info.quick_links_title')}>
          <p className={styles.sectionDescription}>{t('system_info.quick_links_desc')}</p>
          <div className={styles.quickLinks}>
            <a
              href="https://github.com/router-for-me/CLIProxyAPI"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkCard}
            >
              <div className={`${styles.linkIcon} ${styles.github}`}>
                <IconGithub size={22} />
              </div>
              <div className={styles.linkContent}>
                <div className={styles.linkTitle}>
                  {t('system_info.link_main_repo')}
                  <IconExternalLink size={14} />
                </div>
                <div className={styles.linkDesc}>{t('system_info.link_main_repo_desc')}</div>
              </div>
            </a>

            <a
              href="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkCard}
            >
              <div className={`${styles.linkIcon} ${styles.github}`}>
                <IconCode size={22} />
              </div>
              <div className={styles.linkContent}>
                <div className={styles.linkTitle}>
                  {t('system_info.link_webui_repo')}
                  <IconExternalLink size={14} />
                </div>
                <div className={styles.linkDesc}>{t('system_info.link_webui_repo_desc')}</div>
              </div>
            </a>

            <a
              href="https://help.router-for.me/"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.linkCard}
            >
              <div className={`${styles.linkIcon} ${styles.docs}`}>
                <IconBookOpen size={22} />
              </div>
              <div className={styles.linkContent}>
                <div className={styles.linkTitle}>
                  {t('system_info.link_docs')}
                  <IconExternalLink size={14} />
                </div>
                <div className={styles.linkDesc}>{t('system_info.link_docs_desc')}</div>
              </div>
            </a>
          </div>
        </Card>

        <Card
          title={t('system_info.models_title')}
          extra={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fetchModels({ forceRefresh: true })}
              loading={modelsLoading}
            >
              {t('common.refresh')}
            </Button>
          }
        >
          <p className={styles.sectionDescription}>{t('system_info.models_desc')}</p>
          {modelStatus && (
            <div className={`status-badge ${modelStatus.type}`}>{modelStatus.message}</div>
          )}
          {modelsError && <div className="error-box">{modelsError}</div>}
          {modelsLoading ? (
            <div className="hint">{t('common.loading')}</div>
          ) : models.length === 0 ? (
            <div className="hint">{t('system_info.models_empty')}</div>
          ) : (
            <div className="item-list">
              {groupedModels.map((group) => {
                const iconSrc = getIconForCategory(group.id);
                return (
                  <div key={group.id} className="item-row">
                    <div className="item-meta">
                      <div className={styles.groupTitle}>
                        {iconSrc && <img src={iconSrc} alt="" className={styles.groupIcon} />}
                        <span className="item-title">{group.label}</span>
                      </div>
                      <div className="item-subtitle">
                        {t('system_info.models_count', { count: group.items.length })}
                      </div>
                    </div>
                    <div className={styles.modelTags}>
                      {group.items.map((model) => (
                        <span
                          key={`${model.name}-${model.alias ?? 'default'}`}
                          className={styles.modelTag}
                          title={model.description || ''}
                        >
                          <span className={styles.modelName}>{model.name}</span>
                          {model.alias && <span className={styles.modelAlias}>{model.alias}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title={t('system_info.api_key_policy_title')}
          extra={
            <div className={styles.cardActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void fetchAPIKeyEntries()}
                loading={apiKeysLoading}
                disabled={!canManageApiKeyPolicies}
              >
                {t('common.refresh')}
              </Button>
              <Button size="sm" onClick={openAPIKeyCreateModal} disabled={!canManageApiKeyPolicies}>
                {t('common.add')}
              </Button>
            </div>
          }
        >
          <p className={styles.sectionDescription}>{t('system_info.api_key_policy_desc')}</p>
          {apiKeysError && <div className="error-box">{apiKeysError}</div>}
          {apiKeysLoading ? (
            <div className="hint">{t('common.loading')}</div>
          ) : apiKeyEntries.length === 0 ? (
            <div className="hint">{t('system_info.api_key_policy_empty')}</div>
          ) : (
            <div className={styles.apiKeyList}>
              {apiKeyEntries.map((entry, index) => {
                const runtime = apiKeyRuntimeMap.get(entry.key);
                const modelCount = entry.models?.length ?? 0;
                const periodicLimit = entry.limits?.tokens?.periodic?.limit;
                const periodicWindow = entry.limits?.tokens?.periodic?.window;
                return (
                  <div key={`${entry.key}-${index}`} className={styles.apiKeyItem}>
                    <div className={styles.apiKeyItemHeader}>
                      <div className={styles.apiKeyPrimary}>
                        <span className={styles.apiKeyValue}>{entry.key}</span>
                        <span
                          className={`${styles.apiKeyBadge} ${
                            entry.super ? styles.apiKeyBadgeSuper : styles.apiKeyBadgeLimited
                          }`}
                        >
                          {entry.super
                            ? t('system_info.api_key_policy_super_badge')
                            : t('system_info.api_key_policy_limited_badge')}
                        </span>
                        {entry.name && <span className={styles.apiKeyName}>{entry.name}</span>}
                      </div>
                      <div className={styles.apiKeyActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => openAPIKeyEditModal(entry, index)}
                        >
                          {t('common.edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={resettingTokenKey === entry.key}
                          onClick={() => void handleResetAPIKeyTokens(entry.key)}
                        >
                          {t('system_info.api_key_policy_reset_tokens')}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => handleDeleteAPIKeyPolicy(entry, index)}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </div>

                    {entry.description && (
                      <div className={styles.apiKeyDescription}>{entry.description}</div>
                    )}

                    <div className={styles.apiKeyMetaGrid}>
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>
                          {t('system_info.api_key_field_rpm')}
                        </span>
                        <span className={styles.metaValue}>
                          {entry.limits?.rate?.rpm ??
                            t('system_info.api_key_runtime_not_configured')}
                        </span>
                      </div>
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>
                          {t('system_info.api_key_field_qps')}/
                          {t('system_info.api_key_field_burst')}
                        </span>
                        <span className={styles.metaValue}>
                          {entry.limits?.rate?.qps ??
                            t('system_info.api_key_runtime_not_configured')}{' '}
                          /{' '}
                          {entry.limits?.rate?.burst ??
                            t('system_info.api_key_runtime_not_configured')}
                        </span>
                      </div>
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>
                          {t('system_info.api_key_field_concurrency_max')}/
                          {t('system_info.api_key_field_queue_max')}
                        </span>
                        <span className={styles.metaValue}>
                          {entry.limits?.concurrency?.max ??
                            t('system_info.api_key_runtime_not_configured')}{' '}
                          /{' '}
                          {entry.limits?.concurrency?.['queue-max'] ??
                            t('system_info.api_key_runtime_not_configured')}
                        </span>
                      </div>
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>
                          {t('system_info.api_key_field_lifetime_limit')}
                        </span>
                        <span className={styles.metaValue}>
                          {entry.limits?.tokens?.lifetime?.limit ??
                            t('system_info.api_key_runtime_not_configured')}
                        </span>
                      </div>
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>
                          {t('system_info.api_key_field_periodic_limit')}
                        </span>
                        <span className={styles.metaValue}>
                          {periodicLimit !== undefined
                            ? `${periodicLimit} (${formatPeriodicWindow(periodicWindow)})`
                            : t('system_info.api_key_runtime_not_configured')}
                        </span>
                      </div>
                      <div className={styles.metaItem}>
                        <span className={styles.metaLabel}>
                          {t('system_info.api_key_runtime_inflight')}/
                          {t('system_info.api_key_runtime_queueing')}
                        </span>
                        <span className={styles.metaValue}>
                          {runtime?.['in-flight'] ?? 0} / {runtime?.queueing ?? 0}
                        </span>
                      </div>
                    </div>

                    <div className={styles.apiKeyModels}>
                      <span className={styles.metaLabel}>
                        {t('system_info.api_key_field_models')}:
                      </span>
                      {entry.super ? (
                        <span className={styles.apiKeyModelTag}>
                          {t('system_info.api_key_policy_models_all')}
                        </span>
                      ) : modelCount > 0 ? (
                        entry.models?.map((model) => (
                          <span key={model} className={styles.apiKeyModelTag}>
                            {model}
                          </span>
                        ))
                      ) : (
                        <span className={styles.apiKeyModelTag}>
                          {t('system_info.api_key_runtime_not_configured')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card
          title={t('system_info.api_key_runtime_title')}
          extra={
            <div className={styles.cardActions}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void fetchAPIKeyRuntime()}
                loading={apiKeyRuntimeLoading}
                disabled={!canManageApiKeyPolicies}
              >
                {t('common.refresh')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleResetAllTokens}
                loading={resettingAllTokens}
                disabled={!canManageApiKeyPolicies || apiKeyRuntimeEntries.length === 0}
              >
                {t('system_info.api_key_runtime_reset_all')}
              </Button>
            </div>
          }
        >
          <p className={styles.sectionDescription}>{t('system_info.api_key_runtime_desc')}</p>
          {apiKeyRuntimeError && <div className="error-box">{apiKeyRuntimeError}</div>}
          {apiKeyRuntimeLoading ? (
            <div className="hint">{t('common.loading')}</div>
          ) : apiKeyRuntimeEntries.length === 0 ? (
            <div className="hint">{t('system_info.api_key_runtime_empty')}</div>
          ) : (
            <div className={styles.runtimeGrid}>
              {apiKeyRuntimeEntries.map((entry) => (
                <div key={entry.key} className={styles.runtimeItem}>
                  <div className={styles.runtimeHeader}>
                    <span className={styles.runtimeKey}>{entry.key}</span>
                    {entry.super && (
                      <span className={`${styles.apiKeyBadge} ${styles.apiKeyBadgeSuper}`}>
                        {t('system_info.api_key_policy_super_badge')}
                      </span>
                    )}
                  </div>
                  <div className={styles.runtimeStats}>
                    <div className={styles.runtimeStat}>
                      <span>{t('system_info.api_key_runtime_inflight')}</span>
                      <strong>{entry['in-flight']}</strong>
                    </div>
                    <div className={styles.runtimeStat}>
                      <span>{t('system_info.api_key_runtime_queueing')}</span>
                      <strong>{entry.queueing}</strong>
                    </div>
                    <div className={styles.runtimeStat}>
                      <span>{t('system_info.api_key_runtime_lifetime_used')}</span>
                      <strong>{entry['lifetime-used']}</strong>
                    </div>
                    <div className={styles.runtimeStat}>
                      <span>{t('system_info.api_key_runtime_periodic_used')}</span>
                      <strong>{entry['periodic-used']}</strong>
                    </div>
                    <div className={styles.runtimeStat}>
                      <span>{t('system_info.api_key_runtime_periodic_from')}</span>
                      <strong>{formatRuntimeDate(entry['periodic-from'])}</strong>
                    </div>
                    <div className={styles.runtimeStat}>
                      <span>{t('system_info.api_key_field_periodic_window')}</span>
                      <strong>{formatPeriodicWindow(entry['periodic-window'])}</strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={t('system_info.clear_login_title')}>
          <p className={styles.sectionDescription}>{t('system_info.clear_login_desc')}</p>
          <div className={styles.clearLoginActions}>
            <Button variant="danger" onClick={handleClearLoginStorage}>
              {t('system_info.clear_login_button')}
            </Button>
          </div>
        </Card>
      </div>

      <Modal
        open={apiKeyModalOpen}
        onClose={closeAPIKeyModal}
        title={
          isEditingApiKey
            ? t('system_info.api_key_policy_modal_edit')
            : t('system_info.api_key_policy_modal_add')
        }
        width={860}
        footer={
          <>
            <Button variant="secondary" onClick={closeAPIKeyModal} disabled={apiKeyModalSaving}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => void handleSaveAPIKeyPolicy()}
              loading={apiKeyModalSaving}
              disabled={!canManageApiKeyPolicies}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className={styles.apiKeyPolicyModal}>
          <Input
            label={t('system_info.api_key_field_key')}
            value={apiKeyForm.key}
            onChange={(event) =>
              setApiKeyForm((prev) => ({
                ...prev,
                key: event.target.value,
              }))
            }
            placeholder={t('api_keys.add_modal_key_placeholder')}
            disabled={apiKeyModalSaving}
          />
          <div className={styles.apiKeyFormGrid}>
            <Input
              label={t('system_info.api_key_field_name')}
              value={apiKeyForm.name}
              onChange={(event) =>
                setApiKeyForm((prev) => ({
                  ...prev,
                  name: event.target.value,
                }))
              }
              disabled={apiKeyModalSaving}
            />
            <Input
              label={t('system_info.api_key_field_description')}
              value={apiKeyForm.description}
              onChange={(event) =>
                setApiKeyForm((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
              disabled={apiKeyModalSaving}
            />
          </div>

          <div className="form-group">
            <label>{t('system_info.api_key_field_super')}</label>
            <ToggleSwitch
              checked={apiKeyForm.superKey}
              onChange={(value) => {
                setApiKeyForm((prev) => ({
                  ...prev,
                  superKey: value,
                }));
              }}
              disabled={apiKeyModalSaving}
            />
            <div className="hint">{t('system_info.api_key_policy_models_hint')}</div>
          </div>

          <div className="form-group">
            <label>{t('system_info.api_key_field_models')}</label>
            <div
              className={[
                styles.modelWhitelistPicker,
                policyLimitsDisabled ? styles.modelWhitelistPickerDisabled : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className={styles.modelWhitelistColumn}>
                <div className={styles.modelWhitelistHeader}>
                  <span>{t('system_info.api_key_models_available')}</span>
                  <span className={styles.modelWhitelistCount}>
                    {filteredAvailableModelOptions.length}
                  </span>
                </div>
                <Input
                  value={modelWhitelistSearch}
                  onChange={(event) => setModelWhitelistSearch(event.target.value)}
                  placeholder={t('system_info.api_key_models_search_placeholder')}
                  disabled={apiKeyModalSaving || policyLimitsDisabled}
                />
                <div className={styles.modelWhitelistList}>
                  {modelsLoading ? (
                    <div className={styles.modelWhitelistEmpty}>{t('common.loading')}</div>
                  ) : filteredAvailableModelOptions.length === 0 ? (
                    <div className={styles.modelWhitelistEmpty}>
                      {t('system_info.api_key_models_available_empty')}
                    </div>
                  ) : (
                    filteredAvailableModelOptions.map((model) => {
                      const selected = selectedModelPatternSet.has(model.normalizedName);
                      return (
                        <button
                          key={model.normalizedName}
                          type="button"
                          className={`${styles.modelWhitelistOption} ${
                            selected ? styles.modelWhitelistOptionSelected : ''
                          }`}
                          onDoubleClick={() => addModelToWhitelist(model.normalizedName)}
                          disabled={apiKeyModalSaving || policyLimitsDisabled || selected}
                          title={model.description || model.name}
                        >
                          <span className={styles.modelWhitelistName}>{model.name}</span>
                          {model.alias && model.alias !== model.name && (
                            <span className={styles.modelWhitelistAlias}>{model.alias}</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div className={styles.modelWhitelistColumn}>
                <div className={styles.modelWhitelistHeader}>
                  <span>{t('system_info.api_key_models_selected')}</span>
                  <span className={styles.modelWhitelistCount}>{selectedModelPatterns.length}</span>
                </div>
                <div className={styles.modelWhitelistList}>
                  {selectedModelPatterns.length === 0 ? (
                    <div className={styles.modelWhitelistEmpty}>
                      {t('system_info.api_key_models_selected_empty')}
                    </div>
                  ) : (
                    selectedModelPatterns.map((model) => (
                      <div key={model} className={styles.modelWhitelistSelectedItem}>
                        <span className={styles.modelWhitelistName}>{model}</span>
                        <button
                          type="button"
                          className={styles.modelWhitelistRemove}
                          onClick={() => removeModelFromWhitelist(model)}
                          disabled={apiKeyModalSaving || policyLimitsDisabled}
                          aria-label={t('common.delete')}
                          title={t('common.delete')}
                        >
                          <IconX size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <div className={styles.modelWhitelistCustomRow}>
                  <Input
                    value={customModelPattern}
                    onChange={(event) => setCustomModelPattern(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        addCustomModelPattern();
                      }
                    }}
                    placeholder={t('system_info.api_key_models_custom_placeholder')}
                    disabled={apiKeyModalSaving || policyLimitsDisabled}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={addCustomModelPattern}
                    disabled={
                      apiKeyModalSaving ||
                      policyLimitsDisabled ||
                      !customModelPattern.trim()
                    }
                  >
                    {t('common.add')}
                  </Button>
                </div>
              </div>
            </div>
            <div className="hint">{t('system_info.api_key_policy_models_hint')}</div>
            {modelsError && <div className="hint">{modelsError}</div>}
          </div>

          <div className={styles.apiKeyFormSectionTitle}>
            {t('system_info.api_key_runtime_limits')}
          </div>
          <div className={styles.apiKeyFormGrid}>
            <Input
              label={t('system_info.api_key_field_rpm')}
              value={apiKeyForm.rpm}
              onChange={(event) =>
                setApiKeyForm((prev) => ({
                  ...prev,
                  rpm: event.target.value,
                }))
              }
              disabled={apiKeyModalSaving || policyLimitsDisabled}
            />
            <Input
              label={t('system_info.api_key_field_qps')}
              value={apiKeyForm.qps}
              onChange={(event) =>
                setApiKeyForm((prev) => ({
                  ...prev,
                  qps: event.target.value,
                }))
              }
              disabled={apiKeyModalSaving || policyLimitsDisabled}
            />
            <Input
              label={t('system_info.api_key_field_burst')}
              value={apiKeyForm.burst}
              onChange={(event) =>
                setApiKeyForm((prev) => ({
                  ...prev,
                  burst: event.target.value,
                }))
              }
              disabled={apiKeyModalSaving || policyLimitsDisabled}
            />
            <Input
              label={t('system_info.api_key_field_concurrency_max')}
              value={apiKeyForm.concurrencyMax}
              onChange={(event) =>
                setApiKeyForm((prev) => ({
                  ...prev,
                  concurrencyMax: event.target.value,
                }))
              }
              disabled={apiKeyModalSaving || policyLimitsDisabled}
            />
            <Input
              label={t('system_info.api_key_field_queue_max')}
              value={apiKeyForm.queueMax}
              onChange={(event) =>
                setApiKeyForm((prev) => ({
                  ...prev,
                  queueMax: event.target.value,
                }))
              }
              disabled={apiKeyModalSaving || policyLimitsDisabled}
            />
            <Input
              label={t('system_info.api_key_field_queue_timeout_ms')}
              value={apiKeyForm.queueTimeoutMs}
              onChange={(event) =>
                setApiKeyForm((prev) => ({
                  ...prev,
                  queueTimeoutMs: event.target.value,
                }))
              }
              disabled={apiKeyModalSaving || policyLimitsDisabled}
            />
            <Input
              label={t('system_info.api_key_field_lifetime_limit')}
              value={apiKeyForm.lifetimeLimit}
              onChange={(event) =>
                setApiKeyForm((prev) => ({
                  ...prev,
                  lifetimeLimit: event.target.value,
                }))
              }
              disabled={apiKeyModalSaving || policyLimitsDisabled}
            />
            <Input
              label={t('system_info.api_key_field_periodic_limit')}
              value={apiKeyForm.periodicLimit}
              onChange={(event) =>
                setApiKeyForm((prev) => ({
                  ...prev,
                  periodicLimit: event.target.value,
                }))
              }
              disabled={apiKeyModalSaving || policyLimitsDisabled}
            />
            <div className="form-group">
              <label>{t('system_info.api_key_field_periodic_window')}</label>
              <Select
                value={apiKeyForm.periodicWindow}
                options={periodicWindowOptions}
                onChange={(value) =>
                  setApiKeyForm((prev) => ({
                    ...prev,
                    periodicWindow: value === 'day' || value === 'month' ? value : '',
                  }))
                }
                disabled={apiKeyModalSaving || policyLimitsDisabled}
                fullWidth
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={requestLogModalOpen}
        onClose={handleRequestLogClose}
        title={t('basic_settings.request_log_title')}
        footer={
          <>
            <Button variant="secondary" onClick={handleRequestLogClose} disabled={requestLogSaving}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleRequestLogSave}
              loading={requestLogSaving}
              disabled={!canEditRequestLog || !requestLogDirty}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div className="request-log-modal">
          <div className="status-badge warning">{t('basic_settings.request_log_warning')}</div>
          <ToggleSwitch
            label={t('basic_settings.request_log_enable')}
            labelPosition="left"
            checked={requestLogDraft}
            disabled={!canEditRequestLog || requestLogSaving}
            onChange={(value) => {
              setRequestLogDraft(value);
              setRequestLogTouched(true);
            }}
          />
        </div>
      </Modal>
    </div>
  );
}
