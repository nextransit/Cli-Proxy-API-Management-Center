import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconKey,
  IconFileText,
  IconSatellite
} from '@/components/ui/icons';
import { useDashboardLiveRefresh } from '@/components/usage/hooks/useDashboardLiveRefresh';
import { useAuthStore, useConfigStore, useDashboardViewStore, useModelsStore } from '@/stores';
import { apiKeysApi, providersApi, authFilesApi } from '@/services/api';
import { formatDateOrFallback } from '@/utils/format';
import { formatCompactNumber, formatDurationMs } from '@/utils/usage';
import type { DashboardLatestRequest } from '@/services/api/usage';
import styles from './DashboardPage.module.scss';

// ── Pure helpers (outside component) ────────────────────────────────────────

interface ProviderStats {
  gemini: number | null;
  codex: number | null;
  claude: number | null;
  openai: number | null;
}

interface ProviderSegment {
  key: keyof ProviderStats;
  label: string;
  shortLabel: string;
  value: number;
  color: string;
}

interface DashboardTelemetryShape {
  buckets: Array<{
    label: string;
    requests: number;
    tokens: number;
    latencyTotal: number;
    latencySamples: number;
  }>;
  totalTokens: number;
  requestCount: number;
  successRate: number | null;
  avgLatency: number | null;
  tpm: number;
  tps: number;
}

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

const PROVIDER_PALETTE: Record<keyof ProviderStats, string> = {
  gemini: '#22c55e',
  codex: '#38bdf8',
  claude: '#a78bfa',
  openai: '#f59e0b',
};

const PROVIDER_LABELS: Record<keyof ProviderStats, { label: string; shortLabel: string }> = {
  gemini: { label: 'Gemini', shortLabel: 'G' },
  codex: { label: 'Codex', shortLabel: 'C' },
  claude: { label: 'Claude', shortLabel: 'Cl' },
  openai: { label: 'OpenAI', shortLabel: 'O' },
};

function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function toSafeNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function buildProviderGradient(segments: ProviderSegment[]): string {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) {
    return 'conic-gradient(rgba(148, 163, 184, 0.18) 0deg 360deg)';
  }
  let cursor = 0;
  const stops = segments
    .filter((segment) => segment.value > 0)
    .map((segment) => {
      const start = cursor;
      cursor += (segment.value / total) * 360;
      return `${segment.color} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
    });
  return `conic-gradient(${stops.join(', ')})`;
}

function buildSparklinePoints(values: number[], width = 220, height = 64): string {
  if (!values.length) return '';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 10) - 5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function formatMetric(value: number): string {
  return formatCompactNumber(Math.max(0, Math.round(value)));
}

function normalizeApiKeyList(input: unknown): string[] {
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
}

// ── Memoized Sparkline sub-component ────────────────────────────────────────

const Sparkline = memo(function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const points = useMemo(() => buildSparklinePoints(values), [values]);
  return (
    <svg className={className} viewBox="0 0 220 64" preserveAspectRatio="none" aria-hidden="true">
      <polyline className={styles.sparklineGlow} points={points} />
      <polyline className={styles.sparklineLine} points={points} />
    </svg>
  );
});

// ── Main component ──────────────────────────────────────────────────────────

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);
  const dashboardView = useDashboardViewStore((state) => state.view);
  const dashboardLoading = useDashboardViewStore((state) => state.loading);
  const dashboardError = useDashboardViewStore((state) => state.error);
  const dashboardLastRefreshedAt = useDashboardViewStore((state) => state.lastRefreshedAt);
  const loadDashboardView = useDashboardViewStore((state) => state.loadDashboardView);
  const dashboardEnabled =
    connectionStatus === 'connected' &&
    Boolean(apiBase) &&
    config?.usageStatisticsEnabled !== false;

  const [stats, setStats] = useState<{
    apiKeys: number | null;
    authFiles: number | null;
  }>({
    apiKeys: null,
    authFiles: null
  });

  const [providerStats, setProviderStats] = useState<ProviderStats>({
    gemini: null,
    codex: null,
    claude: null,
    openai: null
  });

  // Time-of-day state for dynamic greeting
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(getTimeOfDay);

  const apiKeysCache = useRef<string[]>([]);
  const fetchModelsRef = useRef<() => void>(() => {});

  useDashboardLiveRefresh(dashboardEnabled);

  // ── Config key cache ────────────────────────────────────────────────────

  // Stable serialized key for cache invalidation — avoids new reference on every render.
  const configApiKeysKey = useMemo(
    () => (config?.apiKeys ? JSON.stringify(config.apiKeys) : ''),
    [config?.apiKeys]
  );

  useEffect(() => {
    apiKeysCache.current = [];
  }, [apiBase, configApiKeysKey]);

  // ── Hourly clock ────────────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => {
      setTimeOfDay(getTimeOfDay());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // ── API fetchers (kept stable via ref to avoid effect re-runs) ──────────

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
    } catch {
      return [];
    }
  }, [config?.apiKeys]);

  const fetchModels = useCallback(async () => {
    if (connectionStatus !== 'connected' || !apiBase) return;
    try {
      const apiKeys = await resolveApiKeysForModels();
      const primaryKey = apiKeys[0];
      await fetchModelsFromStore(apiBase, primaryKey);
    } catch {
      // Ignore model fetch errors on dashboard
    }
  }, [connectionStatus, apiBase, resolveApiKeysForModels, fetchModelsFromStore]);

  // Keep ref in sync so the effect can use the latest callback without re-running.
  fetchModelsRef.current = fetchModels;

  // ── Initial data fetch (only on connectionStatus change) ────────────────

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [keysRes, filesRes, geminiRes, codexRes, claudeRes, openaiRes] = await Promise.allSettled([
          apiKeysApi.list(),
          authFilesApi.list(),
          providersApi.getGeminiKeys(),
          providersApi.getCodexConfigs(),
          providersApi.getClaudeConfigs(),
          providersApi.getOpenAIProviders()
        ]);

        setStats({
          apiKeys: keysRes.status === 'fulfilled' ? keysRes.value.length : null,
          authFiles: filesRes.status === 'fulfilled' ? filesRes.value.files.length : null
        });

        setProviderStats({
          gemini: geminiRes.status === 'fulfilled' ? geminiRes.value.length : null,
          codex: codexRes.status === 'fulfilled' ? codexRes.value.length : null,
          claude: claudeRes.status === 'fulfilled' ? claudeRes.value.length : null,
          openai: openaiRes.status === 'fulfilled' ? openaiRes.value.length : null
        });
      } catch {
        // Dashboard cards stay in their pending state when aggregate loading fails.
      }
    };

    if (connectionStatus === 'connected') {
      fetchStats();
      fetchModelsRef.current();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus]);

  // ── Dashboard view load ─────────────────────────────────────────────────

  useEffect(() => {
    if (!dashboardEnabled) {
      return;
    }
    void loadDashboardView({ window: '24h' }).catch(() => {});
  }, [dashboardEnabled, loadDashboardView]);

  // ── Derived data ────────────────────────────────────────────────────────

  const providerStatsReady = useMemo(
    () =>
      providerStats.gemini !== null &&
      providerStats.codex !== null &&
      providerStats.claude !== null &&
      providerStats.openai !== null,
    [providerStats]
  );

  const totalProviderKeys = useMemo(
    () =>
      providerStatsReady
        ? (providerStats.gemini ?? 0) +
          (providerStats.codex ?? 0) +
          (providerStats.claude ?? 0) +
          (providerStats.openai ?? 0)
        : 0,
    [providerStats, providerStatsReady]
  );

  const providerSegments = useMemo<ProviderSegment[]>(
    () =>
      (Object.keys(PROVIDER_LABELS) as Array<keyof ProviderStats>).map((key) => ({
        key,
        label: PROVIDER_LABELS[key].label,
        shortLabel: PROVIDER_LABELS[key].shortLabel,
        value: providerStats[key] ?? 0,
        color: PROVIDER_PALETTE[key],
      })),
    [providerStats]
  );

  const providerGradient = useMemo(
    () => buildProviderGradient(providerSegments),
    [providerSegments]
  );

  const providerStatusValue = useMemo(
    () =>
      providerStatsReady && totalProviderKeys > 0
        ? `${connectionStatus === 'connected' ? totalProviderKeys : 0}/${totalProviderKeys}`
        : '-',
    [providerStatsReady, totalProviderKeys, connectionStatus]
  );

  // ── Dashboard telemetry ─────────────────────────────────────────────────
  // The dashboard view provides a pre-aggregated telemetry shape so we no
  // longer scan every request detail on the client. Each derived series is
  // memoized so unrelated re-renders (greeting refresh, inventory updates)
  // keep stable references.

  const flowBuckets = useMemo(
    () => (Array.isArray(dashboardView?.flow_buckets) ? dashboardView!.flow_buckets : []),
    [dashboardView]
  );

  const usageTelemetry = useMemo<DashboardTelemetryShape>(() => {
    if (!flowBuckets.length) {
      return {
        buckets: [],
        totalTokens: 0,
        requestCount: 0,
        successRate: null,
        avgLatency: null,
        tpm: 0,
        tps: 0,
      };
    }
    const buckets = flowBuckets.map((bucket) => {
      const requests = toSafeNumber(bucket.requests);
      const tokens = toSafeNumber(bucket.tokens);
      const avgLatencyMs = toSafeNumber(bucket.avg_latency_ms);
      const latencySamples = avgLatencyMs > 0 ? requests : 0;
      const label = typeof bucket.label === 'string' && bucket.label.length > 0
        ? bucket.label
        : new Date(toSafeNumber(bucket.start_ms)).toLocaleTimeString(i18n.language, {
            hour: '2-digit',
            minute: '2-digit',
          });
      return {
        label,
        requests,
        tokens,
        latencyTotal: avgLatencyMs * requests,
        latencySamples,
      };
    });
    const totalTokens = buckets.reduce((sum, bucket) => sum + bucket.tokens, 0);
    const requestCount = buckets.reduce((sum, bucket) => sum + bucket.requests, 0);
    const windowRequests = toSafeNumber(dashboardView?.window_requests);
    const windowFailures = toSafeNumber(dashboardView?.window_failures);
    const aggregateSuccessRate =
      windowRequests > 0
        ? ((windowRequests - windowFailures) / windowRequests) * 100
        : null;
    const latencyTotal = buckets.reduce(
      (sum, bucket) => sum + bucket.latencyTotal,
      0
    );
    const avgLatency =
      requestCount > 0 ? latencyTotal / requestCount : null;

    return {
      buckets,
      totalTokens,
      requestCount,
      successRate: aggregateSuccessRate,
      avgLatency: avgLatency && avgLatency > 0 ? avgLatency : null,
      tpm: totalTokens / 60,
      tps: totalTokens / 3600,
    };
  }, [dashboardView, flowBuckets, i18n.language]);

  const tokenSeries = useMemo(
    () => usageTelemetry.buckets.map((bucket) => bucket.tokens),
    [usageTelemetry]
  );
  const requestSeries = useMemo(
    () => usageTelemetry.buckets.map((bucket) => bucket.requests),
    [usageTelemetry]
  );
  const latencySeries = useMemo(
    () =>
      usageTelemetry.buckets.map((bucket) =>
        bucket.latencySamples > 0 ? bucket.latencyTotal / bucket.latencySamples : 0
      ),
    [usageTelemetry]
  );
  const maxRequestBucket = useMemo(() => Math.max(...requestSeries, 1), [requestSeries]);
  const maxLatencyBucket = useMemo(() => Math.max(...latencySeries, 1), [latencySeries]);
  const latencyPoints = useMemo(
    () => buildSparklinePoints(latencySeries, 220, 72),
    [latencySeries]
  );

  // ── Model distribution (pre-aggregated by the backend) ──────────────────

  const modelDistribution = useMemo(() => {
    const rows = Array.isArray(dashboardView?.model_top) ? dashboardView!.model_top : [];
    const limited = rows.slice(0, 5);
    const totalTokens = limited.reduce(
      (sum, row) => sum + toSafeNumber(row.tokens),
      0
    );
    return {
      rows: limited.map((row) => ({
        model: row.model,
        tokens: toSafeNumber(row.tokens),
        requests: toSafeNumber(row.requests),
      })),
      totalTokens,
    };
  }, [dashboardView]);

  // ── Latest requests (pre-aggregated by the backend) ─────────────────────

  const latestRequests = useMemo<DashboardLatestRequest[]>(
    () => (Array.isArray(dashboardView?.latest_requests) ? dashboardView!.latest_requests : []),
    [dashboardView]
  );

  // ── Inline computations (memoized) ──────────────────────────────────────

  const inventorySeries = useMemo(
    () => [stats.apiKeys ?? 0, stats.authFiles ?? 0, totalProviderKeys, models.length],
    [stats.apiKeys, stats.authFiles, totalProviderKeys, models.length]
  );

  const totalUsageRequests = useMemo(
    () =>
      dashboardView
        ? toSafeNumber(dashboardView.window_requests)
        : 0,
    [dashboardView]
  );

  const totalUsageTokens = useMemo(
    () =>
      dashboardView
        ? toSafeNumber(dashboardView.window_tokens)
        : 0,
    [dashboardView]
  );

  const usageEnabled = dashboardEnabled;

  const usageRefreshedLabel = useMemo(
    () =>
      dashboardLastRefreshedAt
        ? new Date(dashboardLastRefreshedAt).toLocaleTimeString(i18n.language, {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '-',
    [dashboardLastRefreshedAt, i18n.language]
  );


  const routingStrategyRaw = useMemo(
    () => config?.routingStrategy?.trim() || '',
    [config?.routingStrategy]
  );

  const routingStrategyDisplay = useMemo(() => {
    if (!routingStrategyRaw) return '-';
    if (routingStrategyRaw === 'round-robin') return t('basic_settings.routing_strategy_round_robin');
    if (routingStrategyRaw === 'fill-first') return t('basic_settings.routing_strategy_fill_first');
    return routingStrategyRaw;
  }, [routingStrategyRaw, t]);

  const routingStrategyBadgeClass = useMemo(() => {
    if (!routingStrategyRaw) return styles.configBadgeUnknown;
    if (routingStrategyRaw === 'round-robin') return styles.configBadgeRoundRobin;
    if (routingStrategyRaw === 'fill-first') return styles.configBadgeFillFirst;
    return styles.configBadgeUnknown;
  }, [routingStrategyRaw]);

  // Derived time-based values
  const greetingKey = `dashboard.greeting_${timeOfDay}`;
  const caringKey = `dashboard.caring_${timeOfDay}`;

  const formattedBuildDate = useMemo(
    () => formatDateOrFallback(serverBuildDate, i18n.language),
    [serverBuildDate, i18n.language]
  );

  return (
    <div className={styles.dashboard}>
      <div className={styles.backgroundGrid} aria-hidden="true" />

      {/* Hero welcome section */}
      <section className={styles.hero}>
        <span className={styles.heroWatermark} aria-hidden="true">
          OVERVIEW
        </span>
        <div className={styles.heroContent}>
          <span className={styles.heroGreeting}>{t(greetingKey)}</span>
          <h1 className={styles.heroTitle}>{t('dashboard.welcome_back')}</h1>
          <p className={styles.heroCaring}>{t(caringKey)}</p>
        </div>
        <div className={styles.heroMeta}>
          <div className={styles.dateTimeBlock}>
            <span className={styles.time}>{t('dashboard.time_placeholder', { defaultValue: '--:--' })}</span>
            <span className={styles.date}>{t('dashboard.date_placeholder', { defaultValue: '---' })}</span>
          </div>
          <div className={styles.connectionPill}>
            <span
              className={`${styles.statusDot} ${
                connectionStatus === 'connected'
                  ? styles.connected
                  : connectionStatus === 'connecting'
                    ? styles.connecting
                    : styles.disconnected
              }`}
            />
            <span className={styles.pillText}>
              {serverVersion
                ? `v${serverVersion.trim().replace(/^[vV]+/, '')}`
                : t(
                    connectionStatus === 'connected'
                      ? 'common.connected'
                      : connectionStatus === 'connecting'
                        ? 'common.connecting'
                        : 'common.disconnected'
                  )}
            </span>
          </div>
          {formattedBuildDate && (
            <span className={styles.buildDate}>
              {formattedBuildDate}
            </span>
          )}
        </div>
      </section>

      <section className={styles.statsSection}>
        <h2 className={styles.sectionHeading}>{t('dashboard.system_overview')}</h2>
        <div className={styles.instrumentGrid}>
          <Link to="/ai-providers" className={`${styles.instrumentCard} ${styles.providerCard}`}>
            <div className={styles.instrumentHeader}>
              <div>
                <span className={styles.instrumentEyebrow}>PROVIDER MATRIX</span>
                <h3 className={styles.instrumentTitle}>{t('nav.ai_providers')}</h3>
              </div>
              <span className={styles.liveBadge}>
                <span
                  className={`${styles.liveDot} ${
                    connectionStatus === 'connected' ? styles.liveDotActive : ''
                  }`}
                  aria-hidden="true"
                />
                {providerStatusValue}
              </span>
            </div>

            <div className={styles.providerMatrixBody}>
              <div className={styles.providerDonut} style={{ background: providerGradient }}>
                <div className={styles.providerDonutCore}>
                  <span>{providerStatsReady ? totalProviderKeys : '-'}</span>
                  <small>KEYS</small>
                </div>
              </div>
              <div className={styles.providerLegend}>
                {providerSegments.map((segment) => {
                  const percent =
                    totalProviderKeys > 0 ? (segment.value / totalProviderKeys) * 100 : 0;
                  return (
                    <div key={segment.key} className={styles.providerLegendRow}>
                      <span className={styles.providerLegendName}>
                        <i style={{ backgroundColor: segment.color }} aria-hidden="true" />
                        {segment.label}
                      </span>
                      <span className={styles.providerLegendValue}>{segment.value}</span>
                      <span className={styles.providerLegendTrack}>
                        <span
                          style={{ width: `${percent}%`, backgroundColor: segment.color }}
                        />
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Link>

          <Link to="/usage" className={styles.instrumentCard}>
            <div className={styles.instrumentHeader}>
              <div>
                <span className={styles.instrumentEyebrow}>TOKEN FLOW</span>
                <h3 className={styles.instrumentTitle}>{t('dashboard.total_tokens')}</h3>
              </div>
              <span className={styles.metricChip}>
                {dashboardLoading ? 'SYNC' : usageEnabled ? '24H' : 'OFF'}
              </span>
            </div>
            <div className={styles.telemetryValueRow}>
              <span className={styles.telemetryValue}>{formatMetric(usageTelemetry.totalTokens)}</span>
              <span className={styles.telemetryUnit}>tokens / 1h</span>
            </div>
            <Sparkline values={tokenSeries} className={styles.tokenSparkline} />
            <div className={styles.metricStrip}>
              <span>TPM {usageEnabled ? formatMetric(usageTelemetry.tpm) : '-'}</span>
              <span>TPS {usageEnabled ? usageTelemetry.tps.toFixed(1) : '-'}</span>
              <span>Total {formatMetric(totalUsageTokens)}</span>
            </div>
          </Link>

          <Link to="/usage" className={styles.instrumentCard}>
            <div className={styles.instrumentHeader}>
              <div>
                <span className={styles.instrumentEyebrow}>CONCURRENCY / LATENCY</span>
                <h3 className={styles.instrumentTitle}>{t('dashboard.total_requests')}</h3>
              </div>
              <span className={styles.metricChip}>
                {usageTelemetry.avgLatency !== null
                  ? formatDurationMs(usageTelemetry.avgLatency)
                  : '-'}
              </span>
            </div>
            <div className={styles.dualChart}>
              <div className={styles.dualBars}>
                {usageTelemetry.buckets.map((bucket) => (
                  <span
                    key={bucket.label}
                    className={styles.dualBar}
                    style={{ height: `${Math.max(6, (bucket.requests / maxRequestBucket) * 100)}%` }}
                    title={`${bucket.label} · ${bucket.requests}`}
                  />
                ))}
              </div>
              <svg viewBox="0 0 220 72" preserveAspectRatio="none" aria-hidden="true">
                <polyline className={styles.latencyLineGlow} points={latencyPoints} />
                <polyline className={styles.latencyLine} points={latencyPoints} />
              </svg>
            </div>
            <div className={styles.metricStrip}>
              <span>REQ {formatMetric(usageTelemetry.requestCount)}</span>
              <span>MAX {formatMetric(maxRequestBucket)}</span>
              <span>LAT {formatDurationMs(maxLatencyBucket)}</span>
            </div>
          </Link>

          <div className={styles.instrumentCard}>
            <div className={styles.instrumentHeader}>
              <div>
                <span className={styles.instrumentEyebrow}>ASSET SIGNAL</span>
                <h3 className={styles.instrumentTitle}>{t('dashboard.management_keys')}</h3>
              </div>
              <span className={styles.metricChip}>{usageRefreshedLabel}</span>
            </div>
            <div className={styles.assetMatrix}>
              <Link to="/config" className={styles.assetNode}>
                <IconKey size={18} />
                <span>{stats.apiKeys ?? '-'}</span>
                <small>{t('dashboard.management_keys')}</small>
              </Link>
              <Link to="/auth-files" className={styles.assetNode}>
                <IconFileText size={18} />
                <span>{stats.authFiles ?? '-'}</span>
                <small>{t('dashboard.oauth_credentials')}</small>
              </Link>
              <Link to="/system" className={styles.assetNode}>
                <IconSatellite size={18} />
                <span>{modelsLoading ? '-' : models.length}</span>
                <small>{t('dashboard.available_models')}</small>
              </Link>
            </div>
            <Sparkline values={inventorySeries} className={styles.assetSparkline} />
          </div>
        </div>
      </section>

      <section className={styles.monitorSection}>
        <div className={styles.monitorPanel}>
          <div className={styles.instrumentHeader}>
            <div>
              <span className={styles.instrumentEyebrow}>MODEL DISTRIBUTION</span>
              <h3 className={styles.instrumentTitle}>
                {t('dashboard.model_distribution', { defaultValue: '模型热度分布' })}
              </h3>
            </div>
            <span className={styles.metricChip}>{formatMetric(totalUsageRequests)} REQ</span>
          </div>
          {modelDistribution.rows.length > 0 && modelDistribution.totalTokens > 0 ? (
            <>
              <div className={styles.modelStackBar}>
                {modelDistribution.rows.map((row, index) => {
                  const percent = (row.tokens / modelDistribution.totalTokens) * 100;
                  return (
                    <span
                      key={row.model}
                      className={styles[`modelTone${(index % 5) + 1}`]}
                      style={{ width: `${percent}%` }}
                      title={`${row.model} · ${percent.toFixed(1)}%`}
                    />
                  );
                })}
              </div>
              <div className={styles.modelRows}>
                {modelDistribution.rows.map((row, index) => {
                  const percent = (row.tokens / modelDistribution.totalTokens) * 100;
                  return (
                    <div key={row.model} className={styles.modelRow}>
                      <span className={`${styles.modelSwatch} ${styles[`modelTone${(index % 5) + 1}`]}`} />
                      <span className={styles.modelName}>{row.model}</span>
                      <span className={styles.modelPercent}>{percent.toFixed(1)}%</span>
                      <span className={styles.modelTokens}>{formatMetric(row.tokens)} tk</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className={styles.emptyTelemetry}>
              {dashboardError || t('dashboard.no_usage_data')}
            </div>
          )}
        </div>

        <div className={styles.monitorPanel}>
          <div className={styles.instrumentHeader}>
            <div>
              <span className={styles.instrumentEyebrow}>LIVE REQUEST STREAM</span>
              <h3 className={styles.instrumentTitle}>
                {t('dashboard.request_stream', { defaultValue: '实时审计流' })}
              </h3>
            </div>
            <span className={styles.metricChip}>
              {usageTelemetry.successRate !== null
                ? `${usageTelemetry.successRate.toFixed(1)}% OK`
                : 'IDLE'}
            </span>
          </div>
          <div className={styles.requestStream}>
            <div className={styles.requestStreamHeader}>
              <span>TIME</span>
              <span>MODEL</span>
              <span>STATUS</span>
              <span>LAT</span>
            </div>
            <div className={styles.requestStreamBody}>
              {latestRequests.length > 0 ? (
                latestRequests.map((detail) => {
                  const timestamp = detail.timestamp || new Date().toISOString();
                  const latencyMs = detail.duration_ms ?? 0;
                  const statusCode = detail.status_code ?? (detail.failed ? 0 : 200);
                  return (
                    <div
                      key={`${detail.event_id}-${timestamp}-${detail.model}`}
                      className={styles.requestStreamRow}
                    >
                      <span>
                        {new Date(timestamp).toLocaleTimeString(i18n.language, {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      <span className={styles.requestModel}>{detail.model || '-'}</span>
                      <span
                        className={
                          detail.failed || statusCode >= 400
                            ? styles.statusFail
                            : styles.statusOk
                        }
                      >
                        {detail.failed ? 'ERR' : statusCode > 0 ? statusCode : '200'}
                      </span>
                      <span>
                        {latencyMs > 0 ? formatDurationMs(latencyMs) : '-'}
                      </span>
                    </div>
                  );
                })
              ) : (
                <div className={styles.emptyTelemetry}>{t('dashboard.no_usage_data')}</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {config && (
        <section className={styles.configSection}>
          <h2 className={styles.sectionHeading}>{t('dashboard.current_config')}</h2>
          <div className={styles.configConsole}>
            <div className={styles.routingPanel}>
              <div className={styles.instrumentHeader}>
                <div>
                  <span className={styles.instrumentEyebrow}>ROUTING TOPOLOGY</span>
                  <h3 className={styles.instrumentTitle}>{t('dashboard.routing_strategy')}</h3>
                </div>
                <span className={`${styles.configBadge} ${routingStrategyBadgeClass}`}>
                  {routingStrategyDisplay}
                </span>
              </div>
              <div className={styles.routingFlow}>
                <span className={styles.routingNode}>CLIENT</span>
                <span className={styles.routingLine} />
                <span className={styles.routingNodePrimary}>{routingStrategyRaw || 'AUTO'}</span>
                <span className={styles.routingLine} />
                <div className={styles.routingProviderNodes}>
                  {providerSegments.map((segment) => (
                    <span key={segment.key} style={{ borderColor: segment.color }}>
                      {segment.shortLabel}
                    </span>
                  ))}
                </div>
              </div>
              <div className={styles.routingWeightBar}>
                {providerSegments.map((segment) => {
                  const percent = totalProviderKeys > 0 ? (segment.value / totalProviderKeys) * 100 : 0;
                  return (
                    <span
                      key={segment.key}
                      style={{ width: `${percent}%`, backgroundColor: segment.color }}
                    />
                  );
                })}
              </div>
              {config.proxyUrl && (
                <div className={styles.proxyRoute}>
                  <span>{t('basic_settings.proxy_url_label')}</span>
                  <strong>{config.proxyUrl}</strong>
                </div>
              )}
            </div>

            <div className={styles.controlPanel}>
              {[
                { label: t('basic_settings.debug_enable'), value: Boolean(config.debug) },
                {
                  label: t('basic_settings.usage_statistics_enable'),
                  value: Boolean(config.usageStatisticsEnabled),
                },
                { label: t('basic_settings.logging_to_file_enable'), value: Boolean(config.loggingToFile) },
                { label: t('basic_settings.ws_auth_enable'), value: Boolean(config.wsAuth) },
              ].map((item) => (
                <div key={item.label} className={styles.cyberSwitchRow}>
                  <span>{item.label}</span>
                  <span
                    className={`${styles.cyberSwitch} ${item.value ? styles.cyberSwitchOn : ''}`}
                    role="switch"
                    aria-checked={item.value}
                  >
                    <i />
                  </span>
                </div>
              ))}
              <div className={styles.retryModule}>
                <span>{t('basic_settings.retry_count_label')}</span>
                <strong>{config.requestRetry ?? 0}</strong>
              </div>
            </div>
          </div>
          <Link to="/config" className={styles.viewMoreLink}>
            {t('dashboard.edit_settings')} →
          </Link>
        </section>
      )}
    </div>
  );
}