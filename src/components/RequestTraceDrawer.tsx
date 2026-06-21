import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { logsApi, type RequestLogDetail } from '@/services/api/logs';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { isTraceableRequestPath, useTraceResolver } from '@/pages/hooks/useTraceResolver';
import type { ParsedLogLine } from '@/pages/hooks/logTypes';
import styles from './RequestTraceDrawer.module.scss';

interface RequestTraceDrawerProps {
  logLine: ParsedLogLine | null;
  open: boolean;
  onClose: () => void;
}

const JSON_PREVIEW_MAX_LINES = 200;
const HEADER_PREVIEW_LIMIT = 8;

type TabKey = 'requestHeaders' | 'requestBody' | 'responseHeaders' | 'responseBody';
type DetailViewMode = 'pretty' | 'raw' | 'preview';

type LogSectionBlock = {
  title: string;
  content: string;
};

type LogSections = Record<TabKey, LogSectionBlock[]>;
type HeaderRow = { key: string; value: string; priority: boolean };

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'requestHeaders', labelKey: 'trace.tab_request_headers' },
  { key: 'requestBody', labelKey: 'trace.tab_request_body' },
  { key: 'responseHeaders', labelKey: 'trace.tab_response_headers' },
  { key: 'responseBody', labelKey: 'trace.tab_response_body' },
];

const SECTION_TO_TAB: Record<string, TabKey> = {
  'REQUEST INFO': 'requestHeaders',
  HEADERS: 'requestHeaders',
  'REQUEST HEADERS': 'requestHeaders',
  'REQUEST BODY': 'requestBody',
  'RESPONSE HEADERS': 'responseHeaders',
  'RESPONSE BODY': 'responseBody',
  'API REQUEST': 'requestBody',
  'WEBSOCKET TIMELINE': 'requestBody',
  'API WEBSOCKET TIMELINE': 'requestBody',
  'API RESPONSE': 'responseBody',
  'API ERROR RESPONSE': 'responseBody',
};

const createEmptyLogSections = (): LogSections => ({
  requestHeaders: [],
  requestBody: [],
  responseHeaders: [],
  responseBody: [],
});

const currentTabHasContent = (sections: LogSections, activeTab: TabKey): boolean =>
  sections[activeTab].some((block) => block.content.trim().length > 0);

const PRIORITY_HEADERS = new Set([
  'authorization',
  'content-type',
  'x-trace-id',
  'x-request-id',
  'request-id',
  'traceparent',
]);

const SENSITIVE_HEADER_PATTERN = /(authorization|api-key|x-api-key|token|secret|cookie|set-cookie)/i;

const maskSensitiveValue = (key: string, value: string): string => {
  if (!SENSITIVE_HEADER_PATTERN.test(key)) return value;
  const bearer = value.match(/^(Bearer\s+)(.+)$/i);
  const prefix = bearer?.[1] ?? '';
  const secret = bearer?.[2] ?? value;
  if (secret.length <= 12) return `${prefix}***`;
  return `${prefix}${secret.slice(0, 8)}...${secret.slice(-4)}`;
};

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err !== 'object' || err === null) return '';
  if (!('message' in err)) return '';

  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
};

const parseJsonValue = (raw: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false };
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const decodeEscapedText = (raw: string): string => {
  const trimmed = raw.trim();
  const parsed = parseJsonValue(trimmed);
  if (parsed.ok && typeof parsed.value === 'string') {
    return parsed.value;
  }
  return raw;
};

const getNestedString = (value: unknown, path: string[]): string => {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return '';
    current = current[segment];
  }
  return typeof current === 'string' ? current : '';
};

const extractSseText = (value: unknown): string => {
  if (!isRecord(value)) return '';

  const choices = Array.isArray(value.choices) ? value.choices : [];
  const choiceText = choices
    .map((choice) =>
      [
        getNestedString(choice, ['delta', 'content']),
        getNestedString(choice, ['message', 'content']),
        getNestedString(choice, ['text']),
      ].find(Boolean) ?? ''
    )
    .join('');
  if (choiceText) return choiceText;

  return [
    getNestedString(value, ['delta']),
    getNestedString(value, ['text']),
    getNestedString(value, ['output_text']),
    getNestedString(value, ['content']),
  ].find(Boolean) ?? '';
};

const formatSseContent = (raw: string): string | null => {
  const dataLines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== '[DONE]');

  if (dataLines.length === 0) return null;

  const parsedValues = dataLines.map((line) => {
    const parsed = parseJsonValue(line);
    return parsed.ok ? parsed.value : line;
  });
  const aggregatedText = parsedValues.map(extractSseText).join('');

  if (aggregatedText.trim()) {
    return aggregatedText.trim();
  }

  return parsedValues
    .map((value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2)))
    .join('\n');
};

const formatPrettyContent = (raw: string | undefined): string => {
  if (!raw) return '';
  const decoded = decodeEscapedText(raw);
  const sseContent = formatSseContent(decoded);
  if (sseContent !== null) return sseContent;

  try {
    const parsed = JSON.parse(decoded);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return decoded;
  }
};

const isJsonContent = (raw: string | undefined): boolean => {
  if (!raw) return false;
  const trimmed = raw.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

const escapeHtml = (text: string): string =>
  text.replace(/[&<>]/g, (char) => {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    return '&gt;';
  });

/** Lightweight JSON syntax highlighting */
const highlightJson = (text: string): string => {
  return escapeHtml(text).replace(
    /("(?:[^"\\]|\\.)*")\s*:/g,
    '<span class="json-key">$1</span>:'
  ).replace(
    /:\s*("(?:[^"\\]|\\.)*")/g,
    ': <span class="json-string">$1</span>'
  ).replace(
    /:\s*(true|false)/g,
    ': <span class="json-bool">$1</span>'
  ).replace(
    /:\s*(null)/g,
    ': <span class="json-null">$1</span>'
  ).replace(
    /:\s*(-?\d+(?:\.\d+)?)/g,
    ': <span class="json-number">$1</span>'
  );
};

/** Parse key: value text into table rows */
const parseHeaderLines = (text: string): { key: string; value: string }[] => {
  if (!text) return [];
  const parsed = parseJsonValue(decodeEscapedText(text).trim());
  if (
    parsed.ok &&
    typeof parsed.value === 'object' &&
    parsed.value !== null &&
    !Array.isArray(parsed.value)
  ) {
    return Object.entries(parsed.value).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }));
  }
  return decodeEscapedText(text).split('\n')
    .map(line => {
      const sep = line.indexOf(':');
      if (sep <= 0) return null;
      return { key: line.slice(0, sep).trim(), value: line.slice(sep + 1).trim() };
    })
    .filter((row): row is { key: string; value: string } => row !== null && row.key.length > 0);
};

const parseHeaderRows = (text: string): HeaderRow[] =>
  parseHeaderLines(text)
    .map((row) => ({
      key: row.key,
      value: maskSensitiveValue(row.key, row.value),
      priority: PRIORITY_HEADERS.has(row.key.toLowerCase()),
    }))
    .sort((a, b) => Number(b.priority) - Number(a.priority));

const truncateLines = (text: string, maxLines: number): { truncated: string; total: number } => {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { truncated: text, total: lines.length };
  return {
    truncated: lines.slice(0, maxLines).join('\n'),
    total: lines.length,
  };
};

const normalizeSectionText = (text: string): string => text.replace(/^\n+|\n+$/g, '').trim();

const appendSection = (sections: LogSections, key: TabKey, text: string, title?: string) => {
  const normalized = normalizeSectionText(text);
  if (!normalized) return;
  sections[key].push({
    title: title ?? '',
    content: normalized,
  });
};

const stringifyBlocks = (blocks: LogSectionBlock[]): string =>
  blocks
    .map((block) => (block.title ? `=== ${block.title} ===\n${block.content}` : block.content))
    .join('\n\n');

const buildDisplayInfo = (
  content: string,
  expanded: boolean,
  viewMode: DetailViewMode
): { text: string; isTruncated: boolean; totalLines: number } => {
  const displayText = viewMode === 'raw' ? content : formatPrettyContent(content);
  if (viewMode === 'raw' || viewMode === 'preview' || expanded || !isJsonContent(displayText)) {
    return { text: displayText, isTruncated: false, totalLines: 0 };
  }
  const { truncated, total } = truncateLines(displayText, JSON_PREVIEW_MAX_LINES);
  return { text: truncated, isTruncated: total > JSON_PREVIEW_MAX_LINES, totalLines: total };
};

const splitResponseSection = (text: string): { headers: string; body: string } => {
  const normalized = normalizeSectionText(text);
  if (!normalized) return { headers: '', body: '' };

  const blankLineMatch = normalized.match(/\n\s*\n/);
  if (!blankLineMatch || blankLineMatch.index === undefined) {
    return { headers: normalized, body: '' };
  }

  return {
    headers: normalizeSectionText(normalized.slice(0, blankLineMatch.index)),
    body: normalizeSectionText(normalized.slice(blankLineMatch.index + blankLineMatch[0].length)),
  };
};

/** Extract request/response sections from the raw request log. */
const parseLogSections = (
  content: string | undefined
): LogSections => {
  const sections = createEmptyLogSections();
  if (!content) return sections;

  const normalized = content.replace(/\r\n?/g, '\n');
  const markerRegex = /^(?:---|===)\s*([A-Z ]+?)(?:\s+\d+)?\s*(?:---|===)\s*$/gim;
  const markers = Array.from(normalized.matchAll(markerRegex));

  if (markers.length === 0) {
    appendSection(sections, 'requestBody', normalized);
    return sections;
  }

  markers.forEach((marker, index) => {
    const sectionTitle = String(marker[1] ?? '').trim().toUpperCase();
    const sectionKey = SECTION_TO_TAB[sectionTitle];
    if (!sectionKey || marker.index === undefined) return;

    const sectionStart = marker.index + marker[0].length;
    const sectionEnd = markers[index + 1]?.index ?? normalized.length;
    const sectionText = normalized.slice(sectionStart, sectionEnd);

    if (sectionTitle === 'RESPONSE') {
      const { headers, body } = splitResponseSection(sectionText);
      appendSection(sections, 'responseHeaders', headers);
      appendSection(sections, 'responseBody', body);
      return;
    }

    appendSection(
      sections,
      sectionKey,
      sectionText,
      sectionKey === 'requestHeaders' ? sectionTitle : sectionTitle
    );
  });

  return sections;
};

/** Build a timeline scale from span durations. */
const buildTimeScale = (totalMs: number): string[] => {
  const steps = 4;
  const scale: string[] = [];
  for (let i = 0; i <= steps; i++) {
    scale.push(`${Math.round((totalMs / steps) * i)}ms`);
  }
  return scale;
};

export function RequestTraceDrawer({ logLine, open, onClose }: RequestTraceDrawerProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const traceScopeKey = `${apiBase}::${managementKey}`;
  const config = useConfigStore((state) => state.config);

  const [requestLogLoading, setRequestLogLoading] = useState(false);
  const [requestLogError, setRequestLogError] = useState('');
  const [requestLog, setRequestLog] = useState<RequestLogDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('requestBody');
  const [expandedSections, setExpandedSections] = useState<Set<TabKey>>(new Set());
  const [viewMode, setViewMode] = useState<DetailViewMode>('pretty');
  const [expandedHeaderTabs, setExpandedHeaderTabs] = useState<Set<TabKey>>(new Set());

  const trace = useTraceResolver({
    traceScopeKey,
    connectionStatus,
    config,
    requestLogDownloading: false,
  });

  // Load trace usage when log line changes
  useEffect(() => {
    if (!logLine || !open) return;

    setRequestLog(null);
    setRequestLogError('');
    setActiveTab(typeof logLine.statusCode === 'number' && logLine.statusCode >= 400 ? 'responseBody' : 'requestBody');
    setExpandedSections(new Set());
    setViewMode('pretty');
    setExpandedHeaderTabs(new Set());

    if (isTraceableRequestPath(logLine.path)) {
      trace.openTraceModal(logLine);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logLine, open]);

  // Load request log detail
  const requestLogId = logLine?.requestId || '';

  useEffect(() => {
    if (!requestLogId || connectionStatus !== 'connected' || !open) {
      setRequestLog(null);
      setRequestLogError('');
      setRequestLogLoading(false);
      return;
    }

    let cancelled = false;
    setRequestLog(null);
    setRequestLogError('');
    setRequestLogLoading(true);

    logsApi
      .fetchRequestLogById(requestLogId)
      .then((detail) => {
        if (cancelled) return;
        setRequestLog(detail);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRequestLogError(getErrorMessage(err) || t('logs.trace_request_log_unavailable'));
      })
      .finally(() => {
        if (!cancelled) setRequestLogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, open, requestLogId, t]);

  const sections = useMemo(() => parseLogSections(requestLog?.content), [requestLog?.content]);

  useEffect(() => {
    if (!open || currentTabHasContent(sections, activeTab)) return;
    const preferredTabs: TabKey[] =
      typeof logLine?.statusCode === 'number' && logLine.statusCode >= 400
        ? ['responseBody', 'responseHeaders', 'requestBody', 'requestHeaders']
        : ['requestBody', 'responseBody', 'requestHeaders', 'responseHeaders'];
    const firstAvailableTab = preferredTabs
      .map((key) => TABS.find((tab) => tab.key === key))
      .find((tab) => tab && currentTabHasContent(sections, tab.key));
    if (firstAvailableTab) {
      setActiveTab(firstAvailableTab.key);
    }
  }, [activeTab, logLine?.statusCode, open, sections]);

  // Copy current tab content
  const handleCopyTab = async () => {
    const content = stringifyBlocks(sections[activeTab]);
    if (!content) return;
    const ok = await copyToClipboard(content);
    showNotification(ok ? t('common.copied') : t('common.copy_failed'), ok ? 'success' : 'error');
  };

  const handleCopyAll = useCallback(async () => {
    const content = TABS
      .map((tab) => stringifyBlocks(sections[tab.key]))
      .filter(Boolean)
      .join('\n\n');
    if (!content) return;
    const ok = await copyToClipboard(content);
    showNotification(ok ? t('common.copied') : t('common.copy_failed'), ok ? 'success' : 'error');
  }, [sections, showNotification, t]);

  const handleCopyCurl = useCallback(async () => {
    const method = logLine?.method || 'POST';
    const url = logLine?.path || '';
    const requestHeaders = stringifyBlocks(sections.requestHeaders);
    const requestBody = stringifyBlocks(sections.requestBody);
    const headerArgs = parseHeaderLines(requestHeaders)
      .filter((row) => !/^version$|^timestamp$|^method$|^url$/i.test(row.key))
      .map((row) => `  -H '${row.key}: ${maskSensitiveValue(row.key, row.value).replace(/'/g, "'\\''")}'`);
    const bodyArg = requestBody ? [`  --data '${requestBody.replace(/'/g, "'\\''")}'`] : [];
    const curl = [`curl -X ${method} '${url}'`, ...headerArgs, ...bodyArg].join(' \\\n');
    const ok = await copyToClipboard(curl);
    showNotification(ok ? t('common.copied') : t('common.copy_failed'), ok ? 'success' : 'error');
  }, [logLine?.method, logLine?.path, sections, showNotification, t]);

  // Toggle expand for long content
  const toggleExpand = (tab: TabKey) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(tab)) {
        next.delete(tab);
      } else {
        next.add(tab);
      }
      return next;
    });
  };

  const toggleHeaderExpand = (tab: TabKey) => {
    setExpandedHeaderTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tab)) {
        next.delete(tab);
      } else {
        next.add(tab);
      }
      return next;
    });
  };

  // Compute timeline data
  const statusCode = typeof logLine?.statusCode === 'number' ? logLine.statusCode : 0;
  const isError = statusCode >= 500;
  const latencyMs = trace.traceLogLine?.latency
    ? parseFloat(String(trace.traceLogLine.latency).replace('ms', ''))
    : 0;

  // Build spans from log line + trace candidates
  const spans = useMemo(() => {
    const result: { name: string; durationMs: number; isError: boolean }[] = [];

    // Gateway span = total latency
    result.push({ name: 'Gateway', durationMs: latencyMs || 0, isError });

    // Auth span = estimate from message (if contains auth)
    if (trace.traceLogLine?.message?.includes('auth')) {
      result.push({ name: 'Auth-Service', durationMs: Math.round(latencyMs * 0.08), isError: false });
    }

    // Add trace candidates as downstream spans
    if (trace.traceCandidates.length > 0) {
      trace.traceCandidates.forEach((c, i) => {
        const name =
          c.detail.__modelName ||
          c.detail.__endpointPath ||
          `Downstream-${i + 1}`;
        const failed = c.detail.failed;
        result.push({
          name: String(name).substring(0, 28),
          durationMs: latencyMs > 0 ? Math.round(latencyMs * 0.6) : 0,
          isError: failed,
        });
      });
    } else if (trace.traceLogLine) {
      // Fallback: show AI-Proxy as the downstream
      result.push({
        name: 'AI-Proxy',
        durationMs: latencyMs > 0 ? Math.round(latencyMs * 0.85) : 0,
        isError,
      });
    }

    return result;
  }, [latencyMs, isError, trace.traceLogLine, trace.traceCandidates]);

  // Max duration for timeline scaling
  const maxDurationMs = useMemo(
    () => Math.max(latencyMs || 1, ...spans.map((s) => s.durationMs)),
    [latencyMs, spans]
  );

  const timeScale = useMemo(() => buildTimeScale(maxDurationMs), [maxDurationMs]);

  const currentTabBlocks = sections[activeTab];
  const currentTabContent = stringifyBlocks(currentTabBlocks);
  const hasAnyContent = TABS.some((tab) => currentTabHasContent(sections, tab.key));

  // Compute trace ID from request ID
  const traceId = logLine?.requestId ? `tr-${logLine.requestId.substring(0, 8)}...` : '-';

  const handleDownload = async () => {
    if (!requestLogId) return;
    try {
      const response = await logsApi.downloadRequestLogById(requestLogId);
      const url = window.URL.createObjectURL(response as unknown as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${requestLogId}.log`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showNotification(t('logs.request_log_download_success'), 'success');
    } catch {
      showNotification(t('logs.request_log_download_error', '下载失败'), 'error');
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={760}
      title={
        <div className={styles.drawerTitle}>
          <span>{t('trace.title')}</span>
          <span className={styles.traceId}>
            {t('trace.trace_id')}: {traceId}
          </span>
          <div className={styles.drawerTitleActions}>
            <button type="button" onClick={handleCopyCurl} disabled={!hasAnyContent}>
              Copy cURL
            </button>
            <button type="button" onClick={handleCopyAll} disabled={!hasAnyContent}>
              Copy All
            </button>
          </div>
        </div>
      }
    >
      <div className={styles.container}>
        {/* ====== Meta Header ====== */}
        <div className={`${styles.metaCard} ${isError ? styles.metaError : styles.metaSuccess}`}>
          <div className={styles.metaTopRow}>
            <span className={styles.methodTag}>{logLine?.method || '-'}</span>
            <span className={styles.pathText} title={logLine?.path || ''}>
              {logLine?.path || '-'}
            </span>
            <span className={`${styles.statusBadge} ${isError ? styles.statusError : styles.statusOk}`}>
              {statusCode || '-'}
            </span>
          </div>
          <div className={styles.metaGrid}>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>{t('trace.latency')}</span>
              <span className={styles.metaValue}>{trace.traceLogLine?.latency || logLine?.latency || '-'}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>{t('trace.ip')}</span>
              <span className={styles.metaValue}>{logLine?.ip || '-'}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>{t('trace.timestamp')}</span>
              <span className={styles.metaValue}>{logLine?.timestamp || '-'}</span>
            </div>
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>{t('trace.request_id')}</span>
              <span className={`${styles.metaValue} ${styles.metaMono}`}>
                {logLine?.requestId || '-'}
              </span>
              {logLine?.requestId && (
                <button
                  className={styles.copyBtnSmall}
                  onClick={() => {
                    void copyToClipboard(logLine.requestId ?? '').then((ok) => {
                      showNotification(ok ? t('common.copied') : t('common.copy_failed'), ok ? 'success' : 'error');
                    });
                  }}
                  title={t('common.copy')}
                >
                  {t('common.copy')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ====== Timeline Topology ====== */}
        <div className={styles.timelineSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionTitle}>{t('trace.timeline_title')}</span>
          </div>

          {/* Time scale */}
          <div className={styles.timeScale}>
            {timeScale.map((tick, i) => (
              <span key={i} className={styles.timeScaleTick}>
                {tick}
              </span>
            ))}
          </div>

          {/* Spans */}
          <div className={styles.spans}>
            {spans.map((span, i) => {
              const widthPct = maxDurationMs > 0 ? (span.durationMs / maxDurationMs) * 100 : 0;
              return (
                <div key={`${span.name}-${i}`} className={styles.spanRow}>
                  <span className={styles.spanName} title={span.name}>
                    {span.name}
                  </span>
                  <div className={styles.spanBarTrack}>
                    <div
                      className={`${styles.spanBarFill} ${span.isError ? styles.spanBarError : ''}`}
                      style={{ width: `${Math.max(widthPct, 2)}%` }}
                    />
                  </div>
                  <span className={`${styles.spanDuration} ${span.isError ? styles.spanDurationError : ''}`}>
                    {span.durationMs}ms
                    {span.isError && <span className={styles.spanErrorMark}>💥</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ====== Tabs + Detail ====== */}
        <div className={styles.detailSection}>
          <div className={styles.tabBar}>
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className={`${styles.tabItem} ${activeTab === tab.key ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {t(tab.labelKey)}
              </button>
            ))}
          </div>

          <div className={styles.tabToolbar}>
            <div className={styles.viewModeGroup}>
              {(['pretty', 'raw', 'preview'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={viewMode === mode ? styles.viewModeActive : ''}
                  onClick={() => setViewMode(mode)}
                  disabled={!currentTabContent}
                >
                  {mode === 'pretty' ? 'Pretty' : mode === 'raw' ? 'Raw' : 'Preview'}
                </button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={handleCopyTab} disabled={!currentTabContent}>
              {t('trace.copy_raw')}
            </Button>
            {requestLogId && (
              <Button variant="secondary" size="sm" onClick={handleDownload}>
                {t('trace.download_log')}
              </Button>
            )}
          </div>

          <div className={styles.tabContent}>
            {requestLogLoading ? (
              <div className={styles.loadingWrap}>
                <LoadingSpinner />
                <span>{t('logs.trace_request_log_loading')}</span>
              </div>
            ) : requestLogError ? (
              <div className={styles.errorHint}>{requestLogError}</div>
            ) : currentTabBlocks.length > 0 ? (
              currentTabBlocks.map((block, blockIndex) => {
                const displayInfo = buildDisplayInfo(
                  block.content,
                  expandedSections.has(activeTab),
                  viewMode
                );
                const blockKey = `${activeTab}-${block.title || 'section'}-${blockIndex}`;
                const isHeaderTab = activeTab === 'requestHeaders' || activeTab === 'responseHeaders';
                const headerRows = isHeaderTab ? parseHeaderRows(block.content) : [];
                const headerExpanded = expandedHeaderTabs.has(activeTab);
                const visibleHeaderRows = headerExpanded
                  ? headerRows
                  : [
                      ...headerRows.filter((row) => row.priority),
                      ...headerRows.filter((row) => !row.priority).slice(0, HEADER_PREVIEW_LIMIT),
                    ];
                const hiddenHeaderCount = headerRows.length - visibleHeaderRows.length;
                return (
                  <section key={blockKey} className={styles.logSectionBlock}>
                    {block.title && (
                      <div className={styles.logSectionTitle}>{block.title}</div>
                    )}
                    {isHeaderTab && viewMode === 'pretty' ? (
                      <div className={styles.headerTable}>
                        {visibleHeaderRows.map((row, i) => (
                          <div
                            key={`${blockKey}-${i}`}
                            className={`${styles.headerRow} ${row.priority ? styles.headerRowPriority : ''}`}
                          >
                            <span className={styles.headerKey}>{row.key}</span>
                            <span className={styles.headerValue}>{row.value}</span>
                          </div>
                        ))}
                        {hiddenHeaderCount > 0 && (
                          <button
                            type="button"
                            className={styles.headerExpandButton}
                            onClick={() => toggleHeaderExpand(activeTab)}
                          >
                            Show {hiddenHeaderCount} more headers
                          </button>
                        )}
                      </div>
                    ) : viewMode === 'preview' ? (
                      <div className={styles.previewBlock}>{displayInfo.text}</div>
                    ) : viewMode === 'pretty' && isJsonContent(displayInfo.text) ? (
                      <>
                        <pre className={`${styles.codeBlock} ${styles.codeHighlight}`} spellCheck={false}>
                          <code dangerouslySetInnerHTML={{ __html: highlightJson(displayInfo.text) }} />
                        </pre>
                        {displayInfo.isTruncated && (
                          <button className={styles.expandBtn} onClick={() => toggleExpand(activeTab)}>
                            {t('trace.expand_all', { total: displayInfo.totalLines })}
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <pre className={styles.codeBlock} spellCheck={false}>
                          <code>{displayInfo.text}</code>
                        </pre>
                        {displayInfo.isTruncated && (
                          <button className={styles.expandBtn} onClick={() => toggleExpand(activeTab)}>
                            {t('trace.expand_all', { total: displayInfo.totalLines })}
                          </button>
                        )}
                      </>
                    )}
                  </section>
                );
              })
            ) : (
              <div className={styles.hint}>{t('trace.no_data')}</div>
            )}
          </div>
        </div>

        {/* ====== Usage Candidates (collapsible) ====== */}
        {trace.traceCandidates.length > 0 && (
          <details className={styles.candidatesSection}>
            <summary className={styles.candidatesSummary}>
              {t('logs.trace_candidates_title')} ({trace.traceCandidates.length})
            </summary>
            <div className={styles.candidatesList}>
              {trace.traceCandidates.map((c, i) => {
                const sourceInfo = trace.resolveTraceSourceInfo(
                  String(c.detail.source ?? ''),
                  c.detail.auth_index
                );
                return (
                  <div key={i} className={styles.candidateItem}>
                    <div className={styles.candidateRow}>
                      {c.modelMatched && (
                        <span className={styles.badge}>{t('logs.trace_model_matched')}</span>
                      )}
                      <span className={styles.candidateEndpoint}>
                        {c.detail.__endpoint}
                      </span>
                      <span className={styles.candidateModel}>
                        {c.detail.__modelName || '-'}
                      </span>
                      <span className={styles.candidateSource}>
                        {sourceInfo.displayName}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>
    </Drawer>
  );
}
