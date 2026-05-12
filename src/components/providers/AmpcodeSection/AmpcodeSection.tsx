import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { IconChevronDown, IconChevronUp } from '@/components/ui/icons';
import iconAmp from '@/assets/icons/amp.svg';
import type { AmpcodeConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import styles from '@/pages/AiProvidersPage.module.scss';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface AmpcodeSectionProps {
  config: AmpcodeConfig | null | undefined;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  onEdit: () => void;
}

export function AmpcodeSection({
  config,
  loading,
  disableControls,
  isSwitching,
  onEdit,
}: AmpcodeSectionProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);
  const showLoadingPlaceholder = loading && !config;

  return (
    <>
      <Card
        title={
          <span className={styles.cardTitle}>
            <img src={iconAmp} alt="" className={styles.cardTitleIcon} />
            {t('ai_providers.ampcode_title')}
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
            <Button
              size="sm"
              onClick={onEdit}
              disabled={disableControls || loading || isSwitching}
            >
              {t('common.edit')}
            </Button>
          </div>
        }
      >
        {!collapsed &&
          (showLoadingPlaceholder ? (
            <div className="hint">{t('common.loading')}</div>
          ) : (
            <>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>{t('ai_providers.ampcode_upstream_url_label')}:</span>
                <span className={styles.fieldValue}>{config?.upstreamUrl || t('common.not_set')}</span>
              </div>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>
                  {t('ai_providers.ampcode_upstream_api_key_label')}:
                </span>
                <span className={styles.fieldValue}>
                  {config?.upstreamApiKey ? maskApiKey(config.upstreamApiKey) : t('common.not_set')}
                </span>
              </div>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>
                  {t('ai_providers.ampcode_force_model_mappings_label')}:
                </span>
                <span className={styles.fieldValue}>
                  {(config?.forceModelMappings ?? false) ? t('common.yes') : t('common.no')}
                </span>
              </div>
              <div className={styles.fieldRow} style={{ marginTop: 8 }}>
                <span className={styles.fieldLabel}>{t('ai_providers.ampcode_model_mappings_count')}:</span>
                <span className={styles.fieldValue}>{config?.modelMappings?.length || 0}</span>
              </div>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>{t('ai_providers.ampcode_upstream_api_keys_count')}:</span>
                <span className={styles.fieldValue}>{config?.upstreamApiKeys?.length || 0}</span>
              </div>
              {config?.modelMappings?.length ? (
                <div className={styles.modelTagList}>
                  {config.modelMappings.slice(0, 5).map((mapping) => (
                    <span key={`${mapping.from}→${mapping.to}`} className={styles.modelTag}>
                      <span className={styles.modelName}>{mapping.from}</span>
                      <span className={styles.modelAlias}>{mapping.to}</span>
                    </span>
                  ))}
                  {config.modelMappings.length > 5 && (
                    <span className={styles.modelTag}>
                      <span className={styles.modelName}>+{config.modelMappings.length - 5}</span>
                    </span>
                  )}
                </div>
              ) : null}
            </>
          ))}
      </Card>
    </>
  );
}
