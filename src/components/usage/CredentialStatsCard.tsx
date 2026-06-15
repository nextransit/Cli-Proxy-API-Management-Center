import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import type { APIKeyEntry } from '@/services/api';
import { maskApiKey } from '@/utils/format';
import {
  calculateCost,
  collectUsageDetails,
  extractTotalTokens,
  formatCompactNumber,
  formatUsd,
  type ModelPrice,
} from '@/utils/usage';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

export interface CredentialStatsCardProps {
  usage: UsagePayload | null;
  loading: boolean;
  apiKeyEntries: APIKeyEntry[];
  modelPrices?: Record<string, ModelPrice>;
}

interface CredentialRow {
  key: string;
  displayName: string;
  maskedKey: string;
  description?: string;
  type: string;
  success: number;
  failure: number;
  total: number;
  successRate: number;
  tokens: number;
  cost: number;
}

const UNKNOWN_API_KEY = '__unknown_api_key__';

const getCredentialHealthClassName = (successRate: number, total: number): string => {
  if (total <= 0) return '';
  if (successRate < 70) return styles.credentialRowCritical;
  if (successRate < 80) return styles.credentialRowWarning;
  return '';
};

const formatMaskedKey = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === UNKNOWN_API_KEY) return '-';
  return maskApiKey(trimmed) || trimmed;
};

const buildEntryType = (entry: APIKeyEntry | undefined, t: ReturnType<typeof useTranslation>['t']) => {
  if (!entry) return t('usage_stats.credential_type_unknown');
  if (entry.super) return t('system_info.api_key_policy_super_badge');
  if (entry.models?.length) return t('system_info.api_key_policy_limited_badge');
  return t('system_info.api_key_policy_models_all');
};

export function CredentialStatsCard({
  usage,
  loading,
  apiKeyEntries,
  modelPrices = {},
}: CredentialStatsCardProps) {
  const { t } = useTranslation();

  const configuredKeyMap = useMemo(() => {
    const map = new Map<string, APIKeyEntry>();
    apiKeyEntries.forEach((entry) => {
      const key = String(entry.key ?? '').trim();
      if (!key || map.has(key)) return;
      map.set(key, entry);
    });
    return map;
  }, [apiKeyEntries]);

  const rows = useMemo((): CredentialRow[] => {
    const rowMap = new Map<string, CredentialRow>();

    const ensureRow = (key: string, entry?: APIKeyEntry): CredentialRow => {
      const resolvedKey = key.trim() || UNKNOWN_API_KEY;
      const existing = rowMap.get(resolvedKey);
      if (existing) return existing;

      const name = String(entry?.name ?? '').trim();
      const description = String(entry?.description ?? '').trim();
      const maskedKey = formatMaskedKey(resolvedKey);
      const row: CredentialRow = {
        key: resolvedKey,
        displayName:
          name ||
          description ||
          (resolvedKey === UNKNOWN_API_KEY ? t('usage_stats.credential_unknown_key') : maskedKey),
        maskedKey,
        description: name && description ? description : undefined,
        type: buildEntryType(entry, t),
        success: 0,
        failure: 0,
        total: 0,
        successRate: 100,
        tokens: 0,
        cost: 0,
      };
      rowMap.set(resolvedKey, row);
      return row;
    };

    configuredKeyMap.forEach((entry, key) => {
      ensureRow(key, entry);
    });

    collectUsageDetails(usage).forEach((detail) => {
      const apiKey = String(detail.__apiKey ?? '').trim() || UNKNOWN_API_KEY;
      const row = ensureRow(apiKey, configuredKeyMap.get(apiKey));

      if (detail.failed === true) {
        row.failure += 1;
      } else {
        row.success += 1;
      }

      row.total = row.success + row.failure;
      row.successRate = row.total > 0 ? (row.success / row.total) * 100 : 100;
      row.tokens += extractTotalTokens(detail);
      row.cost += calculateCost(detail, modelPrices);
    });

    return Array.from(rowMap.values()).sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [configuredKeyMap, modelPrices, t, usage]);

  const hasPrices = Object.keys(modelPrices).length > 0;

  return (
    <Card title={t('usage_stats.credential_stats')} className={styles.detailsFixedCard}>
      {loading ? (
        <div className={styles.hintLoading}></div>
      ) : rows.length > 0 ? (
        <div className={styles.detailsScroll}>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t('usage_stats.credential_name')}</th>
                  <th>{t('usage_stats.credential_type')}</th>
                  <th>{t('usage_stats.requests_count')}</th>
                  <th>{t('usage_stats.tokens_count')}</th>
                  <th>{t('usage_stats.success_rate')}</th>
                  {hasPrices && <th>{t('usage_stats.total_cost')}</th>}
                  <th>{t('usage_stats.credential_status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    className={getCredentialHealthClassName(row.successRate, row.total)}
                  >
                    <td className={styles.modelCell}>
                      <span title={row.description || row.displayName}>{row.displayName}</span>
                      <span className={styles.credentialType}>{row.maskedKey}</span>
                      {row.description && (
                        <span className={styles.credentialDescription}>{row.description}</span>
                      )}
                    </td>
                    <td>{row.type || '-'}</td>
                    <td>
                      <span className={styles.requestCountCell}>
                        <span>{formatCompactNumber(row.total)}</span>
                        <span className={styles.requestBreakdown}>
                          (
                          <span className={styles.statSuccess}>
                            {row.success.toLocaleString()}
                          </span>{' '}
                          <span className={styles.statFailure}>
                            {row.failure.toLocaleString()}
                          </span>
                          )
                        </span>
                      </span>
                    </td>
                    <td className={styles.tokenHighlight}>{formatCompactNumber(row.tokens)}</td>
                    <td>
                      <span
                        className={
                          row.successRate >= 95
                            ? styles.statSuccess
                            : row.successRate >= 80
                              ? styles.statNeutral
                              : styles.statFailure
                        }
                      >
                        {row.total > 0 ? `${row.successRate.toFixed(1)}%` : '-'}
                      </span>
                    </td>
                    {hasPrices && <td className={styles.costHighlight}>{formatUsd(row.cost)}</td>}
                    <td>
                      <span
                        className={
                          row.total <= 0
                            ? styles.credentialStatusInactive
                            : row.successRate >= 95
                              ? styles.credentialStatusActive
                              : row.successRate >= 70
                                ? styles.credentialStatusWarning
                                : styles.credentialStatusCritical
                        }
                      >
                        {row.total <= 0
                          ? t('usage_stats.credential_status_idle')
                          : row.successRate >= 95
                            ? t('usage_stats.credential_status_active')
                            : row.successRate >= 70
                              ? t('usage_stats.credential_status_warning')
                              : t('usage_stats.credential_status_critical')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
