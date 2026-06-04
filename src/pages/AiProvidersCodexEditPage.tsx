import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HeaderInputList } from '@/components/ui/HeaderInputList';
import { ModelInputList } from '@/components/ui/ModelInputList';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCopy,
  IconEye,
  IconEyeOff,
  IconMinus,
  IconPlus,
  IconRefreshCw,
  IconTrash2,
} from '@/components/ui/icons';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { modelsApi, providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type { ProviderKeyConfig } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import { maskApiKey } from '@/utils/format';
import { buildHeaderObject, headersToEntries, normalizeHeaderEntries } from '@/utils/headers';
import { areKeyValueEntriesEqual, areModelEntriesEqual, areStringArraysEqual } from '@/utils/compare';
import { entriesToModels, modelsToEntries } from '@/components/ui/modelInputListUtils';
import { excludedModelsToText, parseExcludedModels } from '@/components/providers/utils';
import type { ProviderFormState } from '@/components/providers';
import type { ModelInfo } from '@/utils/models';
import layoutStyles from './AiProvidersEditLayout.module.scss';
import styles from './AiProvidersPage.module.scss';

type LocationState = { fromAiProviders?: boolean } | null;
type CodexKeyTestStatus = 'idle' | 'loading' | 'success' | 'error';

interface CodexEditFormState extends Omit<ProviderFormState, 'apiKey'> {
  apiKeys: string[];
  apiKeyWeights: number[];
}

const buildEmptyForm = (): CodexEditFormState => ({
  apiKeys: [''],
  apiKeyWeights: [1],
  priority: undefined,
  prefix: '',
  baseUrl: '',
  websockets: false,
  proxyUrl: '',
  headers: [],
  models: [],
  excludedModels: [],
  modelEntries: [{ name: '', alias: '' }],
  excludedText: '',
});

const parseIndexParam = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const getCodexBaseUrlGroupKey = (baseUrl?: string) => String(baseUrl ?? '').trim();

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

const normalizeModelEntries = (entries: Array<{ name: string; alias: string }>) =>
  (entries ?? []).reduce<Array<{ name: string; alias: string }>>((acc, entry) => {
    const name = String(entry?.name ?? '').trim();
    let alias = String(entry?.alias ?? '').trim();
    if (name && alias === name) {
      alias = '';
    }
    if (!name && !alias) return acc;
    acc.push({ name, alias });
    return acc;
  }, []);

type CodexFormBaseline = {
  apiKeys: string[];
  apiKeyWeights: number[];
  priority: number | null;
  prefix: string;
  baseUrl: string;
  websockets: boolean;
  proxyUrl: string;
  headers: ReturnType<typeof normalizeHeaderEntries>;
  models: ReturnType<typeof normalizeModelEntries>;
  excludedModels: string[];
};

const buildCodexBaseline = (form: CodexEditFormState): CodexFormBaseline => ({
  apiKeys: form.apiKeys.map((k) => k.trim()),
  apiKeyWeights: form.apiKeyWeights.map((w) => (Number.isFinite(w) && w > 0 ? Math.trunc(w) : 1)),
  priority:
    form.priority !== undefined && Number.isFinite(form.priority) ? Math.trunc(form.priority) : null,
  prefix: String(form.prefix ?? '').trim(),
  baseUrl: String(form.baseUrl ?? '').trim(),
  websockets: Boolean(form.websockets),
  proxyUrl: String(form.proxyUrl ?? '').trim(),
  headers: normalizeHeaderEntries(form.headers),
  models: normalizeModelEntries(form.modelEntries),
  excludedModels: parseExcludedModels(form.excludedText ?? ''),
});

const buildFormFromCodexBaseline = (baseline: CodexFormBaseline): CodexEditFormState => ({
  apiKeys: baseline.apiKeys.length ? baseline.apiKeys : [''],
  apiKeyWeights: baseline.apiKeyWeights.length
    ? baseline.apiKeyWeights.map((w) => (Number.isFinite(w) && w > 0 ? Math.trunc(w) : 1))
    : [1],
  priority: baseline.priority ?? undefined,
  prefix: baseline.prefix,
  baseUrl: baseline.baseUrl,
  websockets: baseline.websockets,
  proxyUrl: baseline.proxyUrl,
  headers: baseline.headers,
  models: baseline.models,
  excludedModels: baseline.excludedModels,
  modelEntries: baseline.models.length ? baseline.models : [{ name: '', alias: '' }],
  excludedText: excludedModelsToText(baseline.excludedModels),
});

function CodexKeyStatusBadge({
  status,
  message,
}: {
  status: CodexKeyTestStatus;
  message?: string;
}) {
  const { t } = useTranslation();

  const statusClassName =
    status === 'loading'
      ? styles.keyStatusBadgeLoading
      : status === 'success'
        ? styles.keyStatusBadgeSuccess
        : status === 'error'
          ? styles.keyStatusBadgeError
          : styles.keyStatusBadgeIdle;

  const label =
    status === 'loading'
      ? t('ai_providers.openai_test_status_loading')
      : status === 'success'
        ? t('ai_providers.openai_test_status_success')
        : status === 'error'
          ? t('ai_providers.openai_test_status_error')
          : t('ai_providers.openai_test_status_idle');

  return (
    <span className={`${styles.keyStatusBadge} ${statusClassName}`} title={message} role="status">
      {status === 'loading' && <span className={styles.statusSpinner} aria-hidden="true" />}
      {label}
    </span>
  );
}

function WeightStepper({
  value,
  onChange,
  min = 1,
  disabled = false,
}: {
  value: number;
  onChange: (val: number) => void;
  min?: number;
  disabled?: boolean;
}) {
  const handleDecrement = () => {
    if (value > min) {
      onChange(value - 1);
    }
  };

  const handleIncrement = () => {
    onChange(value + 1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed) && parsed >= min) {
      onChange(parsed);
    }
  };

  return (
    <div className={styles.weightStepper}>
      <button
        type="button"
        className={styles.weightStepperBtn}
        onClick={handleDecrement}
        disabled={disabled || value <= min}
        aria-label="Decrement"
      >
        <IconMinus size={12} />
      </button>
      <input
        type="number"
        className={styles.weightStepperValue}
        value={value}
        onChange={handleInputChange}
        disabled={disabled}
        min={min}
      />
      <button
        type="button"
        className={styles.weightStepperBtn}
        onClick={handleIncrement}
        disabled={disabled}
        aria-label="Increment"
      >
        <IconPlus size={12} />
      </button>
    </div>
  );
}

export function AiProvidersCodexEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ index?: string }>();

  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [configs, setConfigs] = useState<ProviderKeyConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<CodexEditFormState>(() => buildEmptyForm());
  const [baseline, setBaseline] = useState(() => buildCodexBaseline(buildEmptyForm()));
  const [showKeys, setShowKeys] = useState(false);
  const [keyTestStatuses, setKeyTestStatuses] = useState<
    Record<number, { status: CodexKeyTestStatus; message?: string }>
  >({});

  const [modelDiscoveryOpen, setModelDiscoveryOpen] = useState(false);
  const [modelDiscoveryEndpoint, setModelDiscoveryEndpoint] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<ModelInfo[]>([]);
  const [modelDiscoveryFetching, setModelDiscoveryFetching] = useState(false);
  const [modelDiscoveryError, setModelDiscoveryError] = useState('');
  const [modelDiscoverySearch, setModelDiscoverySearch] = useState('');
  const [modelDiscoverySelected, setModelDiscoverySelected] = useState<Set<string>>(new Set());
  const autoFetchSignatureRef = useRef<string>('');
  const modelDiscoveryRequestIdRef = useRef(0);

  const hasIndexParam = typeof params.index === 'string';
  const editIndex = useMemo(() => parseIndexParam(params.index), [params.index]);
  const invalidIndexParam = hasIndexParam && editIndex === null;

  const initialData = useMemo(() => {
    if (editIndex === null) return undefined;
    return configs[editIndex];
  }, [configs, editIndex]);

  const sameBaseUrlConfigs = useMemo(() => {
    if (editIndex === null || !initialData) return [];
    const editBaseUrl = getCodexBaseUrlGroupKey(initialData.baseUrl);
    return configs.filter((config) => getCodexBaseUrlGroupKey(config.baseUrl) === editBaseUrl);
  }, [configs, editIndex, initialData]);

  const invalidIndex = editIndex !== null && !initialData;

  const title =
    editIndex !== null
      ? t('ai_providers.codex_edit_modal_title')
      : t('ai_providers.codex_add_modal_title');

  const handleBack = useCallback(() => {
    const state = location.state as LocationState;
    if (state?.fromAiProviders) {
      navigate(-1);
      return;
    }
    navigate('/ai-providers', { replace: true });
  }, [location.state, navigate]);

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    fetchConfig('codex-api-key')
      .then((value) => {
        if (cancelled) return;
        setConfigs(Array.isArray(value) ? (value as ProviderKeyConfig[]) : []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : '';
        setError(message || t('notification.refresh_failed'));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchConfig, t]);

  useEffect(() => {
    if (loading) return;

    if (initialData) {
      const apiKeysFromSameBaseUrl = sameBaseUrlConfigs.length
        ? sameBaseUrlConfigs.map((config) => config.apiKey)
        : [initialData.apiKey];
      const apiKeyWeightsFromSameBaseUrl = apiKeysFromSameBaseUrl.map((_, i) => {
        const source = sameBaseUrlConfigs.length ? sameBaseUrlConfigs[i] : initialData;
        const w = Number(source?.weight);
        return Number.isFinite(w) && w > 0 ? Math.trunc(w) : 1;
      });
      const nextForm: CodexEditFormState = {
        ...initialData,
        websockets: Boolean(initialData.websockets),
        headers: headersToEntries(initialData.headers),
        modelEntries: modelsToEntries(initialData.models),
        excludedText: excludedModelsToText(initialData.excludedModels),
        apiKeys: apiKeysFromSameBaseUrl,
        apiKeyWeights: apiKeyWeightsFromSameBaseUrl,
      };
      setForm(nextForm);
      setBaseline(buildCodexBaseline(nextForm));
      return;
    }
    const nextForm = buildEmptyForm();
    setForm(nextForm);
    setBaseline(buildCodexBaseline(nextForm));
  }, [initialData, loading, sameBaseUrlConfigs]);

  const normalizedHeaders = useMemo(() => normalizeHeaderEntries(form.headers), [form.headers]);
  const normalizedModels = useMemo(
    () => normalizeModelEntries(form.modelEntries),
    [form.modelEntries]
  );
  const normalizedExcludedModels = useMemo(
    () => parseExcludedModels(form.excludedText ?? ''),
    [form.excludedText]
  );
  const normalizedPriority = useMemo(() => {
    return form.priority !== undefined && Number.isFinite(form.priority)
      ? Math.trunc(form.priority)
      : null;
  }, [form.priority]);
  const isHeadersDirty = useMemo(
    () => !areKeyValueEntriesEqual(baseline.headers, normalizedHeaders),
    [baseline.headers, normalizedHeaders]
  );
  const isModelsDirty = useMemo(
    () => !areModelEntriesEqual(baseline.models, normalizedModels),
    [baseline.models, normalizedModels]
  );
  const isExcludedModelsDirty = useMemo(
    () => !areStringArraysEqual(baseline.excludedModels, normalizedExcludedModels),
    [baseline.excludedModels, normalizedExcludedModels]
  );
  const isApiKeysDirty = useMemo(
    () => {
      const baselineKeys = baseline.apiKeys;
      const formKeys = form.apiKeys.map((k) => k.trim());
      if (baselineKeys.length !== formKeys.length) return true;
      return baselineKeys.some((k, i) => k !== formKeys[i]);
    },
    [baseline.apiKeys, form.apiKeys]
  );
  const isApiKeyWeightsDirty = useMemo(
    () => {
      const baselineWeights = baseline.apiKeyWeights;
      const formWeights = form.apiKeyWeights.map((w) =>
        Number.isFinite(w) && w > 0 ? Math.trunc(w) : 1
      );
      if (baselineWeights.length !== formWeights.length) return true;
      return baselineWeights.some((w, i) => w !== formWeights[i]);
    },
    [baseline.apiKeyWeights, form.apiKeyWeights]
  );
  const isDirty =
    isApiKeysDirty ||
    isApiKeyWeightsDirty ||
    baseline.priority !== normalizedPriority ||
    baseline.prefix !== String(form.prefix ?? '').trim() ||
    baseline.baseUrl !== String(form.baseUrl ?? '').trim() ||
    baseline.websockets !== Boolean(form.websockets) ||
    baseline.proxyUrl !== String(form.proxyUrl ?? '').trim() ||
    isHeadersDirty ||
    isModelsDirty ||
    isExcludedModelsDirty;
  const canGuard = !loading && !saving && !invalidIndexParam && !invalidIndex;

  const { allowNextNavigation } = useUnsavedChangesGuard({
    enabled: canGuard,
    shouldBlock: ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
    dialog: {
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.leave'),
      cancelText: t('common.stay'),
      variant: 'danger',
    },
  });

  const canSave = !disableControls && !saving && !loading && !invalidIndexParam && !invalidIndex;

  const discardChanges = useCallback(() => {
    setForm(buildFormFromCodexBaseline(baseline));
    setKeyTestStatuses({});
  }, [baseline]);

  const copyKeyToClipboard = useCallback(
    async (apiKey: string) => {
      const copied = await copyToClipboard(apiKey);
      showNotification(
        copied ? t('notification.copied_to_clipboard') : t('notification.copy_failed'),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const copyAllKeysToClipboard = useCallback(async () => {
    const keys = form.apiKeys.map((apiKey) => apiKey.trim()).filter(Boolean);
    if (!keys.length) {
      showNotification(t('notification.codex_api_key_required'), 'error');
      return;
    }

    const copied = await copyToClipboard(keys.join('\n'));
    showNotification(
      copied ? t('notification.copied_to_clipboard') : t('notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  }, [form.apiKeys, showNotification, t]);

  const updateApiKeyAt = useCallback(
    (index: number, value: string) => {
      const newKeys = [...form.apiKeys];
      newKeys[index] = value;
      setForm((prev) => ({ ...prev, apiKeys: newKeys }));
      setKeyTestStatuses((prev) => ({ ...prev, [index]: { status: 'idle' } }));
    },
    [form.apiKeys]
  );

  const updateApiKeyWeightAt = useCallback(
    (index: number, value: number) => {
      setForm((prev) => {
        const nextWeights = [...(prev.apiKeyWeights ?? [])];
        while (nextWeights.length <= index) nextWeights.push(1);
        nextWeights[index] = value;
        return { ...prev, apiKeyWeights: nextWeights };
      });
    },
    [setForm]
  );

  const addApiKeyRow = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      apiKeys: [...prev.apiKeys, ''],
      apiKeyWeights: [...(prev.apiKeyWeights ?? []), 1],
    }));
    setShowKeys(true);
  }, [setForm]);

  const removeApiKeyRow = useCallback(
    (index: number) => {
      const newKeys = form.apiKeys.filter((_, i) => i !== index);
      const newWeights = (form.apiKeyWeights ?? []).filter((_, i) => i !== index);
      setForm((prev) => ({
        ...prev,
        apiKeys: newKeys.length ? newKeys : [''],
        apiKeyWeights: newKeys.length ? (newWeights.length ? newWeights : [1]) : [1],
      }));
      setKeyTestStatuses((prev) => {
        const next: Record<number, { status: CodexKeyTestStatus; message?: string }> = {};
        Object.entries(prev).forEach(([key, status]) => {
          const oldIndex = Number(key);
          if (!Number.isFinite(oldIndex) || oldIndex === index) return;
          next[oldIndex > index ? oldIndex - 1 : oldIndex] = status;
        });
        return next;
      });
    },
    [form.apiKeys, form.apiKeyWeights, setForm]
  );

  const testCodexKey = useCallback(
    async (apiKey: string, keyIndex: number) => {
      const baseUrl = (form.baseUrl ?? '').trim();
      if (!baseUrl) {
        const message = t('notification.codex_base_url_required');
        setKeyTestStatuses((prev) => ({ ...prev, [keyIndex]: { status: 'error', message } }));
        showNotification(message, 'error');
        return;
      }

      const headerObject = buildHeaderObject(form.headers);
      const hasCustomAuthorization = Object.keys(headerObject).some(
        (key) => key.toLowerCase() === 'authorization'
      );

      setKeyTestStatuses((prev) => ({
        ...prev,
        [keyIndex]: {
          status: 'loading',
          message: t('ai_providers.codex_models_fetch_loading'),
        },
      }));

      try {
        await modelsApi.fetchV1ModelsViaApiCall(
          baseUrl,
          hasCustomAuthorization ? undefined : apiKey,
          headerObject
        );
        const message = t('ai_providers.openai_test_status_success');
        setKeyTestStatuses((prev) => ({ ...prev, [keyIndex]: { status: 'success', message } }));
        showNotification(message, 'success');
      } catch (err: unknown) {
        const message = `${t('ai_providers.codex_models_fetch_error')}: ${getErrorMessage(err)}`;
        setKeyTestStatuses((prev) => ({ ...prev, [keyIndex]: { status: 'error', message } }));
        showNotification(message, 'error');
      }
    },
    [form.baseUrl, form.headers, showNotification, t]
  );

  const discoveredModelsFiltered = useMemo(() => {
    const filter = modelDiscoverySearch.trim().toLowerCase();
    if (!filter) return discoveredModels;
    return discoveredModels.filter((model) => {
      const name = (model.name || '').toLowerCase();
      const alias = (model.alias || '').toLowerCase();
      const description = (model.description || '').toLowerCase();
      return name.includes(filter) || alias.includes(filter) || description.includes(filter);
    });
  }, [discoveredModels, modelDiscoverySearch]);
  const visibleDiscoveredModelNames = useMemo(
    () => discoveredModelsFiltered.map((model) => model.name),
    [discoveredModelsFiltered]
  );
  const allVisibleDiscoveredSelected = useMemo(
    () =>
      visibleDiscoveredModelNames.length > 0 &&
      visibleDiscoveredModelNames.every((name) => modelDiscoverySelected.has(name)),
    [modelDiscoverySelected, visibleDiscoveredModelNames]
  );

  const mergeDiscoveredModels = useCallback(
    (selectedModels: ModelInfo[]) => {
      if (!selectedModels.length) return;

      let addedCount = 0;
      setForm((prev) => {
        const mergedMap = new Map<string, { name: string; alias: string }>();
        prev.modelEntries.forEach((entry) => {
          const name = entry.name.trim();
          if (!name) return;
          mergedMap.set(name.toLowerCase(), { name, alias: entry.alias?.trim() || '' });
        });

        selectedModels.forEach((model) => {
          const name = String(model.name ?? '').trim();
          if (!name) return;
          const key = name.toLowerCase();
          if (mergedMap.has(key)) return;
          mergedMap.set(key, { name, alias: model.alias ?? '' });
          addedCount += 1;
        });

        const mergedEntries = Array.from(mergedMap.values());
        return {
          ...prev,
          modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
        };
      });

      if (addedCount > 0) {
        showNotification(
          t('ai_providers.codex_models_fetch_added', { count: addedCount }),
          'success'
        );
      }
    },
    [setForm, showNotification, t]
  );

  const fetchCodexModelDiscovery = useCallback(async () => {
    const requestId = (modelDiscoveryRequestIdRef.current += 1);
    setModelDiscoveryFetching(true);
    setModelDiscoveryError('');

    try {
      const headerObject = buildHeaderObject(form.headers);
      const hasCustomAuthorization = Object.keys(headerObject).some(
        (key) => key.toLowerCase() === 'authorization'
      );
      const apiKey = form.apiKeys[0]?.trim() || undefined;
      const list = await modelsApi.fetchV1ModelsViaApiCall(
        form.baseUrl ?? '',
        hasCustomAuthorization ? undefined : apiKey,
        headerObject
      );
      if (modelDiscoveryRequestIdRef.current !== requestId) return;
      setDiscoveredModels(list);
    } catch (err: unknown) {
      if (modelDiscoveryRequestIdRef.current !== requestId) return;
      setDiscoveredModels([]);
      const message = getErrorMessage(err);
      setModelDiscoveryError(`${t('ai_providers.codex_models_fetch_error')}: ${message}`);
    } finally {
      if (modelDiscoveryRequestIdRef.current === requestId) {
        setModelDiscoveryFetching(false);
      }
    }
  }, [form.apiKeys, form.baseUrl, form.headers, t]);

  useEffect(() => {
    if (!modelDiscoveryOpen) {
      autoFetchSignatureRef.current = '';
      modelDiscoveryRequestIdRef.current += 1;
      setModelDiscoveryFetching(false);
      return;
    }

    const nextEndpoint = modelsApi.buildV1ModelsEndpoint(form.baseUrl ?? '');
    setModelDiscoveryEndpoint(nextEndpoint);
    setDiscoveredModels([]);
    setModelDiscoverySearch('');
    setModelDiscoverySelected(new Set());
    setModelDiscoveryError('');

    if (!nextEndpoint) return;

    const headerObject = buildHeaderObject(form.headers);
    const hasCustomAuthorization = Object.keys(headerObject).some(
      (key) => key.toLowerCase() === 'authorization'
    );
    const hasApiKeyField = Boolean(form.apiKeys[0]?.trim());
    const canAutoFetch = hasApiKeyField || hasCustomAuthorization;

    if (!canAutoFetch) return;

    const headerSignature = Object.entries(headerObject)
      .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(([key, value]) => `${key}:${value}`)
      .join('|');
    const signature = `${nextEndpoint}||${form.apiKeys[0]?.trim() || ''}||${headerSignature}`;
    if (autoFetchSignatureRef.current === signature) return;
    autoFetchSignatureRef.current = signature;

    void fetchCodexModelDiscovery();
  }, [fetchCodexModelDiscovery, form.apiKeys, form.baseUrl, form.headers, modelDiscoveryOpen]);

  useEffect(() => {
    const availableNames = new Set(discoveredModels.map((model) => model.name));
    setModelDiscoverySelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((name) => {
        if (availableNames.has(name)) {
          next.add(name);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [discoveredModels]);

  const toggleModelDiscoverySelection = (name: string) => {
    setModelDiscoverySelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const handleSelectVisibleDiscoveredModels = useCallback(() => {
    setModelDiscoverySelected((prev) => {
      const next = new Set(prev);
      visibleDiscoveredModelNames.forEach((name) => next.add(name));
      return next;
    });
  }, [visibleDiscoveredModelNames]);

  const handleClearDiscoveredModelSelection = useCallback(() => {
    setModelDiscoverySelected(new Set());
  }, []);

  const handleApplyDiscoveredModels = () => {
    const selectedModels = discoveredModels.filter((model) =>
      modelDiscoverySelected.has(model.name)
    );
    if (selectedModels.length) {
      mergeDiscoveredModels(selectedModels);
    }
    setModelDiscoveryOpen(false);
  };

  const handleSave = useCallback(async () => {
    if (!canSave) return;

    const trimmedBaseUrl = (form.baseUrl ?? '').trim();
    const baseUrl = trimmedBaseUrl || undefined;
    if (!baseUrl) {
      showNotification(t('notification.codex_base_url_required'), 'error');
      return;
    }

    const validApiKeys = form.apiKeys.filter((k) => k.trim());
    if (validApiKeys.length === 0) {
      showNotification(t('notification.codex_api_key_required'), 'error');
      return;
    }

    setSaving(true);
    setError('');
    try {
      // Build shared config properties
      const sharedConfig = {
        priority: form.priority !== undefined ? Math.trunc(form.priority) : undefined,
        prefix: form.prefix?.trim() || undefined,
        baseUrl,
        websockets: Boolean(form.websockets),
        proxyUrl: form.proxyUrl?.trim() || undefined,
        headers: buildHeaderObject(form.headers),
        models: entriesToModels(form.modelEntries),
        excludedModels: parseExcludedModels(form.excludedText),
      };

      // Create one config per API key
      const trimmedKeys = validApiKeys.map((apiKey) => apiKey.trim());
      const weightForTrimmedKey = (trimmed: string): number => {
        const sourceIndex = validApiKeys.findIndex((k) => k.trim() === trimmed);
        if (sourceIndex < 0) return 1;
        const w = Number(form.apiKeyWeights[sourceIndex]);
        return Number.isFinite(w) && w > 0 ? Math.trunc(w) : 1;
      };
      const newConfigs: ProviderKeyConfig[] = trimmedKeys.map((apiKey) => ({
        apiKey,
        ...sharedConfig,
        weight: weightForTrimmedKey(apiKey),
      }));

      let nextList: ProviderKeyConfig[];
      if (editIndex !== null) {
        const editBaseUrl = getCodexBaseUrlGroupKey(configs[editIndex]?.baseUrl);
        let inserted = false;
        nextList = [];
        configs.forEach((config) => {
          if (getCodexBaseUrlGroupKey(config.baseUrl) !== editBaseUrl) {
            nextList.push(config);
            return;
          }
          if (!inserted) {
            nextList.push(...newConfigs);
            inserted = true;
          }
        });
      } else {
        // Adding new configs
        nextList = [...configs, ...newConfigs];
      }

      await providersApi.saveCodexConfigs(nextList);
      setConfigs(nextList);
      updateConfigValue('codex-api-key', nextList);
      clearCache('codex-api-key');
      showNotification(
        editIndex !== null
          ? t('notification.codex_config_updated')
          : t('notification.codex_config_added'),
        'success'
      );
      allowNextNavigation();
      setBaseline(buildCodexBaseline(form));
      handleBack();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      setError(message);
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [
    allowNextNavigation,
    canSave,
    clearCache,
    configs,
    editIndex,
    form,
    handleBack,
    showNotification,
    t,
    updateConfigValue,
  ]);

  const canOpenModelDiscovery =
    !disableControls &&
    !saving &&
    !loading &&
    !invalidIndexParam &&
    !invalidIndex &&
    Boolean((form.baseUrl ?? '').trim());
  const canApplyModelDiscovery =
    !disableControls && !saving && !modelDiscoveryFetching && modelDiscoverySelected.size > 0;

  return (
    <SecondaryScreenShell
      ref={swipeRef}
      contentClassName={layoutStyles.content}
      title={title}
      onBack={handleBack}
      backLabel={t('common.back')}
      backAriaLabel={t('common.back')}
      hideTopBarBackButton
      hideTopBarRightAction
      floatingAction={
        isDirty ? (
          <div className={layoutStyles.dirtyActionBar}>
            <div className={layoutStyles.dirtyActionMeta}>
              <span className={layoutStyles.dirtyActionDot} aria-hidden="true" />
              <span>
                {t('ai_providers.codex_dirty_message', {
                  defaultValue: '检测到 Codex 渠道有未保存的密钥变更。',
                })}
              </span>
            </div>
            <div className={layoutStyles.dirtyActionButtons}>
              <Button
                variant="secondary"
                size="sm"
                onClick={discardChanges}
                disabled={saving || disableControls}
              >
                {t('common.discard', { defaultValue: '放弃' })}
              </Button>
              <Button
                size="sm"
                onClick={() => void handleSave()}
                loading={saving}
                disabled={!canSave}
                className={layoutStyles.floatingSaveButton}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : (
          <div className={layoutStyles.floatingActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleBack}
              className={layoutStyles.floatingBackButton}
            >
              {t('common.back')}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleSave()}
              loading={saving}
              disabled={!canSave}
              className={layoutStyles.floatingSaveButton}
            >
              {t('common.save')}
            </Button>
          </div>
        )
      }
      isLoading={loading}
      loadingLabel={t('common.loading')}
    >
      <Card>
        {error && <div className="error-box">{error}</div>}
        {invalidIndexParam || invalidIndex ? (
          <div className="hint">{t('common.invalid_provider_index')}</div>
        ) : (
          <>
            <div className={styles.keyEntriesSection}>
              <div className={styles.keyEntriesHeader}>
                <label className={styles.keyEntriesTitle}>{t('ai_providers.codex_add_modal_keys_label')}</label>
                <span className={styles.keyEntriesHint}>{t('ai_providers.codex_keys_hint')}</span>
              </div>
              <div className={styles.keyEntriesList}>
                <div className={styles.keyEntriesToolbar}>
                  <span className={styles.keyEntriesCount}>
                    {t('ai_providers.codex_keys_count')}: {form.apiKeys.length}
                  </span>
                  <div className={styles.claudeKeyToolbarActions}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowKeys((prev) => !prev)}
                      disabled={saving || disableControls}
                      title={
                        showKeys
                          ? t('common.hide', { defaultValue: '隐藏' })
                          : t('common.show', { defaultValue: '显示' })
                      }
                    >
                      {showKeys ? <IconEyeOff size={14} /> : <IconEye size={14} />}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void copyAllKeysToClipboard()}
                      disabled={
                        saving ||
                        disableControls ||
                        !form.apiKeys.some((apiKey) => apiKey.trim())
                      }
                      title={t('common.copy')}
                    >
                      <IconCopy size={14} />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={addApiKeyRow}
                      disabled={saving || disableControls}
                      className={styles.addKeyButton}
                    >
                      <IconPlus size={14} />
                      {t('ai_providers.codex_keys_add_btn')}
                    </Button>
                  </div>
                </div>
                <div className={styles.claudeKeyMatrixShell}>
                  <div className={styles.claudeKeyMatrixScroller}>
                    <div className={styles.claudeKeyMatrixHeader}>
                      <div className={styles.claudeKeyMatrixColStatus}>{t('common.status')}</div>
                      <div className={styles.claudeKeyMatrixColIndex}>#</div>
                      <div className={styles.claudeKeyMatrixColKey}>{t('common.api_key')}</div>
                      <div className={styles.claudeKeyMatrixColWeight}>
                        {t('ai_providers.openai_key_weight', { defaultValue: '权重' })}
                      </div>
                      <div className={styles.claudeKeyMatrixColRoute}>{t('common.base_url')}</div>
                      <div className={styles.claudeKeyMatrixColAction}>{t('common.action')}</div>
                    </div>
                    {form.apiKeys.map((apiKey, index) => {
                      const trimmedKey = apiKey.trim();
                      const rowStatus = keyTestStatuses[index]?.status ?? 'idle';
                      const rowMessage = keyTestStatuses[index]?.message;
                      const rowWeight = (() => {
                        const w = Number(form.apiKeyWeights?.[index] ?? 1);
                        return Number.isFinite(w) && w > 0 ? Math.trunc(w) : 1;
                      })();
                      return (
                        <div key={index} className={styles.claudeKeyMatrixRow}>
                          <div className={styles.claudeKeyMatrixColStatus}>
                            <CodexKeyStatusBadge status={rowStatus} message={rowMessage} />
                          </div>
                          <div className={styles.claudeKeyMatrixColIndex}>{index + 1}</div>
                          <div className={styles.claudeKeyMatrixColKey}>
                            <div className={styles.claudeKeyInputGroup}>
                              <input
                                type="text"
                                value={showKeys || !apiKey ? apiKey : maskApiKey(apiKey)}
                                onChange={(e) => updateApiKeyAt(index, e.target.value)}
                                readOnly={!showKeys && Boolean(apiKey)}
                                disabled={saving || disableControls}
                                className={`input ${styles.claudeKeyInput} ${
                                  showKeys ? '' : styles.claudeKeyInputMasked
                                }`}
                                placeholder={t('ai_providers.codex_add_modal_key_placeholder')}
                                autoComplete="new-password"
                                data-lpignore="true"
                                data-1p-ignore="true"
                                spellCheck={false}
                              />
                              <button
                                type="button"
                                className={styles.claudeKeyIconButton}
                                onClick={() => void copyKeyToClipboard(apiKey)}
                                title={t('common.copy')}
                                disabled={saving || disableControls || !trimmedKey}
                              >
                                <IconCopy size={14} />
                              </button>
                            </div>
                          </div>
                          <div className={styles.claudeKeyMatrixColWeight}>
                            <WeightStepper
                              value={rowWeight}
                              onChange={(val) => updateApiKeyWeightAt(index, val)}
                              min={1}
                              disabled={saving || disableControls}
                            />
                          </div>
                          <div className={styles.claudeKeyMatrixColRoute}>
                            <span className={styles.claudeKeyRouteText}>
                              {(form.baseUrl ?? '').trim() || '-'}
                            </span>
                            <span className={styles.claudeKeyRouteHint}>
                              {form.proxyUrl?.trim()
                                ? `${t('common.proxy_url')}: ${form.proxyUrl.trim()}`
                                : t('ai_providers.codex_keys_same_proxy_hint')}
                            </span>
                          </div>
                          <div className={styles.claudeKeyMatrixColAction}>
                            <button
                              type="button"
                              className={styles.claudeKeyActionButton}
                              onClick={() => void testCodexKey(trimmedKey, index)}
                              disabled={saving || disableControls || !trimmedKey}
                              title={t('ai_providers.openai_test_single_action')}
                            >
                              <IconRefreshCw
                                size={14}
                                className={rowStatus === 'loading' ? styles.statusIconSpin : undefined}
                              />
                              {t('ai_providers.openai_test_single_action')}
                            </button>
                            <button
                              type="button"
                              className={`${styles.claudeKeyActionButton} ${styles.claudeKeyDeleteButton}`}
                              onClick={() => removeApiKeyRow(index)}
                              disabled={saving || disableControls || form.apiKeys.length <= 1}
                              title={t('common.delete')}
                            >
                              <IconTrash2 size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            <Input
              label={t('ai_providers.priority_label')}
              hint={t('ai_providers.priority_hint')}
              type="number"
              step={1}
              value={form.priority ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = raw.trim() === '' ? undefined : Number(raw);
                setForm((prev) => ({
                  ...prev,
                  priority: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
                }));
              }}
              disabled={disableControls || saving}
            />
            <Input
              label={t('ai_providers.prefix_label')}
              placeholder={t('ai_providers.prefix_placeholder')}
              value={form.prefix ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, prefix: e.target.value }))}
              hint={t('ai_providers.prefix_hint')}
              disabled={disableControls || saving}
            />
            <Input
              label={t('ai_providers.codex_add_modal_url_label')}
              value={form.baseUrl ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              disabled={disableControls || saving}
            />
            <div className="form-group">
              <label>{t('ai_providers.codex_websockets_label')}</label>
              <ToggleSwitch
                checked={Boolean(form.websockets)}
                onChange={(value) => setForm((prev) => ({ ...prev, websockets: value }))}
                disabled={disableControls || saving}
                ariaLabel={t('ai_providers.codex_websockets_label')}
              />
              <div className="hint">{t('ai_providers.codex_websockets_hint')}</div>
            </div>
            <Input
              label={t('ai_providers.codex_add_modal_proxy_label')}
              value={form.proxyUrl ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, proxyUrl: e.target.value }))}
              disabled={disableControls || saving}
            />
            <HeaderInputList
              entries={form.headers}
              onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
              addLabel={t('common.custom_headers_add')}
              keyPlaceholder={t('common.custom_headers_key_placeholder')}
              valuePlaceholder={t('common.custom_headers_value_placeholder')}
              removeButtonTitle={t('common.delete')}
              removeButtonAriaLabel={t('common.delete')}
              disabled={disableControls || saving}
            />

            <div className={styles.modelConfigSection}>
              <div className={styles.modelConfigHeader}>
                <label className={styles.modelConfigTitle}>
                  {t('ai_providers.codex_models_label')}
                </label>
                <div className={styles.modelConfigToolbar}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        modelEntries: [...prev.modelEntries, { name: '', alias: '' }],
                      }))
                    }
                    disabled={disableControls || saving}
                  >
                    {t('ai_providers.codex_models_add_btn')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setModelDiscoveryOpen(true)}
                    disabled={!canOpenModelDiscovery}
                  >
                    {t('ai_providers.codex_models_fetch_button')}
                  </Button>
                </div>
              </div>
              <div className={styles.sectionHint}>{t('ai_providers.codex_models_hint')}</div>

              <ModelInputList
                entries={form.modelEntries}
                onChange={(entries) => setForm((prev) => ({ ...prev, modelEntries: entries }))}
                namePlaceholder={t('common.model_name_placeholder')}
                aliasPlaceholder={t('common.model_alias_placeholder')}
                disabled={disableControls || saving}
                hideAddButton
                className={styles.modelInputList}
                rowClassName={styles.modelInputRow}
                inputClassName={styles.modelInputField}
                removeButtonClassName={styles.modelRowRemoveButton}
                removeButtonTitle={t('common.delete')}
                removeButtonAriaLabel={t('common.delete')}
              />
            </div>
            <div className="form-group">
              <label>{t('ai_providers.excluded_models_label')}</label>
              <textarea
                className="input"
                placeholder={t('ai_providers.excluded_models_placeholder')}
                value={form.excludedText}
                onChange={(e) => setForm((prev) => ({ ...prev, excludedText: e.target.value }))}
                rows={4}
                disabled={disableControls || saving}
              />
              <div className="hint">{t('ai_providers.excluded_models_hint')}</div>
            </div>

            <Modal
              open={modelDiscoveryOpen}
              title={t('ai_providers.codex_models_fetch_title')}
              onClose={() => setModelDiscoveryOpen(false)}
              width={720}
              footer={
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setModelDiscoveryOpen(false)}
                    disabled={modelDiscoveryFetching}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleApplyDiscoveredModels}
                    disabled={!canApplyModelDiscovery}
                  >
                    {t('ai_providers.codex_models_fetch_apply')}
                  </Button>
                </>
              }
            >
              <div className={styles.openaiModelsContent}>
                <div className={styles.sectionHint}>
                  {t('ai_providers.codex_models_fetch_hint')}
                </div>
                <div className={styles.openaiModelsEndpointSection}>
                  <label className={styles.openaiModelsEndpointLabel}>
                    {t('ai_providers.codex_models_fetch_url_label')}
                  </label>
                  <div className={styles.openaiModelsEndpointControls}>
                    <input
                      className={`input ${styles.openaiModelsEndpointInput}`}
                      readOnly
                      value={modelDiscoveryEndpoint}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void fetchCodexModelDiscovery()}
                      loading={modelDiscoveryFetching}
                      disabled={disableControls || saving}
                    >
                      {t('ai_providers.codex_models_fetch_refresh')}
                    </Button>
                  </div>
                </div>
                <Input
                  label={t('ai_providers.codex_models_search_label')}
                  placeholder={t('ai_providers.codex_models_search_placeholder')}
                  value={modelDiscoverySearch}
                  onChange={(e) => setModelDiscoverySearch(e.target.value)}
                  disabled={modelDiscoveryFetching}
                />
                {discoveredModels.length > 0 && (
                  <div className={styles.modelDiscoveryToolbar}>
                    <div className={styles.modelDiscoveryToolbarActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleSelectVisibleDiscoveredModels}
                        disabled={
                          disableControls ||
                          saving ||
                          modelDiscoveryFetching ||
                          discoveredModelsFiltered.length === 0 ||
                          allVisibleDiscoveredSelected
                        }
                      >
                        {t('ai_providers.model_discovery_select_visible')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleClearDiscoveredModelSelection}
                        disabled={
                          disableControls ||
                          saving ||
                          modelDiscoveryFetching ||
                          modelDiscoverySelected.size === 0
                        }
                      >
                        {t('ai_providers.model_discovery_clear_selection')}
                      </Button>
                    </div>
                    <div className={styles.modelDiscoverySelectionSummary}>
                      {t('ai_providers.model_discovery_selected_count', {
                        count: modelDiscoverySelected.size,
                      })}
                    </div>
                  </div>
                )}
                {modelDiscoveryError && <div className="error-box">{modelDiscoveryError}</div>}
                {modelDiscoveryFetching ? (
                  <div className={styles.sectionHint}>
                    {t('ai_providers.codex_models_fetch_loading')}
                  </div>
                ) : discoveredModels.length === 0 ? (
                  <div className={styles.sectionHint}>
                    {t('ai_providers.codex_models_fetch_empty')}
                  </div>
                ) : discoveredModelsFiltered.length === 0 ? (
                  <div className={styles.sectionHint}>
                    {t('ai_providers.codex_models_search_empty')}
                  </div>
                ) : (
                  <div className={styles.modelDiscoveryList}>
                    {discoveredModelsFiltered.map((model) => {
                      const checked = modelDiscoverySelected.has(model.name);
                      return (
                        <SelectionCheckbox
                          key={model.name}
                          checked={checked}
                          onChange={() => toggleModelDiscoverySelection(model.name)}
                          disabled={disableControls || saving || modelDiscoveryFetching}
                          ariaLabel={model.name}
                          className={`${styles.modelDiscoveryRow} ${
                            checked ? styles.modelDiscoveryRowSelected : ''
                          }`}
                          labelClassName={styles.modelDiscoverySelectionLabel}
                          label={
                            <div className={styles.modelDiscoveryMeta}>
                              <div className={styles.modelDiscoveryName}>
                                {model.name}
                                {model.alias && (
                                  <span className={styles.modelDiscoveryAlias}>{model.alias}</span>
                                )}
                              </div>
                              {model.description && (
                                <div className={styles.modelDiscoveryDesc}>{model.description}</div>
                              )}
                            </div>
                          }
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </Modal>
          </>
        )}
      </Card>
    </SecondaryScreenShell>
  );
}
