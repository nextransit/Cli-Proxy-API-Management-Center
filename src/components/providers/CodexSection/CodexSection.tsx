import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconCheck, IconChevronDown, IconChevronUp, IconX } from '@/components/ui/icons';
import iconCodex from '@/assets/icons/codex.svg';
import type { ProviderKeyConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import { type KeyStats } from '@/utils/usage';
import styles from '@/pages/AiProvidersPage.module.scss';
import {
  getStatsForIdentity,
  hasDisableAllModelsRule,
} from '../utils';

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
        style={actionsDisabled ? { opacity: 0.6 } : undefined}
      >
        <span className={styles.apiKeyEntryIndex}>{index + 1}</span>
        <span className={styles.apiKeyEntryKey}>{maskApiKey(config.apiKey)}</span>
        {config.proxyUrl && (
          <span className={styles.apiKeyEntryProxy}>{config.proxyUrl}</span>
        )}
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
    const configDisabled = hasDisableAllModelsRule(firstConfig.excludedModels);
    const excludedModels = firstConfig.excludedModels ?? [];
    const isGroupDisabled = configDisabled;

    return (
      <div
        key={`codex-group-${group.baseUrl || 'default'}`}
        className={styles.codexProviderCard}
        style={actionsDisabled ? { opacity: 0.6 } : undefined}
      >
        <div className={styles.codexProviderMeta}>
          <div className={styles.codexProviderTitle}>
            {group.baseUrl || t('ai_providers.codex_default_base')}
          </div>
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
              <span className={styles.fieldLabel}>{t('ai_providers.codex_websockets_label')}:</span>
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
        </div>

        <div className={styles.codexKeysSection}>
          <div className={styles.codexKeysLabel}>
            {t('ai_providers.codex_keys_count')}: {group.items.length}
          </div>
          <div className={styles.codexKeyList}>
            {group.items.map(({ config, index }) => renderProviderCard({ config, index }))}
          </div>
        </div>

        {firstConfig.models?.length ? (
          <div className={styles.modelTagList}>
            <span className={styles.modelCountLabel}>
              {t('ai_providers.codex_models_count')}: {firstConfig.models.length}
            </span>
            {firstConfig.models.map((model) => (
              <span key={model.name} className={styles.modelTag}>
                <span className={styles.modelName}>{model.name}</span>
                {model.alias && model.alias !== model.name && (
                  <span className={styles.modelAlias}>{model.alias}</span>
                )}
              </span>
            ))}
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
        {!collapsed && (configs.length === 0 ? (
          <div className="hint">{t('ai_providers.codex_empty_title')}</div>
        ) : (
          <div className={styles.codexProviderList}>
            {groupedConfigs.map(renderGroupedCard)}
          </div>
        ))}
      </Card>
    </>
  );
}
