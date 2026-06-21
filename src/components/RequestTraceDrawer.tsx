import { useEffect, useMemo, useState } from 'react';
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

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err !== 'object' || err === null) return '';
  if (!('message' in err)) return '';

  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
};

const formatJson = (raw: string | undefined): string => {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

const isJsonContent = (raw: string | undefined): boolean => {
  if (!raw) return false;
  const trimmed = raw.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

const truncateLines = (text: string, maxLines: number): { truncated: string; total: number } => {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { truncated: text, total: lines.length };
  return {
    truncated: lines.slice(0, maxLines).join('\n'),
    total: lines.length,
  };
};

/**
 * 从原始请求日志内容中提取 request body、response headers、response body
 */
const parseLogSections = (
  content: string | undefined
): {
  requestHeaders: string;
  requestBody: string;
  responseHeaders: string;
  responseBody: string;
} => {
  if (!content) return { requestHeaders: '', requestBody: '', responseHeaders: '', responseBody: '' };

  const requestHeaderMatch = content.match(/^--- REQUEST HEADERS ---\n([\s\S]*?)(?=\n--- |$)/);
  const requestBodyMatch = content.match(/^--- REQUEST BODY ---\n([\s\S]*?)(?=\n--- |$)/);
  const responseHeaderMatch = content.match(/^--- RESPONSE HEADERS ---\n([\s\S]*?)(?=\n--- |$)/);
  const responseBodyMatch = content.match(/^--- RESPONSE BODY ---\n([\s\S]*?)(?=\n--- |$)/);

  return {
    requestHeaders: (requestHeaderMatch?.[1] ?? '').trim(),
    requestBody: (requestBodyMatch?.[1] ?? '').trim(),
    responseHeaders: (responseHeaderMatch?.[1] ?? '').trim(),
    responseBody: (responseBodyMatch?.[1] ?? '').trim(),
  };
};

type TabKey = 'requestHeaders' | 'requestBody' | 'responseHeaders' | 'responseBody';

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'requestHeaders', labelKey: 'trace.tab_request_headers' },
  { key: 'requestBody', labelKey: 'trace.tab_request_body' },
  { key: 'responseHeaders', labelKey: 'trace.tab_response_headers' },
  { key: 'responseBody', labelKey: 'trace.tab_response_body' },
];

/**
 * 从 span 列表生成时间刻度
 */
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
    setActiveTab('requestBody');
    setExpandedSections(new Set());

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

  // Parse log content into sections
  const sections = useMemo(() => parseLogSections(requestLog?.content), [requestLog?.content]);

  // Copy JSON
  const handleCopyTab = async () => {
    const content = sections[activeTab];
    if (!content) return;
    const ok = await copyToClipboard(content);
    showNotification(ok ? t('common.copied') : t('common.copy_failed'), ok ? 'success' : 'error');
  };

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

  // Truncate long content
  const currentTabContent = sections[activeTab];
  const tabContentInfo = useMemo(() => {
    if (expandedSections.has(activeTab) || !isJsonContent(currentTabContent)) {
      return { text: formatJson(currentTabContent), isTruncated: false, totalLines: 0 };
    }
    const formatted = formatJson(currentTabContent);
    const { truncated, total } = truncateLines(formatted, JSON_PREVIEW_MAX_LINES);
    return { text: truncated, isTruncated: total > JSON_PREVIEW_MAX_LINES, totalLines: total };
  }, [activeTab, currentTabContent, expandedSections]);

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
      width={620}
      title={
        <div className={styles.drawerTitle}>
          <span>{t('trace.title')}</span>
          <span className={styles.traceId}>
            {t('trace.trace_id')}: {traceId}
          </span>
        </div>
      }
    >
      <div className={styles.container}>
        {/* ====== 第一段：Meta Header ====== */}
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

        {/* ====== 第二段：Timeline Topology ====== */}
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

        {/* ====== 第三段：Tabs + Detail ====== */}
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
            ) : currentTabContent ? (
              <>
                <pre className={styles.codeBlock} spellCheck={false}>
                  <code>{tabContentInfo.text}</code>
                </pre>
                {tabContentInfo.isTruncated && (
                  <button className={styles.expandBtn} onClick={() => toggleExpand(activeTab)}>
                    {t('trace.expand_all', { total: tabContentInfo.totalLines })}
                  </button>
                )}
              </>
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
