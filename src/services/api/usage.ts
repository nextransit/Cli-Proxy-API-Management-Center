/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats } from '@/utils/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;

export interface UsageExportPayload {
  version?: number;
  exported_at?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UsageImportResponse {
  added?: number;
  skipped?: number;
  total_requests?: number;
  failed_requests?: number;
  [key: string]: unknown;
}

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: (options?: { timeRange?: string; signal?: AbortSignal }) =>
    apiClient.get<Record<string, unknown>>('/usage', {
      timeout: USAGE_TIMEOUT_MS,
      signal: options?.signal,
      params: options?.timeRange && options.timeRange !== 'all'
        ? { time_range: options.timeRange }
        : undefined,
    }),

  /**
   * 导出使用统计快照
   */
  exportUsage: () => apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导入使用统计快照
   */
  importUsage: (payload: unknown) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 计算密钥成功/失败统计。调用方必须传入 usage 快照；没有时使用
   * useUsageStatsStore 中已有的快照，绝不自动拉取 /usage，避免在
   * UI 任意点击路径上触发重型全量负载。
   */
  getKeyStats(usageData: unknown): KeyStats {
    return computeKeyStats(usageData);
  }
};

export interface DashboardFlowBucket {
  index: number;
  start_ms: number;
  end_ms: number;
  label: string;
  requests: number;
  tokens: number;
  failures: number;
  avg_latency_ms: number;
}

export interface DashboardModelRow {
  model: string;
  requests: number;
  tokens: number;
  share_percent: number;
  avg_latency_ms: number;
  success_rate: number;
}

export interface DashboardLatestRequest {
  event_id: number;
  timestamp: string;
  model: string;
  api_key: string;
  failed: boolean;
  status_code: number;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface DashboardView {
  total_requests: number;
  success_count: number;
  failure_count: number;
  total_tokens: number;
  failure_rate: number;
  latest_event_id: number;
  generated_at: string;
  bucket_count: number;
  bucket_size_ms: number;
  bucket_start_ms: number;
  flow_buckets: DashboardFlowBucket[];
  model_top: DashboardModelRow[];
  latest_requests: DashboardLatestRequest[];
  window_start: string | null;
  window_end: string | null;
  window_hours: number;
  window_seconds: number;
  window_tokens: number;
  window_requests: number;
  window_failures: number;
  window_successes: number;
}

export interface DashboardViewResponse {
  dashboard: DashboardView;
  generated_at: string;
}

/**
 * Lightweight dashboard-shaped view of usage stats. The management home page
 * uses this endpoint instead of the full /usage payload to keep the click and
 * refresh path cheap on busy servers.
 */
export const dashboardApi = {
  getDashboardView: (options?: { window?: string; signal?: AbortSignal }) =>
    apiClient.get<DashboardViewResponse>('/usage/dashboard', {
      timeout: 15_000,
      signal: options?.signal,
      params: options?.window ? { window: options.window } : undefined,
    }),
};
