import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconKey,
  IconModelCluster,
  IconX,
} from '@/components/ui/icons';
import iconCodex from '@/assets/icons/codex.svg';
import type { ProviderKeyConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import { type KeyStatBucket, type KeyStats } from '@/utils/usage';
import styles from '@/pages/AiProvidersPage.module.scss';
import { getStatsForIdentity, hasDisableAllModelsRule } from '../utils';

interface CodexSectionProps {
  configs: ProviderKeyConfig[];
  keyStats: KeyStats;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
}

interface GroupedConfigs {
  baseUrl: string;
  items: Array<{ config: ProviderKeyConfig; index: number }>;
}

const getStatsTotal = (stats: KeyStatBucket) => stats.success + stats.failure;

const getSuccessRate = (stats: KeyStatBucket) => {
  const total = getStatsTotal(stats);
  if (total === 0) {
    return null;
  }
  return (stats.success / total) * 100;
};

const formatSuccessRate = (rate: number | null) => {
  if (rate === null) {
    return '--';
  }

  const rounded = rate.toFixed(1);
  return `${rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded}%`;
};

const getHealthClassName = (rate: number | null) => {
  if (rate === null) {
    return styles.providerHealthIdle;
  }
  if (rate >= 95) {
    return styles.providerHealthGood;
  }
  if (rate >= 80) {
    return styles.providerHealthWarn;
  }
  return styles.providerHealthBad;
};

const isProblemGroup = (disabled: boolean, stats: KeyStatBucket) => {
  if (disabled) {
    return true;
  }

  const total = getStatsTotal(stats);
  if (total === 0) {
    return false;
  }

  const failureRate = stats.failure / total;
  return failureRate >= 0.2 || stats.failure > stats.success;
};

export function CodexSection({
  configs,
  keyStats,
  loading,
  disableControls,
  isSwitching,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: CodexSectionProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const [expandedGroupKeys, setExpandedGroupKeys] = useState<Set<string>>(new Set());
  const actionsDisabled = disableControls || loading || isSwitching;
  const toggleDisabled = disableControls || loading || isSwitching;

  // Group configs by baseUrl
  const groupedConfigs = useMemo<GroupedConfigs[]>(() => {
    const groups = new Map<string, Array<{ config: ProviderKeyConfig; index: number }>>();

    configs.forEach((config, index) => {
      const baseUrl = config.baseUrl || '';
      if (!groups.has(baseUrl)) {
        groups.set(baseUrl, []);
      }
      groups.get(baseUrl)!.push({ config, index });
    });

    return Array.from(groups.entries()).map(([baseUrl, items]) => ({
      baseUrl,
      items,
    }));
  }, [configs]);

  const toggleGroupExpanded = (groupKey: string) => {
    setExpandedGroupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  };

  const getGroupStats = (group: GroupedConfigs): KeyStatBucket =>
    group.items.reduce(
      (acc, { config }) => {
        const stats = getStatsForIdentity(
          { authIndex: config.authIndex, apiKey: config.apiKey, prefix: config.prefix },
          keyStats
        );
        return {
          success: acc.success + stats.success,
          failure: acc.failure + stats.failure,
        };
      },
      { success: 0, failure: 0 }
    );

  const renderProviderCard = ({ config, index }: { config: ProviderKeyConfig; index: number }) => {
    const stats = getStatsForIdentity(
      { authIndex: config.authIndex, apiKey: config.apiKey, prefix: config.prefix },
      keyStats
    );
    const configDisabled = hasDisableAllModelsRule(config.excludedModels);

    return (
      <div
        key={`codex-entry-${index}`}
        className={styles.codexKeyEntryCard}
        style={actionsDisabled || configDisabled ? { opacity: 0.6 } : undefined}
      >
        <span className={styles.apiKeyEntryIndex}>{index + 1}</span>
        <span className={styles.apiKeyEntryKey}>{maskApiKey(config.apiKey)}</span>
        {config.proxyUrl && <span className={styles.apiKeyEntryProxy}>{config.proxyUrl}</span>}
        <div className={styles.apiKeyEntryStats}>
          <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}>
            <IconCheck size={12} /> {stats.success}
          </span>
          <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}>
            <IconX size={12} /> {stats.failure}
          </span>
        </div>
        <div className={styles.codexEntryActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onEdit(index)}
            disabled={actionsDisabled}
          >
            {t('common.edit')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => onDelete(index)}
            disabled={actionsDisabled}
          >
            {t('common.delete')}
          </Button>
          <ToggleSwitch
            label={t('ai_providers.config_toggle_label')}
            checked={!configDisabled}
            disabled={toggleDisabled}
            onChange={(value) => void onToggle(index, value)}
          />
        </div>
      </div>
    );
  };

  const renderGroupedCard = (group: GroupedConfigs) => {
    const firstConfig = group.items[0]?.config;
    if (!firstConfig) return null;

    const headerEntries = Object.entries(firstConfig.headers || {});
    const excludedModels = firstConfig.excludedModels ?? [];
    const isGroupDisabled = group.items.every(({ config }) =>
      hasDisableAllModelsRule(config.excludedModels)
    );
    const groupStats = getGroupStats(group);
    const totalRequests = getStatsTotal(groupStats);
    const successRate = getSuccessRate(groupStats);
    const problem = isProblemGroup(isGroupDisabled, groupStats);
    const healthClassName = getHealthClassName(successRate);
    const groupKey = group.baseUrl || 'default';
    const expanded = expandedGroupKeys.has(groupKey);
    const models = firstConfig.models ?? [];
    const groupTitle = group.baseUrl || t('ai_providers.codex_default_base');

    return (
      <div
        key={`codex-group-${group.baseUrl || 'default'}`}
        className={[
          styles.openaiProviderCard,
          isGroupDisabled ? styles.openaiProviderCardDisabled : '',
          problem && !isGroupDisabled ? styles.openaiProviderCardProblem : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={actionsDisabled ? { opacity: 0.6 } : undefined}
      >
        <div className={styles.openaiProviderMeta}>
          <div
            className={styles.openaiProviderTopLine}
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            onClick={() => toggleGroupExpanded(groupKey)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') {
                return;
              }
              event.preventDefault();
              toggleGroupExpanded(groupKey);
            }}
          >
            <div className={styles.openaiProviderTitleBlock}>
              <div className={styles.openaiProviderTitle}>{groupTitle}</div>
              <span
                className={
                  isGroupDisabled ? styles.providerStatusDisabled : styles.providerStatusEnabled
                }
              >
                {isGroupDisabled
                  ? t('ai_providers.status_filter_disabled')
                  : t('ai_providers.status_filter_enabled')}
              </span>
            </div>
            <div className={styles.providerHealthSummary}>
              <span className={`${styles.providerHealthRate} ${healthClassName}`}>
                {formatSuccessRate(successRate)}
              </span>
              <span className={styles.providerHealthCounts}>
                {groupStats.success}/{groupStats.failure}
              </span>
            </div>
          </div>
          <div className={styles.providerSummaryGrid}>
            <div className={styles.providerSummaryItem}>
              <span>{t('common.base_url')}</span>
              <strong title={groupTitle}>{groupTitle}</strong>
            </div>
            <div className={styles.providerSummaryItem}>
              <span>{t('ai_providers.codex_keys_count')}</span>
              <strong>{group.items.length}</strong>
            </div>
            <div className={styles.providerSummaryItem}>
              <span>{t('ai_providers.codex_models_count')}</span>
              <strong>{models.length}</strong>
            </div>
            <div className={styles.providerSummaryItem}>
              <span>{t('ai_providers.openai_requests_count')}</span>
              <strong>{totalRequests}</strong>
            </div>
          </div>
          {(firstConfig.priority !== undefined ||
            firstConfig.prefix ||
            firstConfig.websockets !== undefined) && (
            <div className={styles.providerCompactMeta}>
              {firstConfig.priority !== undefined && (
                <span>
                  {t('common.priority')}: <strong>{firstConfig.priority}</strong>
                </span>
              )}
              {firstConfig.prefix && (
                <span>
                  {t('common.prefix')}: <strong>{firstConfig.prefix}</strong>
                </span>
              )}
              {firstConfig.websockets !== undefined && (
                <span>
                  {t('ai_providers.codex_websockets_label')}:{' '}
                  <strong>{firstConfig.websockets ? t('common.yes') : t('common.no')}</strong>
                </span>
              )}
            </div>
          )}
          {expanded && (
            <div className={styles.providerDetails}>
              {firstConfig.priority !== undefined && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{t('common.priority')}:</span>
                  <span className={styles.fieldValue}>{firstConfig.priority}</span>
                </div>
              )}
              {firstConfig.prefix && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{t('common.prefix')}:</span>
                  <span className={styles.fieldValue}>{firstConfig.prefix}</span>
                </div>
              )}
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                <span className={styles.fieldValue}>{group.baseUrl || '-'}</span>
              </div>
              {firstConfig.proxyUrl && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{t('common.proxy_url')}:</span>
                  <span className={styles.fieldValue}>{firstConfig.proxyUrl}</span>
                </div>
              )}
              {firstConfig.websockets !== undefined && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>
                    {t('ai_providers.codex_websockets_label')}:
                  </span>
                  <span className={styles.fieldValue}>
                    {firstConfig.websockets ? t('common.yes') : t('common.no')}
                  </span>
                </div>
              )}
              {isGroupDisabled && (
                <div className="status-badge warning" style={{ marginTop: 8, marginBottom: 0 }}>
                  {t('ai_providers.config_disabled_badge')}
                </div>
              )}
              {headerEntries.length > 0 && (
                <div className={styles.headerBadgeList}>
                  {headerEntries.map(([key, value]) => (
                    <span key={key} className={styles.headerBadge}>
                      <strong>{key}:</strong> {value}
                    </span>
                  ))}
                </div>
              )}
              <div className={styles.apiKeyEntriesSection}>
                <div className={styles.providerDetailHeader}>
                  <span>
                    <IconKey size={14} /> {t('ai_providers.codex_keys_count')}: {group.items.length}
                  </span>
                </div>
                <div className={styles.apiKeyEntryList}>
                  {group.items.map(({ config, index }) => renderProviderCard({ config, index }))}
                </div>
              </div>
              {models.length ? (
                <div className={styles.providerModelsSection}>
                  <div className={styles.providerDetailHeader}>
                    <span>
                      <IconModelCluster size={14} /> {t('ai_providers.codex_models_count')}:{' '}
                      {models.length}
                    </span>
                  </div>
                  <div className={styles.modelTagList}>
                    {models.map((model) => (
                      <span key={model.name} className={styles.modelTag}>
                        <span className={styles.modelName}>{model.name}</span>
                        {model.alias && model.alias !== model.name && (
                          <span className={styles.modelAlias}>{model.alias}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {excludedModels.length ? (
                <div className={styles.excludedModelsSection}>
                  <div className={styles.excludedModelsLabel}>
                    {t('ai_providers.excluded_models_count', { count: excludedModels.length })}
                  </div>
                  <div className={styles.modelTagList}>
                    {excludedModels.map((model) => (
                      <span key={model} className={`${styles.modelTag} ${styles.excludedModelTag}`}>
                        <span className={styles.modelName}>{model}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
          <div className={styles.cardStats}>
            <span className={`${styles.statPill} ${styles.statSuccess}`}>
              {t('stats.success')}: {groupStats.success}
            </span>
            <span className={`${styles.statPill} ${styles.statFailure}`}>
              {t('stats.failure')}: {groupStats.failure}
            </span>
          </div>
        </div>

        <div className={styles.openaiProviderActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => toggleGroupExpanded(groupKey)}
            disabled={actionsDisabled}
            aria-expanded={expanded}
          >
            <span className={styles.collapseToggleIcon} aria-hidden="true">
              {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            </span>
            {expanded ? t('ai_providers.hide_details') : t('ai_providers.show_details')}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <>
      <Card
        title={
          <span className={styles.cardTitle}>
            <img src={iconCodex} alt="" className={styles.cardTitleIcon} />
            {t('ai_providers.codex_title')}
          </span>
        }
        onHeaderClick={() => setCollapsed((prev) => !prev)}
        headerExpanded={!collapsed}
        headerAriaLabel={collapsed ? t('ai_providers.expand') : t('ai_providers.collapse')}
        extra={
          <div className={styles.cardExtraActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCollapsed((prev) => !prev)}
              className={styles.collapseToggleButton}
              aria-expanded={!collapsed}
              data-card-header-ignore-click="true"
            >
              <span className={styles.collapseToggleIcon} aria-hidden="true">
                {collapsed ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
              </span>
              {collapsed ? t('ai_providers.expand') : t('ai_providers.collapse')}
            </Button>
            <Button size="sm" onClick={onAdd} disabled={actionsDisabled}>
              {t('ai_providers.codex_add_button')}
            </Button>
          </div>
        }
      >
        {!collapsed &&
          (configs.length === 0 ? (
            <div className="hint">{t('ai_providers.codex_empty_title')}</div>
          ) : (
            <div className={styles.codexProviderList}>{groupedConfigs.map(renderGroupedCard)}</div>
          ))}
      </Card>
    </>
  );
}
