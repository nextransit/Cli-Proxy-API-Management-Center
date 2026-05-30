import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useThemeStore } from '@/stores';
import {
  textOpsApi,
  type TextOpsDisplayBlock,
  type TextOpsQueryResponse,
  type TextOpsRole,
} from '@/services/api';
import styles from './TextOpsPage.module.scss';

type MessageRole = 'user' | 'assistant';

interface TextOpsMessage {
  id: string;
  role: MessageRole;
  text: string;
  response?: TextOpsQueryResponse;
  error?: string;
}

interface EChartsOptionBlockProps {
  option: Record<string, unknown>;
}

function EChartsOptionBlock({ option }: EChartsOptionBlockProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<echarts.ECharts | null>(null);
  const isDark = useThemeStore((state) => state.theme === 'dark');

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;

    const chart = echarts.init(element, isDark ? 'dark' : 'light');
    chartInstanceRef.current = chart;
    chart.setOption(option as echarts.EChartsOption, true);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      if (chartInstanceRef.current === chart) {
        chartInstanceRef.current = null;
      }
    };
  }, [isDark, option]);

  useEffect(() => {
    chartInstanceRef.current?.setOption(option as echarts.EChartsOption, true);
  }, [option]);

  return <div ref={chartRef} className={styles.chartBlock} />;
}

const QUICK_CAPABILITIES = [
  '查询今日账单',
  '本周模型消耗 Top 3',
  '近24小时缓存命中率趋势',
  '上周 DeepSeek Token 消耗',
];

const roleOptions = [
  { value: 'admin', label: 'admin' },
  { value: 'reseller', label: 'reseller' },
  { value: 'customer', label: 'customer' },
] as const;

function parseAllowedUserIDs(raw: string): number[] {
  return raw
    .split(',')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function buildAssistantErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const maybeError = error as { message?: string; details?: unknown };
    if (typeof maybeError.message === 'string' && maybeError.message.trim()) {
      return maybeError.message;
    }
  }
  return '请求失败，请稍后重试。';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeQueryResponseFromError(error: unknown): TextOpsQueryResponse | null {
  if (!isRecord(error)) return null;
  const details = (error as { details?: unknown }).details;
  if (!isRecord(details)) return null;
  if (!('router' in details) || !('guardrail' in details)) return null;
  return details as unknown as TextOpsQueryResponse;
}

function renderDisplayBlock(block: TextOpsDisplayBlock, index: number) {
  if (block.type === 'ECHARTS_OPTION' && isRecord(block.data)) {
    return (
      <div key={`chart-${index}`} className={styles.blockWrapper}>
        {block.title ? <div className={styles.blockTitle}>{block.title}</div> : null}
        <EChartsOptionBlock option={block.data} />
      </div>
    );
  }
  if (typeof block.data === 'string') {
    return (
      <div key={`text-${index}`} className={styles.blockWrapper}>
        {block.title ? <div className={styles.blockTitle}>{block.title}</div> : null}
        <pre className={styles.markdownBlock}>{block.data}</pre>
      </div>
    );
  }
  return (
    <div key={`json-${index}`} className={styles.blockWrapper}>
      {block.title ? <div className={styles.blockTitle}>{block.title}</div> : null}
      <pre className={styles.markdownBlock}>{JSON.stringify(block.data, null, 2)}</pre>
    </div>
  );
}

export function TextOpsPage() {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<TextOpsMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const [role, setRole] = useState<TextOpsRole>('admin');
  const [operatorUserID, setOperatorUserID] = useState('1');
  const [allowedUserIDsRaw, setAllowedUserIDsRaw] = useState('1001,1002');

  const [llmEnabled, setLlmEnabled] = useState(false);
  const [llmAPIKey, setLlmAPIKey] = useState('');
  const [llmBaseURL, setLlmBaseURL] = useState('');
  const [llmModel, setLlmModel] = useState('gpt-5.3-codex');

  const canSubmit = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  const appendMessage = useCallback((message: TextOpsMessage) => {
    setMessages((prev) => [...prev, message]);
  }, []);

  const handleQuickCapability = useCallback((value: string) => {
    setInput(value);
  }, []);

  const handleSubmit = useCallback(async () => {
    const userQuery = input.trim();
    if (!userQuery || loading) return;

    const userMessage: TextOpsMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: userQuery,
    };
    appendMessage(userMessage);
    setInput('');
    setLoading(true);

    try {
      const operatorID = Number.parseInt(operatorUserID, 10);
      const response = await textOpsApi.query({
        user_query: userQuery,
        current_time: new Date().toISOString(),
        operator_context: {
          role,
          user_id: Number.isFinite(operatorID) && operatorID > 0 ? operatorID : 1,
          allowed_user_ids: role === 'reseller' ? parseAllowedUserIDs(allowedUserIDsRaw) : [],
        },
        router: {
          enabled: llmEnabled,
          api_key: llmAPIKey,
          base_url: llmBaseURL,
          model: llmModel,
          max_tokens: 600,
        },
        presenter: {
          enabled: llmEnabled,
          api_key: llmAPIKey,
          base_url: llmBaseURL,
          model: llmModel,
          max_tokens: 900,
        },
      });

      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: response.presentation?.markdown || '',
        response,
      });
    } catch (error: unknown) {
      const fallbackResponse = normalizeQueryResponseFromError(error);
      appendMessage({
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: fallbackResponse?.presentation?.markdown || '',
        response: fallbackResponse || undefined,
        error: buildAssistantErrorMessage(error),
      });
    } finally {
      setLoading(false);
    }
  }, [
    input,
    loading,
    appendMessage,
    operatorUserID,
    role,
    allowedUserIDsRaw,
    llmEnabled,
    llmAPIKey,
    llmBaseURL,
    llmModel,
  ]);

  return (
    <div className={styles.page}>
      <section className={`card ${styles.controlCard}`}>
        <div className="card-header">
          <span className="card-title">{t('text_ops.title', { defaultValue: 'Text-to-Ops' })}</span>
        </div>
        <div className={styles.controlGrid}>
          <Select
            value={role}
            options={roleOptions.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(value) => setRole(value as TextOpsRole)}
            ariaLabel="role"
          />
          <Input
            value={operatorUserID}
            onChange={(event) => setOperatorUserID(event.target.value)}
            placeholder={t('text_ops.user_id', { defaultValue: 'Operator User ID' })}
          />
          <Input
            value={allowedUserIDsRaw}
            onChange={(event) => setAllowedUserIDsRaw(event.target.value)}
            placeholder={t('text_ops.allowed_ids', { defaultValue: 'Allowed User IDs (comma separated)' })}
            disabled={role !== 'reseller'}
          />
          <Input
            value={llmBaseURL}
            onChange={(event) => setLlmBaseURL(event.target.value)}
            placeholder={t('text_ops.llm_base_url', { defaultValue: 'LLM Base URL (optional)' })}
          />
          <Input
            value={llmModel}
            onChange={(event) => setLlmModel(event.target.value)}
            placeholder={t('text_ops.llm_model', { defaultValue: 'LLM Model' })}
          />
          <Input
            type="password"
            value={llmAPIKey}
            onChange={(event) => setLlmAPIKey(event.target.value)}
            placeholder={t('text_ops.llm_api_key', { defaultValue: 'LLM API Key (optional)' })}
          />
        </div>
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={llmEnabled}
            onChange={(event) => setLlmEnabled(event.target.checked)}
          />
          <span>{t('text_ops.enable_llm', { defaultValue: 'Enable LLM router + presenter' })}</span>
        </label>
      </section>

      <section className={`card ${styles.chatCard}`}>
        <div className="card-header">
          <span className="card-title">{t('text_ops.workspace', { defaultValue: 'AI Ops Workspace' })}</span>
        </div>

        <div className={styles.quickRow}>
          {QUICK_CAPABILITIES.map((item) => (
            <button
              key={item}
              type="button"
              className={styles.quickChip}
              onClick={() => handleQuickCapability(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className={styles.messageList}>
          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              {t('text_ops.empty', { defaultValue: '输入自然语言指令，系统将自动路由并执行查询。' })}
            </div>
          ) : null}
          {messages.map((message) => (
            <article
              key={message.id}
              className={`${styles.message} ${message.role === 'user' ? styles.userMessage : styles.assistantMessage}`}
            >
              <div className={styles.messageHeader}>
                {message.role === 'user'
                  ? t('text_ops.user', { defaultValue: 'User' })
                  : t('text_ops.assistant', { defaultValue: 'Assistant' })}
              </div>
              {message.role === 'user' ? (
                <div className={styles.messageText}>{message.text}</div>
              ) : (
                <>
                  {message.error ? <div className={styles.errorText}>{message.error}</div> : null}
                  {message.response?.presentation?.blocks?.length
                    ? message.response.presentation.blocks.map((block, index) => renderDisplayBlock(block, index))
                    : message.text
                      ? <pre className={styles.markdownBlock}>{message.text}</pre>
                      : null}
                </>
              )}
            </article>
          ))}
          {loading ? <div className={styles.loadingHint}>{t('text_ops.loading', { defaultValue: '正在解析并执行...' })}</div> : null}
        </div>

        <div className={styles.composer}>
          <textarea
            className={styles.textarea}
            placeholder={t('text_ops.placeholder', { defaultValue: '例如：帮我查上周 DeepSeek 模型的 Token 消耗和缓存命中率趋势' })}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            rows={4}
          />
          <div className={styles.composerActions}>
            <Button variant="secondary" onClick={() => setInput('')} disabled={loading || input.trim() === ''}>
              {t('text_ops.clear', { defaultValue: '清空' })}
            </Button>
            <Button onClick={handleSubmit} disabled={!canSubmit} loading={loading}>
              {t('text_ops.send', { defaultValue: '执行' })}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

