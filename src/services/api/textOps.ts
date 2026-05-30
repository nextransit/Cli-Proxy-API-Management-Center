import { apiClient } from './client';

export type TextOpsIntent = 'TOKEN_CONSUMPTION' | 'CACHE_METRICS' | 'FINANCIAL_STATUS';

export type TextOpsRole = 'admin' | 'reseller' | 'customer';

export interface TextOpsLLMConfig {
  enabled: boolean;
  api_key?: string;
  base_url?: string;
  model?: string;
  max_tokens?: number;
}

export interface TextOpsOperatorContext {
  user_id: number;
  role: TextOpsRole;
  allowed_user_ids?: number[];
}

export interface TextOpsQueryRequest {
  user_query: string;
  current_time?: string;
  operator_context?: TextOpsOperatorContext;
  router?: TextOpsLLMConfig;
  presenter?: TextOpsLLMConfig;
}

export interface TextOpsDisplayBlock {
  type: string;
  title?: string;
  data: unknown;
}

export interface TextOpsQueryResponse {
  generated_at: string;
  user_query: string;
  current_time: string;
  router: {
    intent: TextOpsIntent;
    filters: Record<string, unknown>;
    group_by: string[];
    route: string;
  };
  guardrail: {
    blocked: boolean;
    reason?: string;
    prompt_injection?: boolean;
    rewritten?: boolean;
    applied_role?: string;
    effective_filters?: Record<string, unknown>;
    rewrite_operations?: string[];
  };
  data: {
    intent: TextOpsIntent;
    summary: Record<string, unknown>;
    rows: Array<Record<string, unknown>>;
    raw?: Record<string, unknown>;
  };
  presentation: {
    markdown: string;
    blocks: TextOpsDisplayBlock[];
  };
  warnings?: string[];
}

const TEXT_OPS_TIMEOUT_MS = 120_000;

export const textOpsApi = {
  query: (payload: TextOpsQueryRequest) =>
    apiClient.post<TextOpsQueryResponse>('/text-ops/query', payload, { timeout: TEXT_OPS_TIMEOUT_MS }),
};

