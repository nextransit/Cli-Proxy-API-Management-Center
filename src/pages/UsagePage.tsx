import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
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
  ChartLineSelector,
  UsageChart,
  ModelStatsCard,
  PriceSettingsCard,
  CredentialStatsCard,
  RequestEventsDetailsCard,
  ServiceHealthCard,
  useUsageData,
} from '@/components/usage';
import {
  calculateCost,
  type ChartData,
  getModelNamesFromUsage,
  getModelStats,
  filterUsageByTimeRange,
  collectUsageDetails,
  extractTotalTokens,
  filterUsageDetails,
  formatDayLabel,
  formatHourLabel,
  formatUsd,
  type UsageTimeRange,
} from '@/utils/usage';
import { maskApiKey } from '@/utils/format';
import type { ChartOptions } from 'chart.js';
import { buildChartOptions } from '@/utils/usage/chartConfig';
import styles from './UsagePage.module.scss';

// Register Chart.js components
ChartJS.register(
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
  { value: 'all', labelKey: 'usage_stats.range_all' },
  { value: '7h', labelKey: 'usage_stats.range_7h' },
  { value: '24h', labelKey: 'usage_stats.range_24h' },
  { value: '7d', labelKey: 'usage_stats.range_7d' },
  { value: '30d', labelKey: 'usage_stats.range_30d' },
];
const HOUR_WINDOW_BY_TIME_RANGE: Record<Exclude<UsageTimeRange, 'all'>, number> = {
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

const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === '7h' || value === '24h' || value === '7d' || value === '30d' || value === 'all';

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

const CHART_COLORS = [
  '#06b6d4',
  '#22d3ee',
  '#8b5cf6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#6366f1',
  '#14b8a6',
  '#f472b6',
];

type TrendMetric = 'requests' | 'tokens' | 'cost';
type TrendPeriod = 'hour' | 'day';
type TrendGranularity = TrendPeriod | 'all';

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

export function UsagePage() {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';
  const config = useConfigStore((state) => state.config);
  const openaiCompatibilityConfig = config?.openaiCompatibility;
  const [openaiProvidersWithAuthIndex, setOpenaiProvidersWithAuthIndex] = useState<{
    source: OpenAIProviderConfig[] | undefined;
    providers: OpenAIProviderConfig[];
  } | null>(null);

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
  } = useUsageData();

  useHeaderRefresh(loadUsage);

  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);
  const [chartLines, setChartLines] = useState<string[]>(loadChartLines);
  const [chartCompareMode, setChartCompareMode] =
    useState<ChartCompareMode>(loadChartCompareMode);
  const [credentialFilter, setCredentialFilter] = useState<string>(loadCredentialFilter);
  const [modelPanelTab, setModelPanelTab] = useState<'stats' | 'credentials' | 'prices'>('stats');
  const [clientApiKeyEntries, setClientApiKeyEntries] = useState<APIKeyEntry[]>([]);
  const [chartGranularity, setChartGranularity] = useState<TrendGranularity>('hour');

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

  const filteredUsage = useMemo(
    () => (usage ? filterUsageByTimeRange(usage, timeRange) : null),
    [usage, timeRange]
  );

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

    collectUsageDetails(filteredUsage).forEach((detail) => {
      const value = String(detail.__apiKey ?? '').trim() || 'unknown';
      const keyInfo = clientApiKeyInfoMap.get(value);
      const row =
        rowMap.get(value) ??
        {
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
  }, [clientApiKeyInfoMap, filteredUsage, modelPrices, t]);

  const credentialOptions = useMemo(
    () => {
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
      return Array.from(options.values());
    },
    [clientApiKeys, credentialRows]
  );

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

  const hourWindowHours = timeRange === 'all' ? undefined : HOUR_WINDOW_BY_TIME_RANGE[timeRange];

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

  const buildTrendChartData = useCallback(
    (metric: TrendMetric, period: TrendPeriod): ChartData => {
      if (metric === 'cost' && Object.keys(modelPrices).length === 0) {
        return { labels: [], datasets: [] };
      }

      const details = collectUsageDetails(scopedUsage);
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
        const key = chartCompareMode === 'credential' ? credentialKey : detail.__modelName || 'Unknown';
        const displayLabel =
          chartCompareMode === 'credential' ? keyInfo?.label || formatCredentialShortName(key) : key;

        if (!dataByKey.has(key)) {
          dataByKey.set(key, new Array(labels.length).fill(0));
          lineLabels.set(key, displayLabel);
        }
        dataByKey.get(key)![index] += getTrendValue(metric, detail, modelPrices);
      });

      const selectedLines = chartLines.length > 0 ? chartLines : DEFAULT_CHART_LINES;
      const multiLine = selectedLines.length > 1 && !selectedLines.includes(ALL_FILTER);
      const datasets = selectedLines.map((line, index) => {
        const isAll = line === ALL_FILTER;
        const data = isAll
          ? labels.map((_, labelIndexValue) =>
              Array.from(dataByKey.values()).reduce(
                (sum, values) => sum + (values[labelIndexValue] || 0),
                0
              )
            )
          : dataByKey.get(line) || new Array(labels.length).fill(0);
        const color = CHART_COLORS[index % CHART_COLORS.length];

        return {
          label: isAll
            ? chartCompareMode === 'credential'
              ? t('usage_stats.chart_line_all_credentials')
              : t('usage_stats.chart_line_all')
            : lineLabels.get(line) || formatCredentialShortName(line),
          data,
          borderColor: color,
          // Multi-line: use semi-transparent fills so overlapping areas are visible.
          // Single/"all": full opacity gradient fill.
          backgroundColor: multiLine ? withAlpha(color, 0.08) : withAlpha(color, 0.18),
          pointBackgroundColor: color,
          pointBorderColor: color,
          // Enable fill for all datasets — stacked-like visual with translucent overlap
          fill: true,
          tension: 0.35,
        };
      });

      return { labels, datasets };
    },
    [
      chartCompareMode,
      chartLines,
      clientApiKeyInfoMap,
      hourWindowHours,
      modelPrices,
      scopedUsage,
      t,
    ]
  );

  const chartPeriod: TrendPeriod = chartGranularity === 'hour' ? 'hour' : 'day';
  const handleChartGranularityChange = useCallback((next: TrendGranularity) => {
    setChartGranularity(next);
    if (next === 'all') {
      setTimeRange('all');
    }
  }, []);

  const requestsChartData = useMemo(
    () => buildTrendChartData('requests', chartPeriod),
    [buildTrendChartData, chartPeriod]
  );
  const tokensChartData = useMemo(
    () => buildTrendChartData('tokens', chartPeriod),
    [buildTrendChartData, chartPeriod]
  );
  const costChartData = useMemo(
    () => buildTrendChartData('cost', chartPeriod),
    [buildTrendChartData, chartPeriod]
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
  const tokensChartOptions = useMemo(
    () =>
      buildChartOptions({
        period: chartPeriod,
        labels: tokensChartData.labels,
        isDark,
        isMobile,
      }),
    [chartPeriod, isDark, isMobile, tokensChartData.labels]
  );
  const costChartOptions = useMemo(() => {
    const baseOptions = buildChartOptions({
      period: chartPeriod,
      labels: costChartData.labels,
      isDark,
      isMobile,
    });

    return {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...((baseOptions.scales?.y as object) || {}),
          ticks: {
            ...(((baseOptions.scales?.y as { ticks?: object } | undefined)?.ticks as object) || {}),
            callback: (value: string | number) => formatUsd(Number(value)),
          },
        },
      },
    } as ChartOptions<'line'>;
  }, [chartPeriod, costChartData.labels, isDark, isMobile]);

  // Derived data
  const modelNames = useMemo(() => getModelNamesFromUsage(scopedUsage), [scopedUsage]);
  const modelStats = useMemo(
    () => getModelStats(scopedUsage, modelPrices),
    [modelPrices, scopedUsage]
  );

  // Auto-select top 4 lines for the active comparison mode when usage data loads.
  useEffect(() => {
    if (!loading && usage && chartLines.length === 1 && chartLines[0] === 'all') {
      if (chartCompareMode === 'credential') {
        const topCredentials = credentialRows
          .filter((row) => row.requests > 0)
          .slice(0, 4)
          .map((row) => row.value);
        if (topCredentials.length > 0) {
          setChartLines(topCredentials);
        }
        return;
      }

      const topModels = [...modelStats]
        .sort((a, b) => b.requests - a.requests)
        .slice(0, 4)
        .map((s) => s.model);
      if (topModels.length > 0) {
        setChartLines(topModels);
      }
    }
  }, [chartCompareMode, chartLines, credentialRows, loading, modelStats, usage]);

  const hasPrices = Object.keys(modelPrices).length > 0;
  const topCredentialRows = useMemo(
    () => credentialRows.filter((row) => row.requests > 0).slice(0, 3),
    [credentialRows]
  );
  const isInitialLoading = loading && !usage;
  const isRefreshing = loading && Boolean(usage);

  return (
    <div className={isRefreshing ? `${styles.container} ${styles.isFetching}` : styles.container}>
      <div className={`${styles.progressBar} ${loading ? styles.visible : ''}`} />
      {isInitialLoading && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayTextHidden}>{t('common.loading')}</span>
          </div>
        </div>
      )}
      {isRefreshing && (
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
            <div className={styles.globalGranularityGroup} role="group" aria-label={t('usage_stats.chart_granularity')}>
              <button
                type="button"
                className={chartGranularity === 'hour' ? styles.globalGranularityButtonActive : styles.globalGranularityButton}
                onClick={() => handleChartGranularityChange('hour')}
              >
                {t('usage_stats.by_hour')}
              </button>
              <button
                type="button"
                className={chartGranularity === 'day' ? styles.globalGranularityButtonActive : styles.globalGranularityButton}
                onClick={() => handleChartGranularityChange('day')}
              >
                {t('usage_stats.by_day')}
              </button>
              <button
                type="button"
                className={chartGranularity === 'all' ? styles.globalGranularityButtonActive : styles.globalGranularityButton}
                onClick={() => handleChartGranularityChange('all')}
              >
                {t('usage_stats.chart_granularity_all')}
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
            <div className={styles.topKeyQuickGroup} aria-label={t('usage_stats.top_key_quick_filter')}>
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
                  onClick={() => setCredentialFilter(row.value)}
                  title={`${row.label}: ${row.requests.toLocaleString()}`}
                >
                  {row.label}
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
            loading={isRefreshing}
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

      <div className={styles.topStatusRow}>
        <ServiceHealthCard
          usage={usage}
          loading={isInitialLoading}
          collapsible={true}
          defaultCollapsed={true}
        />
      </div>

      {/* Summary Cards - Top 4 KPIs */}
      <SummaryCards
        usage={scopedUsage}
        loading={isInitialLoading}
        modelPrices={modelPrices}
      />

      {/* Stats Overview Cards - Collapsible */}
      <StatCards
        usage={scopedUsage}
        modelPrices={modelPrices}
        requestsChartData={requestsChartData}
        requestsChartOptions={requestsChartOptions}
        tokensChartData={tokensChartData}
        tokensChartOptions={tokensChartOptions}
      />

      <div className={styles.chartsGrid}>
        <UsageChart
          title={t('usage_stats.requests_trend')}
          period={chartPeriod}
          onPeriodChange={setChartGranularity}
          showPeriodControls={false}
          chartData={requestsChartData}
          chartOptions={requestsChartOptions}
          loading={isInitialLoading}
          isMobile={isMobile}
          isDark={isDark}
          emptyText={t('usage_stats.no_data')}
          extra={
            <ChartLineSelector
              chartLines={chartLines}
              modelNames={modelNames}
              credentialOptions={credentialOptions}
              compareMode={chartCompareMode}
              onCompareModeChange={setChartCompareMode}
              maxLines={MAX_CHART_LINES}
              onChange={handleChartLinesChange}
            />
          }
        />
        <UsageChart
          title={t('usage_stats.tokens_trend')}
          period={chartPeriod}
          onPeriodChange={setChartGranularity}
          showPeriodControls={false}
          chartData={tokensChartData}
          chartOptions={tokensChartOptions}
          loading={isInitialLoading}
          isMobile={isMobile}
          isDark={isDark}
          emptyText={t('usage_stats.no_data')}
        />
        <UsageChart
          title={t('usage_stats.cost_trend')}
          period={chartPeriod}
          onPeriodChange={setChartGranularity}
          showPeriodControls={false}
          chartData={costChartData}
          chartOptions={costChartOptions}
          loading={isInitialLoading}
          isMobile={isMobile}
          isDark={isDark}
          emptyText={hasPrices ? t('usage_stats.cost_no_data') : t('usage_stats.cost_need_price')}
        />
      </div>

      {/* Request Events Details */}
      <RequestEventsDetailsCard
        usage={scopedUsage}
        loading={isInitialLoading}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={openaiProvidersForUsage}
      />

      <div className={styles.modelPanel}>
        <div className={styles.modelPanelTabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={modelPanelTab === 'stats'}
            className={modelPanelTab === 'stats' ? styles.modelPanelTabActive : styles.modelPanelTab}
            onClick={() => setModelPanelTab('stats')}
          >
            {t('usage_stats.models')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={modelPanelTab === 'credentials'}
            className={modelPanelTab === 'credentials' ? styles.modelPanelTabActive : styles.modelPanelTab}
            onClick={() => setModelPanelTab('credentials')}
          >
            {t('usage_stats.credential_stats')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={modelPanelTab === 'prices'}
            className={modelPanelTab === 'prices' ? styles.modelPanelTabActive : styles.modelPanelTab}
            onClick={() => setModelPanelTab('prices')}
          >
            {t('usage_stats.model_price_settings')}
          </button>
        </div>
        {modelPanelTab === 'stats' ? (
          <ModelStatsCard modelStats={modelStats} loading={isInitialLoading} hasPrices={hasPrices} />
        ) : modelPanelTab === 'credentials' ? (
          <CredentialStatsCard
            usage={scopedUsage}
            loading={isInitialLoading}
            apiKeyEntries={clientApiKeys}
            modelPrices={modelPrices}
          />
        ) : (
          <PriceSettingsCard
            modelNames={modelNames}
            modelPrices={modelPrices}
            onPricesChange={setModelPrices}
          />
        )}
      </div>

    </div>
  );
}
