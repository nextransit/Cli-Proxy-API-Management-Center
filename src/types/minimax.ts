/**
 * MiniMax quota types
 */

export interface MiniMaxModelRemain {
  start_time?: number;
  end_time?: number;
  remains_time?: number;
  current_interval_total_count?: number;
  current_interval_usage_count?: number;
  model_name?: string;
  current_weekly_total_count?: number;
  current_weekly_usage_count?: number;
  weekly_remains_time?: number;
}

export interface MiniMaxUsageResponse {
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
  status_code?: number;
  status_msg?: string;
  model_remains?: MiniMaxModelRemain[];
}

export interface MiniMaxQuotaRow {
  modelName: string;
  weeklyTotal: number;
  weeklyUsed: number;
  weeklyPercent: number;
  weeklyResetMs: number;
  intervalTotal?: number;
  intervalUsed?: number;
}

export interface MiniMaxQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
  errorStatus?: number;
  rows?: MiniMaxQuotaRow[];
}
