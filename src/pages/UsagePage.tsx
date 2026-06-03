import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiKeysApi, providersApi, type APIKeyEntry } from '@/services/api';
import { useThemeStore, useConfigStore } from '@/stores';
import type { OpenAIProviderConfig } from '@/types';
import {
  SummaryCards,
  StatCards,
  ModelStatsCard,
  PriceSettingsCard,
  CredentialStatsCard,
  RequestEventsDetailsCard,
  ServiceHealthCard,
  ModelTokenDoughnut,
  TrendTabsCard,
  useUsageData,
} from '@/components/usage';
import {
  calculateCost,
  type ChartData,
  getModelStats,
  filterUsageByTimeRange,
  collectUsageDetails,
  extractTotalTokens,
  filterUsageDetails,
  formatDayLabel,
  formatHourLabel,
  type UsageTimeRange,
} from '@/utils/usage';
import { maskApiKey } from '@/utils/format';
import type { ChartOptions, ScriptableContext, TooltipItem } from 'chart.js';
import { buildChartOptions } from '@/utils/usage/chartConfig';
import styles from './UsagePage.module.scss';

// Register Chart.js components
ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v1';
const DEFAULT_CHART_LINES = ['all'];
const MAX_CHART_LINES = 9;
const DEFAULT_TIME_RANGE: UsageTimeRange = '24h';
const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; labelKey: string }> = [
  { value: 'today', labelKey: 'usage_stats.range_today' },
  { value: 'all', labelKey: 'usage_stats.range_all' },
  { value: '7h', labelKey: 'usage_stats.range_7h' },
  { value: '24h', labelKey: 'usage_stats.range_24h' },
  { value: '7d', labelKey: 'usage_stats.range_7d' },
  { value: '30d', labelKey: 'usage_stats.range_30d' },
];
const HOUR_WINDOW_BY_TIME_RANGE: Record<Exclude<UsageTimeRange, 'all' | 'today'>, number> = {
  '7h': 7,
  '24h': 24,
  '7d': 7 * 24,
  '30d': 30 * 24,
};

const CHART_LINES_STORAGE_KEY = 'cli-proxy-usage-chart-lines-v1';
type ChartCompareMode = 'model' | 'credential';
const CHART_COMPARE_MODE_STORAGE_KEY = 'cli-proxy-usage-chart-compare-mode-v1';
const CREDENTIAL_FILTER_STORAGE_KEY = 'cli-proxy-usage-client-api-key-filter-v1';
const ALL_FILTER = 'all';
const REQUEST_EVENTS_ALL_FILTER = '__all__';
const EMPTY_CHART_DATA: ChartData = { labels: [], datasets: [] };
const TOKEN_FOCUS_CHART_COLORS = {
  input: '#00E5FF',
  cache: '#7C4DFF',
  output: '#22c55e',
  rate: '#94a3b8',
};

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const scheduleDeferredUsageWork = (callback: () => void, timeout = 140) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const idleWindow = window as IdleWindow;
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(callback, { timeout });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, Math.min(timeout, 80));
  return () => window.clearTimeout(handle);
};

const SKELETON_BAR_HEIGHTS = [40, 65, 45, 80, 55, 70, 50, 85, 60, 75, 45, 90];

function SkeletonLine({ width, height = 16 }: { width: string | number; height?: number }) {
  return <div className={styles.skeletonCell} style={{ width, height }} />;
}

function SummaryCardsPlaceholder() {
  return (
    <div className={styles.summaryCards} aria-busy="true">
      {[0, 1, 2].map((item) => (
        <div key={item} className={styles.summaryCard}>
          <div className={styles.summaryCardIcon}>
            <SkeletonLine width={28} height={28} />
          </div>
          <div className={styles.summaryCardContent}>
            <SkeletonLine width="46%" height={12} />
            <SkeletonLine width="68%" height={32} />
            <SkeletonLine width="52%" height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TrendTabsPlaceholder({ title }: { title: string }) {
  return (
    <div className={styles.trendTabsCard} aria-busy="true">
      <div className={styles.trendTabsHeader}>
        <h3 className={styles.trendTabsTitle}>{title}</h3>
        <div className={styles.trendTabsBar}>
          {[0, 1, 2].map((item) => (
            <SkeletonLine key={item} width={82} height={28} />
          ))}
        </div>
      </div>
      <div className={styles.chartSkeletonPlaceholder}>
        <div className={styles.chartSkeletonBars}>
          {SKELETON_BAR_HEIGHTS.map((height, index) => (
            <div key={index} className={styles.chartSkeletonBar} style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ModelPanelPlaceholder({ title }: { title: string }) {
  return (
    <div className={`card ${styles.detailsFixedCard}`} aria-busy="true">
      <div className="card-header">
        <div className="card-header-left">
          <span className="card-title">{title}</span>
        </div>
      </div>
      <div className={styles.requestEventsSkeleton}>
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <SkeletonLine key={item} width={item % 2 === 0 ? '92%' : '76%'} height={20} />
        ))}
      </div>
    </div>
  );
}

const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === 'today' ||
  value === '7h' ||
  value === '24h' ||
  value === '7d' ||
  value === '30d' ||
  value === 'all';

const normalizeChartLines = (value: unknown, maxLines = MAX_CHART_LINES): string[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_CHART_LINES;
  }
  const filtered = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxLines);
  return filtered.length ? filtered : DEFAULT_CHART_LINES;
};

const loadChartLines = (): string[] => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_CHART_LINES;
    }
    const raw = localStorage.getItem(CHART_LINES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CHART_LINES;
    }
    return normalizeChartLines(JSON.parse(raw));
  } catch {
    return DEFAULT_CHART_LINES;
  }
};

const loadChartCompareMode = (): ChartCompareMode => {
  try {
    if (typeof localStorage === 'undefined') {
      return 'model';
    }
    return localStorage.getItem(CHART_COMPARE_MODE_STORAGE_KEY) === 'credential'
      ? 'credential'
      : 'model';
  } catch {
    return 'model';
  }
};

const loadCredentialFilter = (): string => {
  try {
    if (typeof localStorage === 'undefined') {
      return ALL_FILTER;
    }
    return localStorage.getItem(CREDENTIAL_FILTER_STORAGE_KEY) || ALL_FILTER;
  } catch {
    return ALL_FILTER;
  }
};

const loadTimeRange = (): UsageTimeRange => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_TIME_RANGE;
    }
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    return isUsageTimeRange(raw) ? raw : DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

const formatCredentialShortName = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '-';
  return maskApiKey(trimmed) || trimmed;
};

const withAlpha = (hex: string, alpha: number): string => {
  const normalized = hex.replace('#', '');
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (![r, g, b].every((channel) => Number.isFinite(channel))) {
    return hex;
  }
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(alpha, 1))})`;
};

const CHART_COLORS = ['#00E5FF', '#7C4DFF'];
const TAIL_LINE_COLOR = 'rgba(255, 255, 255, 0.22)';

const buildTelemetryAreaGradient = (
  context: ScriptableContext<'line'>,
  color: string,
  topAlpha = 0.14
): string | CanvasGradient => {
  const area = context.chart.chartArea;
  if (!area) return withAlpha(color, topAlpha);

  const gradient = context.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, withAlpha(color, topAlpha));
  gradient.addColorStop(0.42, withAlpha(color, topAlpha * 0.42));
  gradient.addColorStop(1, withAlpha(color, 0));
  return gradient;
};

type TrendMetric = 'requests' | 'tokens' | 'cost';
type TrendPeriod = 'hour' | 'day';
type TrendGranularity = TrendPeriod;

interface ClientApiKeyInfo {
  key: string;
  label: string;
  masked: string;
  description?: string;
  super?: boolean;
  models?: string[];
}

const buildClientApiKeyInfo = (entry: APIKeyEntry): ClientApiKeyInfo => {
  const key = String(entry.key ?? '').trim();
  const masked = formatCredentialShortName(key);
  const name = String(entry.name ?? '').trim();
  const description = String(entry.description ?? '').trim();
  return {
    key,
    label: name || description || masked,
    masked,
    description: name && description ? description : undefined,
    super: entry.super,
    models: entry.models,
  };
};

const mergeClientApiKeyEntries = (
  entries: APIKeyEntry[],
  configKeys: string[] | undefined
): APIKeyEntry[] => {
  const result: APIKeyEntry[] = [];
  const seen = new Set<string>();

  entries.forEach((entry) => {
    const key = String(entry.key ?? '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(entry);
  });

  (configKeys ?? []).forEach((keyValue) => {
    const key = String(keyValue ?? '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push({ key });
  });

  return result;
};

const getTrendValue = (
  metric: TrendMetric,
  detail: ReturnType<typeof collectUsageDetails>[number],
  modelPrices: Parameters<typeof calculateCost>[1]
) => {
  if (metric === 'tokens') {
    return extractTotalTokens(detail);
  }
  if (metric === 'cost') {
    return calculateCost(detail, modelPrices);
  }
  return 1;
};

const toTokenCount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(value, 0) : 0;

const getCacheHitTokens = (detail: ReturnType<typeof collectUsageDetails>[number]): number => {
  const tokens = detail.tokens;
  return Math.max(toTokenCount(tokens.cached_tokens), toTokenCount(tokens.cache_tokens));
};

const getColdInputTokens = (detail: ReturnType<typeof collectUsageDetails>[number]): number => {
  const inputTokens = toTokenCount(detail.tokens.input_tokens);
  return Math.max(inputTokens - getCacheHitTokens(detail), 0);
};

const getCacheHitRate = (inputTokens: number, cacheHitTokens: number): number => {
  const denominator = inputTokens + cacheHitTokens;
  return denominator > 0 ? Number(((cacheHitTokens / denominator) * 100).toFixed(1)) : 0;
};

const formatChartValue = (value: number): string => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
  return value.toLocaleString();
};

const getTokenBreakdownValue = (
  kind: 'input' | 'cache' | 'output',
  detail: ReturnType<typeof collectUsageDetails>[number]
): number => {
  const tokens = detail.tokens;
  if (kind === 'cache') {
    return getCacheHitTokens(detail);
  }
  if (kind === 'output') {
    return toTokenCount(tokens.output_tokens);
  }
  return getColdInputTokens(detail);
};

const buildHourlyLabels = (hourWindowHours: number | undefined): string[] => {
  const hourMs = 60 * 60 * 1000;
  const resolvedHourWindow =
    Number.isFinite(hourWindowHours) && hourWindowHours && hourWindowHours > 0
      ? Math.min(Math.max(Math.floor(hourWindowHours), 1), 24 * 31)
      : 24;
  const currentHour = new Date();
  currentHour.setMinutes(0, 0, 0);
  const earliest = new Date(currentHour);
  earliest.setHours(earliest.getHours() - (resolvedHourWindow - 1));
  const earliestTime = earliest.getTime();
  return Array.from({ length: resolvedHourWindow }, (_, index) =>
    formatHourLabel(new Date(earliestTime + index * hourMs))
  );
};

interface UsageViewScope {
  usage: ReturnType<typeof useUsageData>['usage'];
  timeRange: UsageTimeRange;
  credentialFilter: string;
}

interface HeavyUsageScope {
  modelPrices: ReturnType<typeof useUsageData>['modelPrices'];
  scopedUsage: ReturnType<typeof useUsageData>['usage'];
}

export function UsagePage() {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isNarrowScreen = useMediaQuery('(max-width: 640px)');
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';
  const config = useConfigStore((state) => state.config);
  const openaiCompatibilityConfig = config?.openaiCompatibility;
  const [openaiProvidersWithAuthIndex, setOpenaiProvidersWithAuthIndex] = useState<{
    source: OpenAIProviderConfig[] | undefined;
    providers: OpenAIProviderConfig[];
  } | null>(null);
  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);
  const [searchParams, setSearchParams] = useSearchParams();
  const [chartLines, setChartLines] = useState<string[]>(loadChartLines);
  const [chartCompareMode, setChartCompareMode] = useState<ChartCompareMode>(loadChartCompareMode);
  const [credentialFilter, setCredentialFilter] = useState<string>(loadCredentialFilter);
  const [modelPanelTab, setModelPanelTab] = useState<'stats' | 'credentials' | 'prices'>('stats');
  const [clientApiKeyEntries, setClientApiKeyEntries] = useState<APIKeyEntry[]>([]);
  const [chartGranularity, setChartGranularity] = useState<TrendGranularity>('hour');
  const [activeTrendTab, setActiveTrendTab] = useState<string>('requests');
  const [detailModelFilter, setDetailModelFilter] = useState<string>(REQUEST_EVENTS_ALL_FILTER);

  // Data hook
  const {
    usage,
    loading,
    error,
    lastRefreshedAt,
    modelPrices,
    setModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing,
  } = useUsageData(timeRange);
  const isInitialLoading = loading && !usage;
  const isRefreshing = loading && Boolean(usage);
  const [showRefreshFeedback, setShowRefreshFeedback] = useState(false);

  useHeaderRefresh(loadUsage);

  useEffect(() => {
    if (!isRefreshing) {
      setShowRefreshFeedback(false);
      return;
    }

    const timerId = window.setTimeout(() => {
      setShowRefreshFeedback(true);
    }, 300);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [isRefreshing]);

  useEffect(() => {
    let cancelled = false;
    const source = openaiCompatibilityConfig;

    providersApi
      .getOpenAIProviders()
      .then((providers) => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex({ source, providers: providers || [] });
      })
      .catch(() => {
        if (cancelled) return;
        setOpenaiProvidersWithAuthIndex(null);
      });

    return () => {
      cancelled = true;
    };
  }, [openaiCompatibilityConfig]);

  const openaiProviderState = openaiProvidersWithAuthIndex;
  const openaiProvidersForUsage =
    openaiProviderState && openaiProviderState.source === openaiCompatibilityConfig
      ? openaiProviderState.providers
      : (openaiCompatibilityConfig ?? []);

  useEffect(() => {
    let cancelled = false;

    apiKeysApi
      .listEntries()
      .then((entries) => {
        if (cancelled) return;
        setClientApiKeyEntries(entries);
      })
      .catch(() => {
        if (cancelled) return;
        setClientApiKeyEntries([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const clientApiKeys = useMemo(
    () => mergeClientApiKeyEntries(clientApiKeyEntries, config?.apiKeys),
    [clientApiKeyEntries, config?.apiKeys]
  );

  const clientApiKeyInfoMap = useMemo(() => {
    const map = new Map<string, ClientApiKeyInfo>();
    clientApiKeys.forEach((entry) => {
      const info = buildClientApiKeyInfo(entry);
      if (info.key) {
        map.set(info.key, info);
      }
    });
    return map;
  }, [clientApiKeys]);

  const timeRangeOptions = useMemo(
    () =>
      TIME_RANGE_OPTIONS.map((opt) => ({
        value: opt.value,
        label: t(opt.labelKey),
      })),
    [t]
  );

  const usageViewScope = useMemo<UsageViewScope>(
    () => ({ usage, timeRange, credentialFilter }),
    [credentialFilter, timeRange, usage]
  );
  const [readyUsageViewScope, setReadyUsageViewScope] = useState<UsageViewScope | null>(null);

  useEffect(() => {
    if (!usage || isInitialLoading) {
      return;
    }

    return scheduleDeferredUsageWork(() => setReadyUsageViewScope(usageViewScope), 96);
  }, [isInitialLoading, usage, usageViewScope]);

  const renderUsageData = !usage || readyUsageViewScope === usageViewScope;
  const visibleUsageViewScope = renderUsageData ? usageViewScope : readyUsageViewScope;

  const filteredUsage = useMemo(
    () =>
      visibleUsageViewScope?.usage
        ? filterUsageByTimeRange(visibleUsageViewScope.usage, visibleUsageViewScope.timeRange)
        : null,
    [visibleUsageViewScope]
  );
  const filteredDetails = useMemo(() => collectUsageDetails(filteredUsage), [filteredUsage]);

  const credentialRows = useMemo(() => {
    if (!filteredUsage) {
      return [];
    }

    const rowMap = new Map<
      string,
      {
        value: string;
        label: string;
        type: string;
        requests: number;
        success: number;
        failure: number;
        tokens: number;
        cost: number;
      }
    >();

    filteredDetails.forEach((detail) => {
      const value = String(detail.__apiKey ?? '').trim() || 'unknown';
      const keyInfo = clientApiKeyInfoMap.get(value);
      const row = rowMap.get(value) ?? {
        value,
        label: keyInfo?.label || formatCredentialShortName(value),
        type: keyInfo?.super
          ? t('system_info.api_key_policy_super_badge')
          : keyInfo?.models?.length
            ? t('system_info.api_key_policy_limited_badge')
            : t('system_info.api_key_policy_models_all'),
        requests: 0,
        success: 0,
        failure: 0,
        tokens: 0,
        cost: 0,
      };

      row.requests += 1;
      if (detail.failed === true) {
        row.failure += 1;
      } else {
        row.success += 1;
      }
      row.tokens += extractTotalTokens(detail);
      row.cost += calculateCost(detail, modelPrices);
      rowMap.set(value, row);
    });

    return Array.from(rowMap.values()).sort((a, b) => b.requests - a.requests);
  }, [clientApiKeyInfoMap, filteredDetails, filteredUsage, modelPrices, t]);

  const credentialOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: string }>();
    clientApiKeys.forEach((entry) => {
      const info = buildClientApiKeyInfo(entry);
      if (!info.key) return;
      const suffix = info.label === info.masked ? '' : ` · ${info.masked}`;
      options.set(info.key, {
        value: info.key,
        label: `${info.label}${suffix}`,
      });
    });
    credentialRows.forEach((row) => {
      if (options.has(row.value)) return;
      options.set(row.value, {
        value: row.value,
        label: row.label,
      });
    });
    if (credentialFilter !== ALL_FILTER && !options.has(credentialFilter)) {
      options.set(credentialFilter, {
        value: credentialFilter,
        label: formatCredentialShortName(credentialFilter),
      });
    }
    return Array.from(options.values());
  }, [clientApiKeys, credentialFilter, credentialRows]);

  const credentialFilterOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.credential_filter_all') },
      ...credentialOptions,
    ],
    [credentialOptions, t]
  );

  const effectiveCredentialFilter = useMemo(() => {
    if (credentialFilter === ALL_FILTER) {
      return ALL_FILTER;
    }
    return credentialOptions.some((option) => option.value === credentialFilter)
      ? credentialFilter
      : ALL_FILTER;
  }, [credentialFilter, credentialOptions]);

  const scopedUsage = useMemo(() => {
    if (!filteredUsage || effectiveCredentialFilter === ALL_FILTER) {
      return filteredUsage;
    }

    return filterUsageDetails(
      filteredUsage,
      (_detail, context) => context.apiName === effectiveCredentialFilter
    );
  }, [effectiveCredentialFilter, filteredUsage]);

  const heavyUsageScope = useMemo<HeavyUsageScope>(
    () => ({ modelPrices, scopedUsage }),
    [modelPrices, scopedUsage]
  );
  const [readyHeavyUsageScope, setReadyHeavyUsageScope] = useState<HeavyUsageScope | null>(null);

  useEffect(() => {
    if (isInitialLoading || !filteredUsage) {
      return;
    }

    return scheduleDeferredUsageWork(() => setReadyHeavyUsageScope(heavyUsageScope), 180);
  }, [filteredUsage, heavyUsageScope, isInitialLoading]);

  const heavyUsageReady = readyHeavyUsageScope === heavyUsageScope;
  const visibleHeavyUsageScope = heavyUsageReady ? heavyUsageScope : readyHeavyUsageScope;
  const renderHeavyUsageSections = !isInitialLoading && Boolean(visibleHeavyUsageScope);
  const visibleScopedUsage = visibleHeavyUsageScope?.scopedUsage ?? scopedUsage;
  const visibleModelPrices = visibleHeavyUsageScope?.modelPrices ?? modelPrices;
  const scopedDetails = useMemo(
    () => (renderHeavyUsageSections ? collectUsageDetails(visibleScopedUsage) : []),
    [renderHeavyUsageSections, visibleScopedUsage]
  );

  const hourWindowHours =
    timeRange === 'all'
      ? undefined
      : timeRange === 'today'
        ? new Date().getHours() + 1
        : HOUR_WINDOW_BY_TIME_RANGE[timeRange];

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, timeRange);
    } catch {
      // Ignore storage errors.
    }
  }, [timeRange]);

  // Chart lines handler
  const handleChartLinesChange = useCallback((lines: string[]) => {
    setChartLines(normalizeChartLines(lines));
  }, []);

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CHART_LINES_STORAGE_KEY, JSON.stringify(chartLines));
      }
    } catch {
      // Ignore storage errors.
    }
  }, [chartLines]);

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CHART_COMPARE_MODE_STORAGE_KEY, chartCompareMode);
      }
    } catch {
      // Ignore storage errors.
    }
  }, [chartCompareMode]);

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CREDENTIAL_FILTER_STORAGE_KEY, effectiveCredentialFilter);
      }
    } catch {
      // Ignore storage errors.
    }
  }, [effectiveCredentialFilter]);

  // URL Query Params sync - restore filters from URL on mount, sync to URL on change
  useEffect(() => {
    const urlRange = searchParams.get('range');
    if (urlRange && isUsageTimeRange(urlRange)) {
      setTimeRange(urlRange);
    }
    const urlCred = searchParams.get('cred');
    if (urlCred) {
      setCredentialFilter(urlCred);
    }
    const urlModel = searchParams.get('model');
    if (urlModel) {
      setDetailModelFilter(urlModel);
    }
  }, []); // Only run on mount

  // Sync filters to URL when they change
  useEffect(() => {
    const params = new URLSearchParams();
    if (timeRange !== DEFAULT_TIME_RANGE) {
      params.set('range', timeRange);
    }
    if (effectiveCredentialFilter !== ALL_FILTER) {
      params.set('cred', effectiveCredentialFilter);
    }
    if (detailModelFilter !== REQUEST_EVENTS_ALL_FILTER) {
      params.set('model', detailModelFilter);
    }
    setSearchParams(params, { replace: true });
  }, [timeRange, effectiveCredentialFilter, detailModelFilter, setSearchParams]);

  const hasPrices = Object.keys(modelPrices).length > 0;
  const modelNames = useMemo(() => {
    const names = new Set<string>();
    scopedDetails.forEach((detail) => {
      const modelName = String(detail.__modelName ?? '').trim();
      if (modelName) {
        names.add(modelName);
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [scopedDetails]);
  const modelStats = useMemo(
    () => (renderHeavyUsageSections ? getModelStats(visibleScopedUsage, visibleModelPrices) : []),
    [renderHeavyUsageSections, visibleModelPrices, visibleScopedUsage]
  );
  const resolvedChartLines = useMemo(() => {
    if (chartLines.length !== 1 || chartLines[0] !== ALL_FILTER) {
      return chartLines;
    }

    if (chartCompareMode === 'credential') {
      const topCredentials = credentialRows
        .filter((row) => row.requests > 0)
        .slice(0, 4)
        .map((row) => row.value);
      return topCredentials.length > 0 ? topCredentials : chartLines;
    }

    const topModels = modelStats.slice(0, 4).map((stat) => stat.model);
    return topModels.length > 0 ? topModels : chartLines;
  }, [chartCompareMode, chartLines, credentialRows, modelStats]);
  const effectiveDetailModelFilter = useMemo(() => {
    if (detailModelFilter === REQUEST_EVENTS_ALL_FILTER) {
      return REQUEST_EVENTS_ALL_FILTER;
    }
    return modelNames.includes(detailModelFilter) ? detailModelFilter : REQUEST_EVENTS_ALL_FILTER;
  }, [detailModelFilter, modelNames]);

  const buildTrendChartData = useCallback(
    (metric: TrendMetric, period: TrendPeriod): ChartData => {
      if (metric === 'cost' && Object.keys(visibleModelPrices).length === 0) {
        return { labels: [], datasets: [] };
      }

      const details = scopedDetails;
      const labels =
        period === 'hour'
          ? buildHourlyLabels(hourWindowHours)
          : Array.from(
              new Set(
                details
                  .map((detail) => formatDayLabel(new Date(detail.__timestampMs || 0)))
                  .filter(Boolean)
              )
            ).sort();
      const dataByKey = new Map<string, number[]>();
      const labelIndex = new Map(labels.map((label, index) => [label, index]));
      const lineLabels = new Map<string, string>();

      details.forEach((detail) => {
        const timestamp = detail.__timestampMs || 0;
        if (!Number.isFinite(timestamp) || timestamp <= 0) return;

        const label =
          period === 'hour'
            ? (() => {
                const date = new Date(timestamp);
                date.setMinutes(0, 0, 0);
                return formatHourLabel(date);
              })()
            : formatDayLabel(new Date(timestamp));
        const index = labelIndex.get(label);
        if (index === undefined) return;

        const credentialKey = String(detail.__apiKey ?? '').trim() || 'unknown';
        const keyInfo = clientApiKeyInfoMap.get(credentialKey);
        const key =
          chartCompareMode === 'credential' ? credentialKey : detail.__modelName || 'Unknown';
        const displayLabel =
          chartCompareMode === 'credential'
            ? keyInfo?.label || formatCredentialShortName(key)
            : key;

        if (!dataByKey.has(key)) {
          dataByKey.set(key, new Array(labels.length).fill(0));
          lineLabels.set(key, displayLabel);
        }
        dataByKey.get(key)![index] += getTrendValue(metric, detail, visibleModelPrices);
      });

      const selectedLines =
        resolvedChartLines.length > 0 ? resolvedChartLines : DEFAULT_CHART_LINES;
      const rawSeries = selectedLines.map((line) => {
        const isAll = line === ALL_FILTER;
        const data = isAll
          ? labels.map((_, labelIndexValue) =>
              Array.from(dataByKey.values()).reduce(
                (sum, values) => sum + (values[labelIndexValue] || 0),
                0
              )
            )
          : dataByKey.get(line) || new Array(labels.length).fill(0);
        const total = data.reduce((sum, value) => sum + value, 0);

        return {
          line,
          total,
          label: isAll
            ? chartCompareMode === 'credential'
              ? t('usage_stats.chart_line_all_credentials')
              : t('usage_stats.chart_line_all')
            : lineLabels.get(line) || formatCredentialShortName(line),
          data,
        };
      });
      const rankedLines = [...rawSeries].sort((a, b) => b.total - a.total);
      const rankByLine = new Map(rankedLines.map((series, index) => [series.line, index]));
      const datasets = rawSeries.map((series) => {
        const rank = rankByLine.get(series.line) ?? 0;
        const isPrimary = rank === 0;
        const isSecondary = rank === 1;
        const color = isPrimary
          ? CHART_COLORS[0]
          : isSecondary
            ? CHART_COLORS[1]
            : TAIL_LINE_COLOR;

        return {
          label: series.label,
          data: series.data,
          borderColor: color,
          backgroundColor: isPrimary
            ? (context: ScriptableContext<'line'>) => buildTelemetryAreaGradient(context, color, 0.16)
            : 'rgba(255, 255, 255, 0)',
          pointBackgroundColor: color,
          pointBorderColor: color,
          borderWidth: isPrimary ? 2.4 : isSecondary ? 1.8 : 1.15,
          pointRadius: 0,
          pointHoverRadius: isPrimary ? 5 : 3,
          pointHitRadius: 10,
          pointBorderWidth: 0,
          pointHoverBorderWidth: 2,
          fill: isPrimary,
          tension: 0.42,
          order: rank,
        };
      });

      return { labels, datasets };
    },
    [
      chartCompareMode,
      clientApiKeyInfoMap,
      hourWindowHours,
      resolvedChartLines,
      scopedDetails,
      t,
      visibleModelPrices,
    ]
  );
  const buildFocusedTokenChartData = useCallback(
    (modelName: string, period: TrendPeriod): ChartData => {
      const details = scopedDetails.filter((detail) => detail.__modelName === modelName);
      const labels =
        period === 'hour'
          ? buildHourlyLabels(hourWindowHours)
          : Array.from(
              new Set(
                details
                  .map((detail) => formatDayLabel(new Date(detail.__timestampMs || 0)))
                  .filter(Boolean)
              )
            ).sort();
      const labelIndex = new Map(labels.map((label, index) => [label, index]));
      const inputData = new Array(labels.length).fill(0);
      const outputData = new Array(labels.length).fill(0);
      const cacheData = new Array(labels.length).fill(0);

      details.forEach((detail) => {
        const timestamp = detail.__timestampMs || 0;
        if (!Number.isFinite(timestamp) || timestamp <= 0) return;

        const label =
          period === 'hour'
            ? (() => {
                const date = new Date(timestamp);
                date.setMinutes(0, 0, 0);
                return formatHourLabel(date);
              })()
            : formatDayLabel(new Date(timestamp));
        const index = labelIndex.get(label);
        if (index === undefined) return;

        inputData[index] += getTokenBreakdownValue('input', detail);
        outputData[index] += getTokenBreakdownValue('output', detail);
        cacheData[index] += getTokenBreakdownValue('cache', detail);
      });

      const cacheHitRateData = labels.map((_, index) =>
        getCacheHitRate(inputData[index], cacheData[index])
      );

      return {
        labels,
        datasets: [
          {
            label: t('usage_stats.input_tokens'),
            data: inputData,
            borderColor: TOKEN_FOCUS_CHART_COLORS.input,
            backgroundColor: (context: ScriptableContext<'line'>) =>
              buildTelemetryAreaGradient(context, TOKEN_FOCUS_CHART_COLORS.input, 0.15),
            pointBackgroundColor: TOKEN_FOCUS_CHART_COLORS.input,
            pointBorderColor: TOKEN_FOCUS_CHART_COLORS.input,
            borderWidth: 2.4,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHitRadius: 10,
            fill: true,
            tension: 0.42,
          },
          {
            label: t('usage_stats.output_tokens'),
            data: outputData,
            borderColor: TOKEN_FOCUS_CHART_COLORS.output,
            backgroundColor: 'rgba(255, 255, 255, 0)',
            pointBackgroundColor: TOKEN_FOCUS_CHART_COLORS.output,
            pointBorderColor: TOKEN_FOCUS_CHART_COLORS.output,
            borderWidth: 1.9,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 10,
            fill: false,
            tension: 0.42,
          },
          {
            label: t('usage_stats.cache_hit'),
            data: cacheData,
            borderColor: TOKEN_FOCUS_CHART_COLORS.cache,
            backgroundColor: 'rgba(255, 255, 255, 0)',
            pointBackgroundColor: TOKEN_FOCUS_CHART_COLORS.cache,
            pointBorderColor: TOKEN_FOCUS_CHART_COLORS.cache,
            borderWidth: 1.8,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 10,
            fill: false,
            tension: 0.42,
          },
          {
            label: t('usage_stats.cache_hit_rate'),
            data: cacheHitRateData,
            borderColor: TOKEN_FOCUS_CHART_COLORS.rate,
            backgroundColor: 'rgba(255, 255, 255, 0)',
            pointBackgroundColor: TOKEN_FOCUS_CHART_COLORS.rate,
            pointBorderColor: TOKEN_FOCUS_CHART_COLORS.rate,
            borderWidth: 1.4,
            pointRadius: 0,
            pointHoverRadius: 3,
            pointHitRadius: 10,
            fill: false,
            tension: 0.42,
            yAxisID: 'yRate',
            borderDash: [5, 4],
          },
        ],
      };
    },
    [hourWindowHours, scopedDetails, t]
  );

  const effectiveChartGranularity = timeRange === 'today' ? 'hour' : chartGranularity;
  const chartPeriod: TrendPeriod = effectiveChartGranularity === 'hour' ? 'hour' : 'day';
  const handleChartGranularityChange = useCallback(
    (next: TrendGranularity) => {
      if (timeRange === 'today' && next === 'day') {
        return;
      }
      setChartGranularity(next);
    },
    [timeRange]
  );

  const requestsChartData = useMemo(
    () =>
      renderHeavyUsageSections ? buildTrendChartData('requests', chartPeriod) : EMPTY_CHART_DATA,
    [buildTrendChartData, chartPeriod, renderHeavyUsageSections]
  );
  const tokensChartData = useMemo(
    () =>
      renderHeavyUsageSections
        ? effectiveDetailModelFilter !== REQUEST_EVENTS_ALL_FILTER
          ? buildFocusedTokenChartData(effectiveDetailModelFilter, chartPeriod)
          : buildTrendChartData('tokens', chartPeriod)
        : EMPTY_CHART_DATA,
    [
      buildFocusedTokenChartData,
      buildTrendChartData,
      chartPeriod,
      effectiveDetailModelFilter,
      renderHeavyUsageSections,
    ]
  );
  const costChartData = useMemo(
    () => (renderHeavyUsageSections ? buildTrendChartData('cost', chartPeriod) : EMPTY_CHART_DATA),
    [buildTrendChartData, chartPeriod, renderHeavyUsageSections]
  );
  const requestsChartOptions = useMemo(
    () =>
      buildChartOptions({
        period: chartPeriod,
        labels: requestsChartData.labels,
        isDark,
        isMobile,
      }),
    [chartPeriod, isDark, isMobile, requestsChartData.labels]
  );
  const tokensChartOptions = useMemo(() => {
    const baseOptions = buildChartOptions({
      period: chartPeriod,
      labels: tokensChartData.labels,
      isDark,
      isMobile,
    });

    if (effectiveDetailModelFilter === REQUEST_EVENTS_ALL_FILTER) {
      return baseOptions;
    }

    const yScale = baseOptions.scales?.y as Record<string, unknown> | undefined;
    const tooltip = baseOptions.plugins?.tooltip as Record<string, unknown> | undefined;
    const tooltipCallbacks = tooltip?.callbacks as Record<string, unknown> | undefined;
    const tickColor = isDark ? 'rgba(255, 255, 255, 0.72)' : 'rgba(17, 24, 39, 0.72)';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(17, 24, 39, 0.06)';

    return {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...yScale,
          position: 'left',
        },
        yRate: {
          type: 'linear',
          position: 'right',
          min: 0,
          max: 100,
          grid: {
            display: false,
            color: gridColor,
          },
          border: { display: false },
          ticks: {
            display: true,
            color: tickColor,
            callback: (value: string | number) => `${Number(value).toFixed(0)}%`,
          },
        },
      },
      plugins: {
        ...baseOptions.plugins,
        tooltip: {
          ...tooltip,
          callbacks: {
            ...tooltipCallbacks,
            label: (context: TooltipItem<'line'>) => {
              const label = context.dataset.label || '';
              const value = Number(context.raw);
              if (!Number.isFinite(value)) return label;
              const dataset = context.dataset as { yAxisID?: string };
              if (dataset.yAxisID === 'yRate') {
                return `  ${label}: ${value.toFixed(1)}%`;
              }
              return `  ${label}: ${formatChartValue(value)}`;
            },
          },
        },
      },
    } as ChartOptions<'line'>;
  }, [chartPeriod, effectiveDetailModelFilter, isDark, isMobile, tokensChartData.labels]);
  const topCredentialRows = useMemo(
    () => credentialRows.filter((row) => row.requests > 0).slice(0, 3),
    [credentialRows]
  );
  const handleDetailModelFilterChange = useCallback((value: string) => {
    setDetailModelFilter(value);
    if (value !== REQUEST_EVENTS_ALL_FILTER) {
      setActiveTrendTab('tokens');
    }
  }, []);
  const tokenTrendFocusExtra =
    effectiveDetailModelFilter !== REQUEST_EVENTS_ALL_FILTER ? (
      <div className={styles.tokenTrendFocusPill}>
        <span className={styles.tokenTrendFocusLabel}>{t('usage_stats.token_trend_focus')}</span>
        <span className={styles.tokenTrendFocusModel} title={effectiveDetailModelFilter}>
          {effectiveDetailModelFilter}
        </span>
        <button
          type="button"
          className={styles.tokenTrendFocusReset}
          onClick={() => setDetailModelFilter(REQUEST_EVENTS_ALL_FILTER)}
        >
          {t('usage_stats.token_trend_focus_reset')}
        </button>
      </div>
    ) : undefined;

  return (
    <div className={isRefreshing ? `${styles.container} ${styles.isFetching}` : styles.container}>
      <div
        className={`${styles.progressBar} ${isInitialLoading || showRefreshFeedback ? styles.visible : ''}`}
      />
      {isInitialLoading && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayTextHidden}>{t('common.loading')}</span>
          </div>
        </div>
      )}
      {showRefreshFeedback && (
        <div className={styles.refreshIndicator} aria-live="polite" aria-busy="true">
          <LoadingSpinner size={14} className={styles.refreshIndicatorSpinner} />
          <span>{t('usage_stats.refreshing_data')}</span>
        </div>
      )}

      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
        <div className={styles.headerActions}>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.range_filter')}</span>
            <Select
              value={timeRange}
              options={timeRangeOptions}
              onChange={(value) => setTimeRange(value as UsageTimeRange)}
              className={styles.timeRangeSelectControl}
              ariaLabel={t('usage_stats.range_filter')}
              fullWidth={false}
            />
          </div>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.chart_granularity')}</span>
            <div
              className={styles.globalGranularityGroup}
              role="group"
              aria-label={t('usage_stats.chart_granularity')}
            >
              <button
                type="button"
                className={
                  effectiveChartGranularity === 'hour'
                    ? styles.globalGranularityButtonActive
                    : styles.globalGranularityButton
                }
                aria-pressed={effectiveChartGranularity === 'hour'}
                onClick={() => handleChartGranularityChange('hour')}
              >
                {t('usage_stats.by_hour')}
              </button>
              <button
                type="button"
                className={
                  effectiveChartGranularity === 'day'
                    ? styles.globalGranularityButtonActive
                    : styles.globalGranularityButton
                }
                aria-pressed={effectiveChartGranularity === 'day'}
                onClick={() => handleChartGranularityChange('day')}
                disabled={timeRange === 'today'}
              >
                {t('usage_stats.by_day')}
              </button>
            </div>
          </div>
          <div className={styles.timeRangeGroup}>
            <span className={styles.timeRangeLabel}>{t('usage_stats.credential_filter')}</span>
            <Select
              value={effectiveCredentialFilter}
              options={credentialFilterOptions}
              onChange={(value) => setCredentialFilter(value)}
              className={styles.credentialFilterSelectControl}
              ariaLabel={t('usage_stats.credential_filter')}
              fullWidth={false}
            />
          </div>
          {topCredentialRows.length > 0 && (
            <div
              className={styles.topKeyQuickGroup}
              aria-label={t('usage_stats.top_key_quick_filter')}
            >
              <span className={styles.topKeyQuickLabel}>{t('usage_stats.top_key')}</span>
              {topCredentialRows.map((row) => (
                <button
                  key={row.value}
                  type="button"
                  className={
                    effectiveCredentialFilter === row.value
                      ? styles.topKeyQuickButtonActive
                      : styles.topKeyQuickButton
                  }
                  aria-pressed={effectiveCredentialFilter === row.value}
                  onClick={() =>
                    setCredentialFilter(
                      effectiveCredentialFilter === row.value ? ALL_FILTER : row.value
                    )
                  }
                  title={`${row.label}: ${row.requests.toLocaleString()}`}
                >
                  <svg
                    className={styles.topKeyQuickIcon}
                    aria-hidden="true"
                    focusable="false"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="7.5" cy="15.5" r="5.5" />
                    <path d="m21 2-9.6 9.6" />
                    <path d="m15.5 7.5 3 3" />
                    <path d="m17.5 5.5 3 3" />
                  </svg>
                  <span className={styles.topKeyQuickText}>{row.label}</span>
                  {effectiveCredentialFilter === row.value && (
                    <span className={styles.topKeyQuickStateDot} />
                  )}
                </button>
              ))}
            </div>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            disabled={isInitialLoading || importing}
          >
            {t('usage_stats.export')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImport}
            loading={importing}
            disabled={isInitialLoading || exporting}
          >
            {t('usage_stats.import')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadUsage().catch(() => {})}
            loading={showRefreshFeedback}
            disabled={isInitialLoading || exporting || importing}
          >
            {t('usage_stats.refresh')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportChange}
          />
          {lastRefreshedAt && (
            <span className={styles.lastRefreshed}>
              {t('usage_stats.last_updated')}: {lastRefreshedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {renderHeavyUsageSections && (
        <div className={styles.topStatusRow}>
          <ServiceHealthCard
            usage={usage}
            loading={isInitialLoading}
            collapsible={true}
            defaultCollapsed={true}
          />
        </div>
      )}

      {/* Summary Cards - Top 4 KPIs */}
      {isInitialLoading || !filteredUsage ? (
        <SummaryCardsPlaceholder />
      ) : (
        <SummaryCards
          usage={scopedUsage}
          loading={isInitialLoading}
          modelPrices={visibleModelPrices}
        />
      )}

      {/* Stats Overview Cards - Collapsible */}
      <StatCards
        usage={visibleScopedUsage}
        loading={isInitialLoading}
        modelPrices={visibleModelPrices}
        requestsChartData={requestsChartData}
        requestsChartOptions={requestsChartOptions}
        tokensChartData={tokensChartData}
        tokensChartOptions={tokensChartOptions}
      />

      {renderHeavyUsageSections ? (
        <TrendTabsCard
          tabs={[
            {
              key: 'requests',
              label: t('usage_stats.requests_trend'),
              chartProps: {
                chartData: requestsChartData,
                loading: isInitialLoading,
                isMobile,
                isNarrowScreen,
                isDark,
                emptyText: t('usage_stats.no_data'),
                timeRange,
              },
            },
            {
              key: 'tokens',
              label: t('usage_stats.tokens_trend'),
              chartProps: {
                chartData: tokensChartData,
                loading: isInitialLoading,
                isMobile,
                isNarrowScreen,
                isDark,
                emptyText: t('usage_stats.no_data'),
                extra: tokenTrendFocusExtra,
                timeRange,
              },
            },
            {
              key: 'cost',
              label: t('usage_stats.cost_trend'),
              chartProps: {
                chartData: costChartData,
                loading: isInitialLoading,
                isMobile,
                isNarrowScreen,
                isDark,
                emptyText: hasPrices
                  ? t('usage_stats.cost_no_data')
                  : t('usage_stats.cost_need_price'),
                timeRange,
              },
            },
          ]}
          activeTab={activeTrendTab}
          onTabChange={setActiveTrendTab}
          lineSelector={{
            chartLines: resolvedChartLines,
            modelNames,
            credentialOptions,
            compareMode: chartCompareMode,
            onCompareModeChange: setChartCompareMode,
            maxLines: MAX_CHART_LINES,
            onChange: handleChartLinesChange,
            visibleOnTabs:
              effectiveDetailModelFilter !== REQUEST_EVENTS_ALL_FILTER
                ? ['requests', 'cost']
                : undefined,
          }}
        />
      ) : (
        <TrendTabsPlaceholder title={t('usage_stats.trend_analysis')} />
      )}

      {/* Model Token Distribution Doughnut */}
      {renderHeavyUsageSections && (
        <ModelTokenDoughnut
          modelStats={modelStats}
          hasPrices={hasPrices}
          loading={isInitialLoading}
          isDark={isDark}
          scopedUsage={visibleScopedUsage}
          chartPeriod={chartPeriod}
          hourWindowHours={hourWindowHours}
          modelPrices={visibleModelPrices}
          timeRange={timeRange}
          onChartPeriodChange={handleChartGranularityChange}
        />
      )}

      {/* Request Events Details */}
      {renderHeavyUsageSections && (
        <RequestEventsDetailsCard
          usage={visibleScopedUsage}
          loading={isInitialLoading}
          geminiKeys={config?.geminiApiKeys || []}
          claudeConfigs={config?.claudeApiKeys || []}
          codexConfigs={config?.codexApiKeys || []}
          vertexConfigs={config?.vertexApiKeys || []}
          openaiProviders={openaiProvidersForUsage}
          selectedModelFilter={effectiveDetailModelFilter}
          onSelectedModelFilterChange={handleDetailModelFilterChange}
        />
      )}

      <div className={styles.modelPanel}>
        <div className={styles.modelPanelTabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={modelPanelTab === 'stats'}
            className={
              modelPanelTab === 'stats' ? styles.modelPanelTabActive : styles.modelPanelTab
            }
            onClick={() => setModelPanelTab('stats')}
          >
            {t('usage_stats.models')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={modelPanelTab === 'credentials'}
            className={
              modelPanelTab === 'credentials' ? styles.modelPanelTabActive : styles.modelPanelTab
            }
            onClick={() => setModelPanelTab('credentials')}
          >
            {t('usage_stats.credential_stats')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={modelPanelTab === 'prices'}
            className={
              modelPanelTab === 'prices' ? styles.modelPanelTabActive : styles.modelPanelTab
            }
            onClick={() => setModelPanelTab('prices')}
          >
            {t('usage_stats.model_price_settings')}
          </button>
        </div>
        {renderHeavyUsageSections || modelPanelTab === 'prices' ? (
          modelPanelTab === 'stats' ? (
            <ModelStatsCard
              modelStats={modelStats}
              loading={isInitialLoading}
              hasPrices={hasPrices}
            />
          ) : modelPanelTab === 'credentials' ? (
            <CredentialStatsCard
              usage={visibleScopedUsage}
              loading={isInitialLoading}
              apiKeyEntries={clientApiKeys}
              modelPrices={visibleModelPrices}
            />
          ) : (
            <PriceSettingsCard
              modelNames={modelNames}
              modelPrices={modelPrices}
              onPricesChange={setModelPrices}
            />
          )
        ) : (
          <ModelPanelPlaceholder
            title={
              modelPanelTab === 'stats'
                ? t('usage_stats.models')
                : t('usage_stats.credential_stats')
            }
          />
        )}
      </div>
    </div>
  );
}
