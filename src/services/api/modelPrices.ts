/**
 * 模型价格相关 API
 */

import { apiClient } from './client';
import type { ModelPrice } from '@/utils/usage';

export interface ModelPricesResponse {
  version: number;
  prices: Record<string, ModelPrice>;
}

export const modelPricesApi = {
  /**
   * 获取模型价格
   */
  getModelPrices: () => apiClient.get<ModelPricesResponse>('/model-prices'),

  /**
   * 完整替换模型价格
   */
  putModelPrices: (prices: Record<string, ModelPrice>) =>
    apiClient.put<ModelPricesResponse>('/model-prices', { version: 1, prices }),

  /**
   * 部分更新模型价格
   */
  patchModelPrices: (prices: Record<string, ModelPrice>) =>
    apiClient.patch<ModelPricesResponse>('/model-prices', { version: 1, prices }),
};
