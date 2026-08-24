import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconDownload } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { RequestTraceDrawer } from '@/components/RequestTraceDrawer';
import { Select } from '@/components/ui/Select';
import { authFilesApi } from '@/services/api/authFiles';
import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import type { UsageEventDetail } from '@/stores/useUsageStatsStore';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import { parseTimestampMs } from '@/utils/timestamp';
import {
  collectUsageDetailsWithEndpoint,
  extractLatencyMs,
  extractTotalTokens,
  formatDurationMs,
  LATENCY_SOURCE_FIELD,
  normalizeAuthIndex,
  type UsageDetailWithEndpoint,
  type UsageModelInfo,
  type UsageRequestInfo,
  type UsageThinking,
} from '@/utils/usage';
import { downloadBlob } from '@/utils/download';
import type { ParsedLogLine } from '@/pages/hooks/logTypes';
import styles from '@/pages/UsagePage.module.scss';

const ALL_FILTER = '__all__';
const MAX_RENDERED_EVENTS = 500;

// Latency severity classes for visual scanning.
// - Failed results: dimmed gray (regardless of time)
// - Success results:
//   < 4s: green (smooth)
//   < 6s: yellow (normal)
//   < 10s: orange (slow)
//   >= 10s: red (severe)
const getLatencyClassName = (latencyMs: number | null, failed: boolean): string => {
  if (latencyMs === null) return '';
  if (failed) return styles.latencyFailed;
  if (latencyMs < 4000) return styles.latencySmooth;
  if (latencyMs < 6000) return styles.latencyNormal;
  if (latencyMs < 10000) return styles.latencySlow;
  return styles.latencyCritical;
};

const formatEventTimestamp = (date: Date | null, fallback: string): string => {
  if (!date) return fallback || '-';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${month}/${day} ${hour}:${minute}:${second}`;
};

const getThinkingClassName = (thinkingLabel: string): string => {
  const normalized = thinkingLabel.toLowerCase();
  if (normalized.includes('xhigh')) return styles.thinkingXHigh;
  if (normalized.includes('high')) return styles.thinkingHigh;
  if (normalized.includes('medium')) return styles.thinkingMedium;
  if (normalized.includes('low')) return styles.thinkingLow;
  return '';
};

type RequestEventResultTone = 'success' | 'warning' | 'failed' | 'unknown';

const getResultTone = (
  statusCode: number | string | undefined,
  failed: boolean
): RequestEventResultTone => {
  if (typeof statusCode === 'number') {
    if (statusCode >= 500) return 'failed';
    if (statusCode >= 400) return 'warning';
    if (statusCode >= 200 && statusCode < 400) return 'success';
  }
  if (typeof statusCode === 'string' && statusCode.trim()) {
    return failed ? 'failed' : 'unknown';
  }
  return 'unknown';
};

const formatStatusCode = (statusCode: number | string | undefined): string => {
  if (typeof statusCode === 'number') return String(statusCode);
  if (typeof statusCode === 'string') return statusCode.trim();
  return '';
};

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined) return '-';
  const text = String(value).trim();
  return text || '-';
};

const hasAnyTokens = (row: RequestEventRow): boolean =>
  row.inputTokens > 0 ||
  row.outputTokens > 0 ||
  row.reasoningTokens > 0 ||
  row.cachedTokens > 0 ||
  row.totalTokens > 0;

const isMissingSuccessfulTokenUsage = (row: RequestEventRow): boolean =>
  row.resultTone === 'success' && !hasAnyTokens(row);

const buildRequestEventsUpdateKey = (rows: RequestEventRow[]): string =>
  rows
    .slice(0, MAX_RENDERED_EVENTS)
    .map((row) =>
      [
        row.id,
        row.statusLabel,
        row.failed ? '1' : '0',
        row.latencyMs ?? '',
        row.inputTokens,
        row.outputTokens,
        row.reasoningTokens,
        row.cachedTokens,
        row.totalTokens,
        row.thinkingLabel,
      ].join(':')
    )
    .join('|');

type RequestEventRow = {
  id: string;
  timestamp: string;
  timestampMs: number;
  timestampLabel: string;
  model: string;
  sourceKey: string;
  sourceRaw: string;
  source: string;
  sourceType: string;
  authIndex: string;
  failed: boolean;
  requestId: string;
  requestPath: string;
  requestMethod: ParsedLogLine['method'];
  statusCode?: number | string;
  statusLabel: string;
  resultTone: RequestEventResultTone;
  requestInfo: UsageRequestInfo | null;
  modelInfo: UsageModelInfo | null;
  latencyMs: number | null;
  thinking: UsageThinking | null;
  thinkingLabel: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
};

export interface RequestEventsDetailsCardProps {
  usage: unknown;
  recentDetails?: UsageEventDetail[];
  loading: boolean;
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
  selectedModelFilter?: string;
  onSelectedModelFilterChange?: (value: string) => void;
}

type ActiveToast = {
  kind: 'result' | 'model';
  row: RequestEventRow;
};

const normalizeTraceMethod = (value: unknown): ParsedLogLine['method'] => {
  const method = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (
    method === 'GET' ||
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE' ||
    method === 'OPTIONS' ||
    method === 'HEAD'
  ) {
    return method;
  }
  return undefined;
};

const buildTraceLineFromRow = (row: RequestEventRow): ParsedLogLine => ({
  raw: [
    row.timestamp,
    row.requestMethod ?? '',
    row.requestPath,
    row.statusLabel,
    row.model,
  ].filter(Boolean).join(' '),
  timestamp: row.timestamp,
  requestId: row.requestId || undefined,
  statusCode: typeof row.statusCode === 'number' ? row.statusCode : undefined,
  latency: formatDurationMs(row.latencyMs),
  method: row.requestMethod,
  path: row.requestPath,
  message: `model=${row.model} source=${row.sourceRaw}`,
});

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const normalizeThinkingText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const preferThinkingLevelLabel = (level: string): boolean => {
  const normalized = level.toLowerCase();
  return normalized === 'xhigh' || normalized === 'max';
};

const formatThinkingLabel = (thinking: UsageThinking | null): string => {
  if (!thinking) return '-';

  const intensity = normalizeThinkingText(thinking.intensity);
  const level = normalizeThinkingText(thinking.level);
  const mode = normalizeThinkingText(thinking.mode);
  const budget =
    typeof thinking.budget === 'number' && Number.isFinite(thinking.budget)
      ? thinking.budget
      : null;
  const label =
    (preferThinkingLevelLabel(level) ? level : '') ||
    intensity ||
    level ||
    (budget !== null ? String(budget) : mode);
  const budgetLabel = budget !== null ? budget.toLocaleString() : null;

  if (!label) return '-';
  if (budgetLabel !== null && label === String(budget)) {
    return budgetLabel;
  }
  if (mode === 'budget' && budget !== null && budget > 0) {
    return `${label} (${budgetLabel})`;
  }
  if (budget === -1 && label !== 'auto') {
    return `${label} (-1)`;
  }
  return label;
};

const encodeCsv = (value: string | number): string => {
  const text = String(value ?? '');
  const trimmedLeft = text.replace(/^\s+/, '');
  const safeText = trimmedLeft && /^[=+\-@]/.test(trimmedLeft) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
};

export function RequestEventsDetailsCard({
  usage,
  recentDetails = [],
  loading,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
  selectedModelFilter,
  onSelectedModelFilterChange,
}: RequestEventsDetailsCardProps) {
  const { t } = useTranslation();
  const latencyHint = t('usage_stats.latency_unit_hint', {
    field: LATENCY_SOURCE_FIELD,
    unit: t('usage_stats.duration_unit_ms'),
  });

  const [localModelFilter, setLocalModelFilter] = useState(ALL_FILTER);
  const [sourceFilter, setSourceFilter] = useState(ALL_FILTER);
  const [authIndexFilter, setAuthIndexFilter] = useState(ALL_FILTER);
  const [searchText, setSearchText] = useState('');
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());
  const [activeToast, setActiveToast] = useState<ActiveToast | null>(null);
  const [traceDrawerLine, setTraceDrawerLine] = useState<ParsedLogLine | null>(null);
  const toastRef = useRef<HTMLDivElement | null>(null);
  const tableWrapperRef = useRef<HTMLDivElement | null>(null);
  const previousRequestEventsUpdateKeyRef = useRef<string | null>(null);
  // Keep the drawer mounted while the pointer travels from a result cell into
  // the drawer panel; the trace drawer exposes panel hover/focus events that
  // let us cancel a pending close.
  const closeTraceDrawerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelScheduledClose = useCallback(() => {
    if (closeTraceDrawerTimerRef.current !== null) {
      clearTimeout(closeTraceDrawerTimerRef.current);
      closeTraceDrawerTimerRef.current = null;
    }
  }, []);
  const scheduleCloseTraceDrawer = useCallback(() => {
    cancelScheduledClose();
    closeTraceDrawerTimerRef.current = setTimeout(() => {
      closeTraceDrawerTimerRef.current = null;
      setTraceDrawerLine(null);
    }, 180);
  }, [cancelScheduledClose]);
  useEffect(
    () => () => {
      if (closeTraceDrawerTimerRef.current !== null) {
        clearTimeout(closeTraceDrawerTimerRef.current);
        closeTraceDrawerTimerRef.current = null;
      }
    },
    []
  );
  const modelFilter = selectedModelFilter ?? localModelFilter;
  const handleModelFilterChange = useCallback(
    (value: string) => {
      if (selectedModelFilter === undefined) {
        setLocalModelFilter(value);
      }
      onSelectedModelFilterChange?.(value);
    },
    [onSelectedModelFilterChange, selectedModelFilter]
  );

  useEffect(() => {
    let cancelled = false;
    authFilesApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
        if (!Array.isArray(files)) return;
        const map = new Map<string, CredentialInfo>();
        files.forEach((file) => {
          const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
          if (!key) return;
          map.set(key, {
            name: file.name || key,
            type: (file.type || file.provider || '').toString(),
          });
        });
        setAuthFileMap(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeToast) return;
    const isToastTarget = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      if (toastRef.current?.contains(target)) return true;
      return (
        target instanceof Element &&
        target.closest('[data-request-events-toast-trigger="true"]') !== null
      );
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (isToastTarget(target)) return;
      setActiveToast(null);
    };
    const handlePointerOver = (event: PointerEvent) => {
      if (isToastTarget(event.target)) return;
      setActiveToast(null);
    };
    const handleFocusIn = (event: FocusEvent) => {
      if (isToastTarget(event.target)) return;
      setActiveToast(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveToast(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointerover', handlePointerOver);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('pointerover', handlePointerOver);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeToast]);

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders,
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const rows = useMemo<RequestEventRow[]>(() => {
    const liveDetails: UsageDetailWithEndpoint[] = recentDetails.map((event) => {
      const timestamp = event.requested_at || '';
      const timestampMs = parseTimestampMs(timestamp);
      return {
        event_id: event.id,
        timestamp,
        source: event.source || '',
        auth_index: event.auth_index ?? null,
        request_id: event.request_id,
        latency_ms: event.duration_ms,
        tokens: {
          input_tokens: event.tokens?.input ?? 0,
          output_tokens: event.tokens?.output ?? 0,
          reasoning_tokens: event.tokens?.reasoning ?? 0,
          cached_tokens: event.tokens?.cached ?? 0,
          total_tokens: event.tokens?.total ?? 0,
        },
        thinking: event.thinking ?? null,
        status_code: event.status_code,
        failed: event.failed === true,
        __modelName: event.model || 'unknown',
        __endpoint: event.api_key || '',
        __timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
      };
    });
    const seenEventIds = new Set<number>();
    const details = [...liveDetails, ...collectUsageDetailsWithEndpoint(usage)].filter((detail) => {
      if (typeof detail.event_id !== 'number' || detail.event_id <= 0) return true;
      if (seenEventIds.has(detail.event_id)) return false;
      seenEventIds.add(detail.event_id);
      return true;
    });

    const baseRows = details.map((detail, index) => {
      const timestamp = detail.timestamp;
      const timestampMs =
        typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0
          ? detail.__timestampMs
          : parseTimestampMs(timestamp);
      const date = Number.isNaN(timestampMs) ? null : new Date(timestampMs);
      const sourceRaw = String(detail.source ?? '').trim();
      const authIndexRaw = detail.auth_index as unknown;
      const authIndex =
        authIndexRaw === null || authIndexRaw === undefined || authIndexRaw === ''
          ? '-'
          : String(authIndexRaw);
      const sourceInfo = resolveSourceDisplay(sourceRaw, authIndexRaw, sourceInfoMap, authFileMap);
      const source = sourceInfo.displayName;
      const sourceKey = sourceInfo.identityKey ?? `source:${sourceRaw || source}`;
      const sourceType = sourceInfo.type;
      const model = String(detail.__modelName ?? '').trim() || '-';
      const inputTokens = Math.max(toNumber(detail.tokens?.input_tokens), 0);
      const outputTokens = Math.max(toNumber(detail.tokens?.output_tokens), 0);
      const reasoningTokens = Math.max(toNumber(detail.tokens?.reasoning_tokens), 0);
      const cachedTokens = Math.max(
        Math.max(toNumber(detail.tokens?.cached_tokens), 0),
        Math.max(toNumber(detail.tokens?.cache_tokens), 0)
      );
      const totalTokens = Math.max(
        toNumber(detail.tokens?.total_tokens),
        extractTotalTokens(detail)
      );
      const latencyMs = extractLatencyMs(detail);
      const thinking = detail.thinking ?? null;
      const thinkingLabel = formatThinkingLabel(thinking);
      const statusCode = detail.status_code;
      const statusLabel = formatStatusCode(statusCode);
      const resultTone = getResultTone(statusCode, detail.failed === true);
      const requestId = String(detail.request_id ?? '').trim();
      const requestMethod = normalizeTraceMethod(detail.request?.method || detail.__endpointMethod);
      const requestPath =
        detail.__endpointPath ||
        detail.request?.display_name ||
        detail.request?.upstream_url ||
        detail.request?.upstream ||
        '-';

      return {
        id:
          typeof detail.event_id === 'number' && detail.event_id > 0
            ? `event-${detail.event_id}`
            : `${timestamp}-${model}-${sourceKey}-${authIndex}-${index}`,
        timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: formatEventTimestamp(date, timestamp),
        model,
        sourceKey,
        sourceRaw: sourceRaw || '-',
        source,
        sourceType,
        authIndex,
        failed: detail.failed === true,
        requestId,
        requestPath,
        requestMethod,
        statusCode,
        statusLabel,
        resultTone,
        requestInfo: detail.request ?? null,
        modelInfo: detail.model_info ?? null,
        latencyMs,
        thinking,
        thinkingLabel,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedTokens,
        totalTokens,
      };
    });

    const sourceLabelKeyMap = new Map<string, Set<string>>();
    baseRows.forEach((row) => {
      const keys = sourceLabelKeyMap.get(row.source) ?? new Set<string>();
      keys.add(row.sourceKey);
      sourceLabelKeyMap.set(row.source, keys);
    });

    const buildDisambiguatedSourceLabel = (row: RequestEventRow) => {
      const labelKeyCount = sourceLabelKeyMap.get(row.source)?.size ?? 0;
      if (labelKeyCount <= 1) {
        return row.source;
      }

      if (row.authIndex !== '-') {
        return `${row.source} · ${row.authIndex}`;
      }

      if (row.sourceRaw !== '-' && row.sourceRaw !== row.source) {
        return `${row.source} · ${row.sourceRaw}`;
      }

      if (row.sourceType) {
        return `${row.source} · ${row.sourceType}`;
      }

      return `${row.source} · ${row.sourceKey}`;
    };

    return baseRows
      .map((row) => ({
        ...row,
        source: buildDisambiguatedSourceLabel(row),
      }))
      .sort((a, b) => b.timestampMs - a.timestampMs);
  }, [authFileMap, recentDetails, sourceInfoMap, usage]);

  const hasLatencyData = useMemo(() => rows.some((row) => row.latencyMs !== null), [rows]);

  const modelOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(new Set(rows.map((row) => row.model))).map((model) => ({
        value: model,
        label: model,
      })),
    ],
    [rows, t]
  );

  const sourceOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    rows.forEach((row) => {
      if (!optionMap.has(row.sourceKey)) {
        optionMap.set(row.sourceKey, row.source);
      }
    });

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(optionMap.entries()).map(([value, label]) => ({
        value,
        label,
      })),
    ];
  }, [rows, t]);

  const authIndexOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(new Set(rows.map((row) => row.authIndex))).map((authIndex) => ({
        value: authIndex,
        label: authIndex,
      })),
    ],
    [rows, t]
  );

  const modelOptionSet = useMemo(
    () => new Set(modelOptions.map((option) => option.value)),
    [modelOptions]
  );
  const sourceOptionSet = useMemo(
    () => new Set(sourceOptions.map((option) => option.value)),
    [sourceOptions]
  );
  const authIndexOptionSet = useMemo(
    () => new Set(authIndexOptions.map((option) => option.value)),
    [authIndexOptions]
  );

  const effectiveModelFilter = modelOptionSet.has(modelFilter) ? modelFilter : ALL_FILTER;
  const effectiveSourceFilter = sourceOptionSet.has(sourceFilter) ? sourceFilter : ALL_FILTER;
  const effectiveAuthIndexFilter = authIndexOptionSet.has(authIndexFilter)
    ? authIndexFilter
    : ALL_FILTER;
  const normalizedSearchText = searchText.trim().toLowerCase();

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const modelMatched =
          effectiveModelFilter === ALL_FILTER || row.model === effectiveModelFilter;
        const sourceMatched =
          effectiveSourceFilter === ALL_FILTER || row.sourceKey === effectiveSourceFilter;
        const authIndexMatched =
          effectiveAuthIndexFilter === ALL_FILTER || row.authIndex === effectiveAuthIndexFilter;
        const searchMatched =
          !normalizedSearchText ||
          [
            row.model,
            row.source,
            row.sourceRaw,
            row.sourceType,
            row.authIndex,
            row.thinkingLabel,
            row.statusLabel,
            row.requestInfo?.display_name,
            row.requestInfo?.upstream,
            row.requestInfo?.upstream_url,
            row.modelInfo?.platform_model,
            row.modelInfo?.upstream_model,
            row.modelInfo?.actual_source,
          ]
            .join(' ')
            .toLowerCase()
            .includes(normalizedSearchText);
        return modelMatched && sourceMatched && authIndexMatched && searchMatched;
      }),
    [
      effectiveAuthIndexFilter,
      effectiveModelFilter,
      effectiveSourceFilter,
      normalizedSearchText,
      rows,
    ]
  );

  const renderedRows = useMemo(() => filteredRows.slice(0, MAX_RENDERED_EVENTS), [filteredRows]);
  const requestEventsUpdateKey = useMemo(() => buildRequestEventsUpdateKey(rows), [rows]);

  useEffect(() => {
    const previousUpdateKey = previousRequestEventsUpdateKeyRef.current;
    previousRequestEventsUpdateKeyRef.current = requestEventsUpdateKey;

    if (previousUpdateKey !== null && previousUpdateKey !== requestEventsUpdateKey) {
      const tableWrapper = tableWrapperRef.current;
      if (tableWrapper) {
        tableWrapper.scrollTop = 0;
      }
    }
  }, [requestEventsUpdateKey]);

  const hasActiveFilters =
    effectiveModelFilter !== ALL_FILTER ||
    effectiveSourceFilter !== ALL_FILTER ||
    effectiveAuthIndexFilter !== ALL_FILTER ||
    normalizedSearchText.length > 0;

  const handleClearFilters = () => {
    handleModelFilterChange(ALL_FILTER);
    setSourceFilter(ALL_FILTER);
    setAuthIndexFilter(ALL_FILTER);
    setSearchText('');
  };

  const handleExportCsv = () => {
    if (!filteredRows.length) return;

    const csvHeader = [
      'timestamp',
      'model',
      'source',
      'source_raw',
      'auth_index',
      'result',
      ...(hasLatencyData ? ['latency_ms'] : []),
      'thinking_intensity',
      'thinking_mode',
      'thinking_level',
      'thinking_budget',
      'input_tokens',
      'output_tokens',
      'reasoning_tokens',
      'cached_tokens',
      'total_tokens',
    ];

    const csvRows = filteredRows.map((row) =>
      [
        row.timestamp,
        row.model,
        row.source,
        row.sourceRaw,
        row.authIndex,
        row.statusLabel || '-',
        ...(hasLatencyData ? [row.latencyMs ?? ''] : []),
        row.thinkingLabel === '-' ? '' : row.thinkingLabel,
        row.thinking?.mode ?? '',
        row.thinking?.level ?? '',
        row.thinking?.budget ?? '',
        row.inputTokens,
        row.outputTokens,
        row.reasoningTokens,
        row.cachedTokens,
        row.totalTokens,
      ]
        .map((value) => encodeCsv(value))
        .join(',')
    );

    const content = [csvHeader.join(','), ...csvRows].join('\n');
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.csv`,
      blob: new Blob([content], { type: 'text/csv;charset=utf-8' }),
    });
  };

  const handleExportJson = () => {
    if (!filteredRows.length) return;

    const payload = filteredRows.map((row) => ({
      timestamp: row.timestamp,
      model: row.model,
      source: row.source,
      source_raw: row.sourceRaw,
      auth_index: row.authIndex,
      result: row.statusLabel || '-',
      ...(row.statusCode !== undefined ? { status_code: row.statusCode } : {}),
      failed: row.failed,
      ...(row.requestInfo ? { request: row.requestInfo } : {}),
      ...(row.modelInfo ? { model_info: row.modelInfo } : {}),
      ...(hasLatencyData && row.latencyMs !== null ? { latency_ms: row.latencyMs } : {}),
      ...(row.thinking ? { thinking: row.thinking } : {}),
      tokens: {
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        reasoning_tokens: row.reasoningTokens,
        cached_tokens: row.cachedTokens,
        total_tokens: row.totalTokens,
      },
    }));

    const content = JSON.stringify(payload, null, 2);
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.json`,
      blob: new Blob([content], { type: 'application/json;charset=utf-8' }),
    });
  };

  const openToast = useCallback((kind: ActiveToast['kind'], row: RequestEventRow) => {
    setActiveToast({ kind, row });
  }, []);

  const openTraceDrawer = useCallback(
    (row: RequestEventRow) => {
      cancelScheduledClose();
      setActiveToast(null);
      setTraceDrawerLine(buildTraceLineFromRow(row));
    },
    [cancelScheduledClose]
  );

  const closeTraceDrawer = useCallback(() => {
    scheduleCloseTraceDrawer();
  }, [scheduleCloseTraceDrawer]);

  const handleDrawerPanelEnter = useCallback(() => {
    cancelScheduledClose();
  }, [cancelScheduledClose]);

  const handleDrawerPanelLeave = useCallback(() => {
    scheduleCloseTraceDrawer();
  }, [scheduleCloseTraceDrawer]);

  const handleToastKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, kind: ActiveToast['kind'], row: RequestEventRow) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (kind === 'result') {
          openTraceDrawer(row);
          return;
        }
        openToast(kind, row);
      }
    },
    [openToast, openTraceDrawer]
  );

  const getResultDisplay = (row: RequestEventRow) => row.statusLabel || '-';

  const toastDetails = useMemo(() => {
    if (!activeToast) return [];
    const { row } = activeToast;
    if (activeToast.kind === 'result') {
      const request = row.requestInfo ?? {};
      const fallbackSource = row.sourceRaw !== '-' ? row.sourceRaw : row.source;
      return [
        [t('usage_stats.request_events_toast_request_type'), request.type || 'http'],
        [t('usage_stats.request_events_toast_spec_source'), request.spec_source || row.sourceType || row.sourceRaw],
        [t('usage_stats.request_events_toast_method'), request.method || 'POST'],
        [t('usage_stats.request_events_toast_display_name'), request.display_name],
        [t('usage_stats.request_events_toast_adapter'), request.adapter || row.sourceType || row.sourceRaw],
        [t('usage_stats.request_events_toast_upstream'), request.upstream || fallbackSource],
        [t('usage_stats.request_events_toast_upstream_url'), request.upstream_url],
      ];
    }

    const modelInfo = row.modelInfo ?? {};
    return [
      [t('usage_stats.request_events_toast_platform_model'), modelInfo.platform_model || row.model],
      [t('usage_stats.request_events_toast_upstream_model'), modelInfo.upstream_model || row.model],
      [t('usage_stats.request_events_toast_actual_source'), modelInfo.actual_source || row.sourceRaw],
      [t('usage_stats.request_events_toast_thinking'), row.thinkingLabel],
      [t('usage_stats.request_events_toast_client_service_tier'), modelInfo.client_service_tier],
      [
        t('usage_stats.request_events_toast_effective_service_tier'),
        modelInfo.effective_service_tier,
      ],
    ];
  }, [activeToast, t]);

  return (
    <Card title={t('usage_stats.request_events_title')}>
      <div className={styles.requestEventsToolbar}>
        <div className={`${styles.requestEventsFilterItem} ${styles.requestEventsSearchItem}`}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_search')}
          </span>
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t('usage_stats.request_events_search_placeholder')}
            aria-label={t('usage_stats.request_events_search')}
            className={styles.requestEventsSearchInput}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_model')}
          </span>
          <Select
            value={effectiveModelFilter}
            options={modelOptions}
            onChange={handleModelFilterChange}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_model')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_source')}
          </span>
          <Select
            value={effectiveSourceFilter}
            options={sourceOptions}
            onChange={setSourceFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_source')}
            fullWidth={false}
          />
        </div>
        <div className={styles.requestEventsFilterItem}>
          <span className={styles.requestEventsFilterLabel}>
            {t('usage_stats.request_events_filter_auth_index')}
          </span>
          <Select
            value={effectiveAuthIndexFilter}
            options={authIndexOptions}
            onChange={setAuthIndexFilter}
            className={styles.requestEventsSelect}
            ariaLabel={t('usage_stats.request_events_filter_auth_index')}
            fullWidth={false}
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClearFilters}
          disabled={!hasActiveFilters}
          className={styles.requestEventsClearButton}
        >
          {t('usage_stats.clear_filters')}
        </Button>

        <span className={styles.requestEventsToolbarDivider} aria-hidden="true" />

        <div
          className={styles.requestEventsToolbarSummary}
          title={t('usage_stats.request_events_summary_tooltip')}
        >
          <span>
            {t('usage_stats.request_events_compact_summary', {
              total: rows.length,
              filtered: filteredRows.length,
            })}
          </span>
          {filteredRows.length > MAX_RENDERED_EVENTS && (
            <span className={styles.requestEventsToolbarSummaryCapped}>
              {t('usage_stats.request_events_compact_capped', {
                shown: MAX_RENDERED_EVENTS,
                total: filteredRows.length,
              })}
            </span>
          )}
        </div>

        <button
          type="button"
          className={styles.requestEventsExportIconButton}
          onClick={handleExportCsv}
          disabled={filteredRows.length === 0}
          title={`${t('usage_stats.export')} (CSV / JSON)`}
          aria-label={t('usage_stats.export')}
        >
          <IconDownload size={14} />
        </button>
        <div className={styles.requestEventsExportMenu}>
          <button type="button" onClick={handleExportCsv} disabled={filteredRows.length === 0}>
            {t('usage_stats.export_csv')}
          </button>
          <button type="button" onClick={handleExportJson} disabled={filteredRows.length === 0}>
            {t('usage_stats.export_json')}
          </button>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className={styles.requestEventsSkeleton}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('usage_stats.request_events_timestamp')}</th>
                <th>{t('usage_stats.model_name')}</th>
                <th>{t('usage_stats.request_events_source')}</th>
                <th>{t('usage_stats.request_events_auth_index')}</th>
                <th>{t('usage_stats.request_events_result')}</th>
                {hasLatencyData && <th>{t('usage_stats.time')}</th>}
                <th>{t('usage_stats.total_tokens')}</th>
                <th>{t('usage_stats.thinking_intensity')}</th>
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5].map((i) => (
                <tr key={i}>
                  <td><div className={styles.skeletonCell} style={{ width: '90px' }} /></td>
                  <td><div className={styles.skeletonCell} style={{ width: '120px' }} /></td>
                  <td><div className={styles.skeletonCell} style={{ width: '150px' }} /></td>
                  <td><div className={styles.skeletonCell} style={{ width: '100px' }} /></td>
                  <td><div className={styles.skeletonCell} style={{ width: '60px' }} /></td>
                  {hasLatencyData && <td><div className={styles.skeletonCell} style={{ width: '50px' }} /></td>}
                  <td><div className={styles.skeletonCell} style={{ width: '70px' }} /></td>
                  <td><div className={styles.skeletonCell} style={{ width: '80px' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_empty_title')}
          description={t('usage_stats.request_events_empty_desc')}
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_no_result_title')}
          description={t('usage_stats.request_events_no_result_desc')}
        />
      ) : (
        <>
          <div ref={tableWrapperRef} className={styles.requestEventsTableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('usage_stats.request_events_timestamp')}</th>
                  <th>{t('usage_stats.model_name')}</th>
                  <th>{t('usage_stats.request_events_source')}</th>
                  <th>{t('usage_stats.request_events_auth_index')}</th>
                  <th>{t('usage_stats.request_events_result')}</th>
                  {hasLatencyData && <th title={latencyHint}>{t('usage_stats.time')}</th>}
                  <th>{t('usage_stats.total_tokens')}</th>
                  <th>{t('usage_stats.thinking_intensity')}</th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row) => (
                  <tr key={row.id}>
                    <td title={row.timestamp} className={styles.requestEventsTimestamp}>
                      {row.timestampLabel}
                    </td>
                    <td className={styles.modelCell}>
                      <span
                        role="button"
                        tabIndex={0}
                        data-request-events-toast-trigger="true"
                        className={styles.requestEventsModelButton}
                        onMouseEnter={() => openToast('model', row)}
                        onFocus={() => openToast('model', row)}
                        onKeyDown={(event) => handleToastKeyDown(event, 'model', row)}
                        title={t('usage_stats.request_events_toast_model_title')}
                      >
                        {row.model}
                      </span>
                    </td>
                    <td className={styles.requestEventsSourceCell} title={row.source}>
                      <span>{row.source}</span>
                      {row.sourceType && (
                        <span className={styles.credentialType}>{row.sourceType}</span>
                      )}
                    </td>
                    <td className={styles.requestEventsAuthIndex} title={row.authIndex}>
                      {row.authIndex}
                    </td>
                    <td>
                      <span
                        role="button"
                        tabIndex={0}
                        data-request-events-toast-trigger="true"
                        className={`${styles.requestEventsResultButton} ${
                          row.resultTone === 'failed'
                            ? styles.requestEventsResultFailed
                            : row.resultTone === 'warning'
                              ? styles.requestEventsResultWarning
                            : row.resultTone === 'unknown'
                              ? styles.requestEventsResultUnknown
                            : styles.requestEventsResultSuccess
                        }`}
                        onMouseEnter={() => openTraceDrawer(row)}
                        onMouseLeave={closeTraceDrawer}
                        onFocus={() => openTraceDrawer(row)}
                        onBlur={closeTraceDrawer}
                        onKeyDown={(event) => handleToastKeyDown(event, 'result', row)}
                        title={t('usage_stats.request_events_toast_request_title')}
                      >
                        <span className={styles.resultGlyph} aria-hidden="true">
                          {row.resultTone === 'failed' ? '!' : ''}
                        </span>
                        <span className={styles.resultText}>
                          {getResultDisplay(row)}
                        </span>
                      </span>
                    </td>
                    {hasLatencyData && (
                      <td className={`${styles.durationCell} ${getLatencyClassName(row.latencyMs, row.failed)}`}>{formatDurationMs(row.latencyMs)}</td>
                    )}
                    {(() => {
                      const tokenMissing = isMissingSuccessfulTokenUsage(row);
                      return (
                        <td
                          className={styles.tokenSummaryCell}
                          title={[
                            `${t('usage_stats.input_tokens')}: ${tokenMissing ? '-' : row.inputTokens.toLocaleString()}`,
                            `${t('usage_stats.output_tokens')}: ${tokenMissing ? '-' : row.outputTokens.toLocaleString()}`,
                            `${t('usage_stats.reasoning_tokens')}: ${tokenMissing ? '-' : row.reasoningTokens.toLocaleString()}`,
                            `${t('usage_stats.cached_tokens')}: ${tokenMissing ? '-' : row.cachedTokens.toLocaleString()}`,
                          ].join('\n')}
                        >
                          <span className={styles.tokenSummaryTotal}>
                            {tokenMissing ? '-' : row.totalTokens.toLocaleString()}
                          </span>
                          <span className={styles.tokenSummaryParts}>
                            {tokenMissing
                              ? '- / - / - / -'
                              : `${row.inputTokens.toLocaleString()} / ${row.outputTokens.toLocaleString()} / ${row.reasoningTokens.toLocaleString()} / ${row.cachedTokens.toLocaleString()}`}
                          </span>
                        </td>
                      );
                    })()}
                    <td>
                      <span
                        className={
                          row.thinking
                            ? `${styles.requestEventsThinkingBadge} ${getThinkingClassName(row.thinkingLabel)}`
                            : styles.requestEventsThinkingEmpty
                        }
                        title={
                          row.thinking
                            ? [
                                row.thinking.mode
                                  ? `${t('usage_stats.thinking_mode')}: ${row.thinking.mode}`
                                  : '',
                                row.thinking.level
                                  ? `${t('usage_stats.thinking_level')}: ${row.thinking.level}`
                                  : '',
                                typeof row.thinking.budget === 'number'
                                  ? `${t('usage_stats.thinking_budget')}: ${row.thinking.budget.toLocaleString()}`
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' · ')
                            : undefined
                        }
                      >
                        {row.thinkingLabel}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {activeToast && (
            <div
              ref={toastRef}
              className={`${styles.requestEventsToast} ${
                activeToast.kind === 'model'
                  ? styles.requestEventsToastModel
                  : activeToast.row.resultTone === 'failed'
                    ? styles.requestEventsToastFailed
                    : activeToast.row.resultTone === 'warning'
                      ? styles.requestEventsToastWarning
                    : activeToast.row.resultTone === 'unknown'
                      ? styles.requestEventsToastUnknown
                    : styles.requestEventsToastSuccess
              }`}
              role="status"
              aria-live="polite"
            >
              <div className={styles.requestEventsToastMeta}>
                <div className={styles.requestEventsToastHeader}>
                  <div className={styles.requestEventsToastTitleGroup}>
                    <span className={styles.requestEventsToastKicker}>
                      {activeToast.kind === 'result'
                        ? t('usage_stats.request_events_toast_request_title')
                        : t('usage_stats.request_events_toast_model_title')}
                    </span>
                    <strong>
                      {activeToast.kind === 'result'
                        ? displayValue(activeToast.row.requestInfo?.display_name)
                        : activeToast.row.model}
                    </strong>
                  </div>
                  <span
                    className={`${styles.requestEventsToastStatus} ${
                      activeToast.kind === 'model'
                        ? styles.requestEventsToastStatusModel
                        : activeToast.row.resultTone === 'failed'
                          ? styles.requestEventsToastStatusFailed
                          : activeToast.row.resultTone === 'warning'
                            ? styles.requestEventsToastStatusWarning
                          : activeToast.row.resultTone === 'unknown'
                            ? styles.requestEventsToastStatusUnknown
                            : styles.requestEventsToastStatusSuccess
                    }`}
                  >
                    {activeToast.kind === 'result'
                      ? getResultDisplay(activeToast.row)
                      : displayValue(activeToast.row.modelInfo?.effective_service_tier)}
                  </span>
                  <button
                    type="button"
                    className={styles.requestEventsToastClose}
                    onClick={() => setActiveToast(null)}
                    aria-label={t('common.close')}
                  >
                    ×
                  </button>
                </div>
                <div className={styles.requestEventsToastMiniGrid}>
                  <span>
                    <b>{t('usage_stats.request_events_timestamp')}</b>
                    <em>{activeToast.row.timestampLabel}</em>
                  </span>
                  <span>
                    <b>{t('usage_stats.time')}</b>
                    <em>{formatDurationMs(activeToast.row.latencyMs)}</em>
                  </span>
                  <span>
                    <b>{t('usage_stats.request_events_auth_index')}</b>
                    <em>{activeToast.row.authIndex}</em>
                  </span>
                  <span>
                    <b>{t('usage_stats.request_events_source')}</b>
                    <em>{activeToast.row.source}</em>
                  </span>
                </div>
              </div>
              <div className={styles.requestEventsToastTopology}>
                <div className={styles.requestEventsToastSectionTitle}>
                  {activeToast.kind === 'result'
                    ? t('usage_stats.request_events_toast_request_title')
                    : t('usage_stats.request_events_toast_model_title')}
                </div>
                <div className={styles.requestEventsToastFlow}>
                  <span>{activeToast.kind === 'result' ? 'Gateway' : t('usage_stats.request_events_toast_platform_model')}</span>
                  <i aria-hidden="true" />
                  <span>{activeToast.kind === 'result' ? displayValue(activeToast.row.requestInfo?.adapter) : t('usage_stats.request_events_toast_upstream_model')}</span>
                  <i aria-hidden="true" />
                  <span className={activeToast.row.resultTone === 'failed' ? styles.requestEventsToastFlowFailed : ''}>
                    {activeToast.kind === 'result'
                      ? displayValue(activeToast.row.requestInfo?.upstream)
                      : displayValue(activeToast.row.modelInfo?.actual_source)}
                  </span>
                </div>
              </div>
              <dl className={styles.requestEventsToastDetails}>
                {toastDetails.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{displayValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <RequestTraceDrawer
            logLine={traceDrawerLine}
            open={Boolean(traceDrawerLine)}
            onClose={closeTraceDrawer}
            modal={false}
            onPanelMouseEnter={handleDrawerPanelEnter}
            onPanelMouseLeave={handleDrawerPanelLeave}
            onPanelFocus={handleDrawerPanelEnter}
            onPanelBlur={handleDrawerPanelLeave}
          />
        </>
      )}
    </Card>
  );
}
