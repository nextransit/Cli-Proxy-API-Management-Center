import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { HeaderInputList } from '@/components/ui/HeaderInputList';
import { ModelInputList } from '@/components/ui/ModelInputList';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCopy,
  IconEye,
  IconEyeOff,
  IconPlus,
  IconRefreshCw,
  IconTrash2,
} from '@/components/ui/icons';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { maskApiKey } from '@/utils/format';
import { buildHeaderObject } from '@/utils/headers';
import { buildClaudeMessagesEndpoint, parseTextList } from '@/components/providers/utils';
import type { ClaudeEditOutletContext } from './AiProvidersClaudeEditLayout';
import styles from './AiProvidersPage.module.scss';
import layoutStyles from './AiProvidersEditLayout.module.scss';

const CLAUDE_TEST_TIMEOUT_MS = 30_000;
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
type ClaudeKeyTestStatus = 'idle' | 'loading' | 'success' | 'error';

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

const hasHeader = (headers: Record<string, string>, name: string) => {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
};

const resolveBearerTokenFromAuthorization = (headers: Record<string, string>): string => {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization');
  if (!entry) return '';
  const value = String(entry[1] ?? '').trim();
  if (!value) return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
};

function ClaudeKeyStatusBadge({
  status,
  message,
}: {
  status: ClaudeKeyTestStatus;
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

export function AiProvidersClaudeEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification } = useNotificationStore();
  const {
    hasIndexParam,
    invalidIndexParam,
    invalidIndex,
    disableControls,
    loading,
    saving,
    form,
    setForm,
    testModel,
    setTestModel,
    testStatus,
    setTestStatus,
    testMessage,
    setTestMessage,
    availableModels,
    isDirty,
    handleBack,
    handleSave,
    discardChanges,
  } = useOutletContext<ClaudeEditOutletContext>();

  const title = hasIndexParam
    ? t('ai_providers.claude_edit_modal_title')
    : t('ai_providers.claude_add_modal_title');

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });
  const [isTesting, setIsTesting] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [keyTestStatuses, setKeyTestStatuses] = useState<
    Record<number, { status: ClaudeKeyTestStatus; message?: string }>
  >({});
  const lastCloakConfigRef = useRef<typeof form.cloak>(null);

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
    if (!form.cloak) return;
    lastCloakConfigRef.current = form.cloak;
  }, [form.cloak]);

  const canSave =
    !disableControls && !loading && !saving && !invalidIndexParam && !invalidIndex && !isTesting;

  const modelSelectOptions = useMemo(() => {
    const seen = new Set<string>();
    return form.modelEntries.reduce<Array<{ value: string; label: string }>>((acc, entry) => {
      const name = entry.name.trim();
      if (!name || seen.has(name)) return acc;
      seen.add(name);
      const alias = entry.alias.trim();
      acc.push({
        value: name,
        label: alias && alias !== name ? `${name} (${alias})` : name,
      });
      return acc;
    }, []);
  }, [form.modelEntries]);

  const cloakModeOptions = useMemo(
    () => [
      { value: 'auto', label: t('ai_providers.claude_cloak_mode_auto') },
      { value: 'always', label: t('ai_providers.claude_cloak_mode_always') },
      { value: 'never', label: t('ai_providers.claude_cloak_mode_never') },
    ],
    [t]
  );

  const resolvedCloakMode = useMemo(() => {
    const mode = (form.cloak?.mode ?? '').trim().toLowerCase();
    if (!mode) return 'auto';
    if (mode === 'provider') return 'auto';
    if (mode === 'auto' || mode === 'always' || mode === 'never') return mode;
    return 'auto';
  }, [form.cloak?.mode]);

  const connectivityConfigSignature = useMemo(() => {
    const headersSignature = form.headers
      .map((entry) => `${entry.key.trim()}:${entry.value.trim()}`)
      .join('|');
    const modelsSignature = form.modelEntries
      .map((entry) => `${entry.name.trim()}:${entry.alias.trim()}`)
      .join('|');
    return [
      form.apiKeys.map((key) => key.trim()).join('|'),
      form.baseUrl?.trim() ?? '',
      testModel.trim(),
      headersSignature,
      modelsSignature,
    ].join('||');
  }, [form.apiKeys, form.baseUrl, form.headers, form.modelEntries, testModel]);

  const previousConnectivityConfigRef = useRef(connectivityConfigSignature);

  useEffect(() => {
    if (previousConnectivityConfigRef.current === connectivityConfigSignature) {
      return;
    }
    previousConnectivityConfigRef.current = connectivityConfigSignature;
    setTestStatus('idle');
    setTestMessage('');
    setKeyTestStatuses({});
  }, [connectivityConfigSignature, setTestMessage, setTestStatus]);

  const openClaudeModelDiscovery = () => {
    navigate('models');
  };

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
      showNotification(t('notification.claude_api_key_required'), 'error');
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
      setKeyTestStatuses((prev) => ({
        ...prev,
        [index]: { status: 'idle' },
      }));
    },
    [form.apiKeys, setForm]
  );

  const addApiKeyRow = useCallback(() => {
    setForm((prev) => ({ ...prev, apiKeys: [...prev.apiKeys, ''] }));
    setShowKeys(true);
  }, [setForm]);

  const removeApiKeyRow = useCallback(
    (index: number) => {
      const newKeys = form.apiKeys.filter((_, i) => i !== index);
      setForm((prev) => ({ ...prev, apiKeys: newKeys.length ? newKeys : [''] }));
      setKeyTestStatuses((prev) => {
        const next: Record<number, { status: ClaudeKeyTestStatus; message?: string }> = {};
        Object.entries(prev).forEach(([key, status]) => {
          const oldIndex = Number(key);
          if (!Number.isFinite(oldIndex) || oldIndex === index) return;
          next[oldIndex > index ? oldIndex - 1 : oldIndex] = status;
        });
        return next;
      });
    },
    [form.apiKeys, setForm]
  );

  const runClaudeConnectivityTest = useCallback(async (input?: { apiKey?: string; keyIndex?: number }) => {
    if (isTesting) return;
    const keyIndex = input?.keyIndex;
    const setRowStatus = (status: ClaudeKeyTestStatus, message?: string) => {
      if (keyIndex === undefined) return;
      setKeyTestStatuses((prev) => ({ ...prev, [keyIndex]: { status, message } }));
    };

    const modelName = testModel.trim() || availableModels[0] || '';
    if (!modelName) {
      const message = t('ai_providers.claude_test_model_required');
      setTestStatus('error');
      setTestMessage(message);
      setRowStatus('error', message);
      showNotification(message, 'error');
      return;
    }

    const customHeaders = buildHeaderObject(form.headers);
    const apiKey =
      input && Object.prototype.hasOwnProperty.call(input, 'apiKey')
        ? String(input.apiKey ?? '').trim()
        : form.apiKeys[0]?.trim() || '';
    const hasApiKeyHeader = hasHeader(customHeaders, 'x-api-key');
    const apiKeyFromAuthorization = resolveBearerTokenFromAuthorization(customHeaders);
    const resolvedApiKey = apiKey || apiKeyFromAuthorization;

    if (!resolvedApiKey && !hasApiKeyHeader) {
      const message = t('ai_providers.claude_test_key_required');
      setTestStatus('error');
      setTestMessage(message);
      setRowStatus('error', message);
      showNotification(message, 'error');
      return;
    }

    const endpoint = buildClaudeMessagesEndpoint(form.baseUrl ?? '');
    if (!endpoint) {
      const message = t('ai_providers.claude_test_endpoint_invalid');
      setTestStatus('error');
      setTestMessage(message);
      setRowStatus('error', message);
      showNotification(message, 'error');
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    if (!hasHeader(headers, 'anthropic-version')) {
      headers['anthropic-version'] = DEFAULT_ANTHROPIC_VERSION;
    }
    if (!Object.prototype.hasOwnProperty.call(headers, 'Anthropic-Version')) {
      headers['Anthropic-Version'] = headers['anthropic-version'] ?? DEFAULT_ANTHROPIC_VERSION;
    }

    if (!hasApiKeyHeader && resolvedApiKey) {
      headers['x-api-key'] = resolvedApiKey;
    }
    if (!Object.prototype.hasOwnProperty.call(headers, 'X-Api-Key') && resolvedApiKey) {
      headers['X-Api-Key'] = resolvedApiKey;
    }

    setIsTesting(true);
    setTestStatus('loading');
    setTestMessage(t('ai_providers.claude_test_running'));
    setRowStatus('loading', t('ai_providers.claude_test_running'));

    try {
      const result = await apiCallApi.request(
        {
          method: 'POST',
          url: endpoint,
          header: headers,
          data: JSON.stringify({
            model: modelName,
            max_tokens: 8,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        },
        { timeout: CLAUDE_TEST_TIMEOUT_MS }
      );

      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error(getApiCallErrorMessage(result));
      }

      const message = t('ai_providers.claude_test_success');
      setTestStatus('success');
      setTestMessage(message);
      setRowStatus('success', message);
      showNotification(message, 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      const errorCode =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: string }).code)
          : '';
      const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout');
      const resolvedMessage = isTimeout
        ? t('ai_providers.claude_test_timeout', { seconds: CLAUDE_TEST_TIMEOUT_MS / 1000 })
        : `${t('ai_providers.claude_test_failed')}: ${message || t('common.unknown_error')}`;
      setTestStatus('error');
      setTestMessage(resolvedMessage);
      setRowStatus('error', resolvedMessage);
      showNotification(resolvedMessage, 'error');
    } finally {
      setIsTesting(false);
    }
  }, [
    availableModels,
    form.apiKeys,
    form.baseUrl,
    form.headers,
    isTesting,
    setTestMessage,
    setTestStatus,
    showNotification,
    t,
    testModel,
  ]);

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
                {t('ai_providers.claude_dirty_message', {
                  defaultValue: '检测到 Claude 渠道有未保存的密钥变更。',
                })}
              </span>
            </div>
            <div className={layoutStyles.dirtyActionButtons}>
              <Button
                variant="secondary"
                size="sm"
                onClick={discardChanges}
                disabled={saving || isTesting}
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
        {invalidIndexParam || invalidIndex ? (
          <div className={styles.sectionHint}>{t('common.invalid_provider_index')}</div>
        ) : (
          <div className={styles.openaiEditForm}>
            <div className={styles.keyEntriesSection}>
              <div className={styles.keyEntriesHeader}>
                <label className={styles.keyEntriesTitle}>{t('ai_providers.claude_add_modal_keys_label')}</label>
                <span className={styles.keyEntriesHint}>{t('ai_providers.claude_keys_hint')}</span>
              </div>
              <div className={styles.keyEntriesList}>
                <div className={styles.keyEntriesToolbar}>
                  <span className={styles.keyEntriesCount}>
                    {t('ai_providers.claude_keys_count')}: {form.apiKeys.length}
                  </span>
                  <div className={styles.claudeKeyToolbarActions}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowKeys((prev) => !prev)}
                      disabled={saving || disableControls || isTesting}
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
                        isTesting ||
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
                      disabled={saving || disableControls || isTesting}
                      className={styles.addKeyButton}
                    >
                      <IconPlus size={14} />
                      {t('ai_providers.claude_keys_add_btn')}
                    </Button>
                  </div>
                </div>
                <div className={styles.claudeKeyMatrixShell}>
                  <div className={styles.claudeKeyMatrixScroller}>
                    <div className={styles.claudeKeyMatrixHeader}>
                      <div className={styles.claudeKeyMatrixColStatus}>{t('common.status')}</div>
                      <div className={styles.claudeKeyMatrixColIndex}>#</div>
                      <div className={styles.claudeKeyMatrixColKey}>{t('common.api_key')}</div>
                      <div className={styles.claudeKeyMatrixColRoute}>{t('common.base_url')}</div>
                      <div className={styles.claudeKeyMatrixColAction}>{t('common.action')}</div>
                    </div>
                    {form.apiKeys.map((apiKey, index) => {
                      const trimmedKey = apiKey.trim();
                      const rowStatus = keyTestStatuses[index]?.status ?? 'idle';
                      const rowMessage = keyTestStatuses[index]?.message;
                      return (
                        <div key={index} className={styles.claudeKeyMatrixRow}>
                          <div className={styles.claudeKeyMatrixColStatus}>
                            <ClaudeKeyStatusBadge status={rowStatus} message={rowMessage} />
                          </div>
                          <div className={styles.claudeKeyMatrixColIndex}>{index + 1}</div>
                          <div className={styles.claudeKeyMatrixColKey}>
                            <div className={styles.claudeKeyInputGroup}>
                              <input
                                type="text"
                                value={showKeys || !apiKey ? apiKey : maskApiKey(apiKey)}
                                onChange={(e) => updateApiKeyAt(index, e.target.value)}
                                readOnly={!showKeys && Boolean(apiKey)}
                                disabled={saving || disableControls || isTesting}
                                className={`input ${styles.claudeKeyInput} ${
                                  showKeys ? '' : styles.claudeKeyInputMasked
                                }`}
                                placeholder={t('ai_providers.claude_add_modal_key_placeholder')}
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
                                disabled={saving || disableControls || isTesting || !trimmedKey}
                              >
                                <IconCopy size={14} />
                              </button>
                            </div>
                          </div>
                          <div className={styles.claudeKeyMatrixColRoute}>
                            <span className={styles.claudeKeyRouteText}>
                              {(form.baseUrl ?? '').trim() || t('ai_providers.claude_default_base')}
                            </span>
                            <span className={styles.claudeKeyRouteHint}>
                              {form.proxyUrl?.trim()
                                ? `${t('common.proxy_url')}: ${form.proxyUrl.trim()}`
                                : t('ai_providers.claude_keys_same_proxy_hint')}
                            </span>
                          </div>
                          <div className={styles.claudeKeyMatrixColAction}>
                            <button
                              type="button"
                              className={styles.claudeKeyActionButton}
                              onClick={() =>
                                void runClaudeConnectivityTest({ apiKey: trimmedKey, keyIndex: index })
                              }
                              disabled={
                                saving ||
                                disableControls ||
                                isTesting ||
                                !trimmedKey ||
                                availableModels.length === 0
                              }
                              title={t('ai_providers.claude_test_action')}
                            >
                              <IconRefreshCw
                                size={14}
                                className={rowStatus === 'loading' ? styles.statusIconSpin : undefined}
                              />
                              {t('ai_providers.claude_test_action')}
                            </button>
                            <button
                              type="button"
                              className={`${styles.claudeKeyActionButton} ${styles.claudeKeyDeleteButton}`}
                              onClick={() => removeApiKeyRow(index)}
                              disabled={
                                saving || disableControls || isTesting || form.apiKeys.length <= 1
                              }
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
              disabled={saving || disableControls || isTesting}
            />
            <Input
              label={t('ai_providers.prefix_label')}
              placeholder={t('ai_providers.prefix_placeholder')}
              value={form.prefix ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, prefix: e.target.value }))}
              hint={t('ai_providers.prefix_hint')}
              disabled={saving || disableControls || isTesting}
            />
            <Input
              label={t('ai_providers.claude_add_modal_url_label')}
              value={form.baseUrl ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              disabled={saving || disableControls || isTesting}
            />
            <Input
              label={t('ai_providers.claude_add_modal_proxy_label')}
              value={form.proxyUrl ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, proxyUrl: e.target.value }))}
              disabled={saving || disableControls || isTesting}
            />
            <HeaderInputList
              entries={form.headers}
              onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
              addLabel={t('common.custom_headers_add')}
              keyPlaceholder={t('common.custom_headers_key_placeholder')}
              valuePlaceholder={t('common.custom_headers_value_placeholder')}
              removeButtonTitle={t('common.delete')}
              removeButtonAriaLabel={t('common.delete')}
              disabled={saving || disableControls || isTesting}
            />

            <div className={styles.modelConfigSection}>
              <div className={styles.modelConfigHeader}>
                <label className={styles.modelConfigTitle}>{t('ai_providers.claude_models_label')}</label>
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
                    disabled={saving || disableControls || isTesting}
                  >
                    {t('ai_providers.claude_models_add_btn')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={openClaudeModelDiscovery}
                    disabled={saving || disableControls || isTesting}
                  >
                    {t('ai_providers.claude_models_fetch_button')}
                  </Button>
                </div>
              </div>

              <div className={styles.sectionHint}>{t('ai_providers.claude_models_hint')}</div>

              <ModelInputList
                entries={form.modelEntries}
                onChange={(entries) => setForm((prev) => ({ ...prev, modelEntries: entries }))}
                namePlaceholder={t('common.model_name_placeholder')}
                aliasPlaceholder={t('common.model_alias_placeholder')}
                disabled={saving || disableControls || isTesting}
                hideAddButton
                className={styles.modelInputList}
                rowClassName={styles.modelInputRow}
                inputClassName={styles.modelInputField}
                removeButtonClassName={styles.modelRowRemoveButton}
                removeButtonTitle={t('common.delete')}
                removeButtonAriaLabel={t('common.delete')}
              />

              <div className={styles.modelTestPanel}>
                <div className={styles.modelTestMeta}>
                  <label className={styles.modelTestLabel}>{t('ai_providers.claude_test_title')}</label>
                  <span className={styles.modelTestHint}>{t('ai_providers.claude_test_hint')}</span>
                </div>
                <div className={styles.modelTestControls}>
                  <Select
                    value={testModel}
                    options={modelSelectOptions}
                    onChange={(value) => {
                      setTestModel(value);
                      setTestStatus('idle');
                      setTestMessage('');
                    }}
                    placeholder={
                      availableModels.length
                        ? t('ai_providers.claude_test_select_placeholder')
                        : t('ai_providers.claude_test_select_empty')
                    }
                    className={styles.openaiTestSelect}
                    ariaLabel={t('ai_providers.claude_test_title')}
                    disabled={
                      saving ||
                      disableControls ||
                      isTesting ||
                      testStatus === 'loading' ||
                      availableModels.length === 0
                    }
                  />
                  <Button
                    variant={testStatus === 'error' ? 'danger' : 'secondary'}
                    size="sm"
                    onClick={() => void runClaudeConnectivityTest()}
                    loading={testStatus === 'loading'}
                    disabled={
                      saving ||
                      disableControls ||
                      isTesting ||
                      testStatus === 'loading' ||
                      availableModels.length === 0
                    }
                    className={styles.modelTestAllButton}
                  >
                    {t('ai_providers.claude_test_action')}
                  </Button>
                </div>
              </div>

              {testMessage && (
                <div
                  className={`status-badge ${
                    testStatus === 'error'
                      ? 'error'
                      : testStatus === 'success'
                        ? 'success'
                        : 'muted'
                  }`}
                >
                  {testMessage}
                </div>
              )}
            </div>

            <div className="form-group">
              <label>{t('ai_providers.excluded_models_label')}</label>
              <textarea
                className="input"
                placeholder={t('ai_providers.excluded_models_placeholder')}
                value={form.excludedText}
                onChange={(e) => setForm((prev) => ({ ...prev, excludedText: e.target.value }))}
                rows={4}
                disabled={saving || disableControls || isTesting}
              />
              <div className="hint">{t('ai_providers.excluded_models_hint')}</div>
            </div>

            <div className={styles.modelConfigSection}>
              <div className={styles.modelConfigHeader}>
                <label className={styles.modelConfigTitle}>{t('ai_providers.claude_cloak_title')}</label>
                <div className={styles.modelConfigToolbar}>
                  <ToggleSwitch
                    checked={Boolean(form.cloak)}
                    onChange={(enabled) =>
                      setForm((prev) => {
                        if (!enabled) {
                          if (prev.cloak) {
                            lastCloakConfigRef.current = prev.cloak;
                          }
                          return { ...prev, cloak: undefined };
                        }

                        const restored = prev.cloak
                          ?? lastCloakConfigRef.current
                          ?? { mode: 'auto', strictMode: false, sensitiveWords: [] };
                        const mode = String(restored.mode ?? 'auto').trim() || 'auto';
                        return {
                          ...prev,
                          cloak: {
                            mode,
                            strictMode: restored.strictMode ?? false,
                            sensitiveWords: restored.sensitiveWords ?? [],
                          },
                        };
                      })
                    }
                    disabled={saving || disableControls || isTesting}
                    ariaLabel={t('ai_providers.claude_cloak_toggle_aria')}
                    label={t('ai_providers.claude_cloak_toggle_label')}
                  />
                </div>
              </div>
              <div className={styles.sectionHint}>{t('ai_providers.claude_cloak_hint')}</div>

              {form.cloak ? (
                <>
                  <div className="form-group">
                    <label>{t('ai_providers.claude_cloak_mode_label')}</label>
                    <Select
                      value={resolvedCloakMode}
                      options={cloakModeOptions}
                      onChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          cloak: {
                            ...(prev.cloak ?? {}),
                            mode: value,
                          },
                        }))
                      }
                      ariaLabel={t('ai_providers.claude_cloak_mode_label')}
                      disabled={saving || disableControls || isTesting}
                    />
                    <div className="hint">{t('ai_providers.claude_cloak_mode_hint')}</div>
                  </div>

                  <div className="form-group">
                    <label>{t('ai_providers.claude_cloak_strict_label')}</label>
                    <ToggleSwitch
                      checked={Boolean(form.cloak.strictMode)}
                      onChange={(value) =>
                        setForm((prev) => ({
                          ...prev,
                          cloak: {
                            ...(prev.cloak ?? {}),
                            strictMode: value,
                          },
                        }))
                      }
                      disabled={saving || disableControls || isTesting}
                      ariaLabel={t('ai_providers.claude_cloak_strict_label')}
                    />
                    <div className="hint">{t('ai_providers.claude_cloak_strict_hint')}</div>
                  </div>

                  <div className="form-group">
                    <label>{t('ai_providers.claude_cloak_sensitive_words_label')}</label>
                    <textarea
                      className="input"
                      placeholder={t('ai_providers.claude_cloak_sensitive_words_placeholder')}
                      value={(form.cloak.sensitiveWords ?? []).join('\n')}
                      onChange={(e) => {
                        const nextWords = parseTextList(e.target.value);
                        setForm((prev) => ({
                          ...prev,
                          cloak: {
                            ...(prev.cloak ?? {}),
                            sensitiveWords: nextWords.length ? nextWords : undefined,
                          },
                        }));
                      }}
                      rows={3}
                      disabled={saving || disableControls || isTesting}
                    />
                    <div className="hint">{t('ai_providers.claude_cloak_sensitive_words_hint')}</div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </Card>
    </SecondaryScreenShell>
  );
}
