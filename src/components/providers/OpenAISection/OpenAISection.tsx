import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconKey,
  IconModelCluster,
  IconSlidersHorizontal,
  IconX,
} from '@/components/ui/icons';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import type { OpenAIProviderConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import { calculateStatusBarData, type KeyStatBucket, type KeyStats } from '@/utils/usage';
import { type UsageDetailsByAuthIndex, type UsageDetailsBySource } from '@/utils/usageIndex';
import styles from '@/pages/AiProvidersPage.module.scss';
import { ProviderStatusBar } from '../ProviderStatusBar';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import {
  collectOpenAIProviderUsageDetails,
  getOpenAIProviderKey,
  getOpenAIProviderStats,
  getStatsForIdentity,
} from '../utils';

type SortOption = 'name' | 'priority' | 'recent-success';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'enabled' | 'disabled' | 'problem' | 'all';

interface FloatingToolbarStyle {
  left: number;
  top: number;
  width: number;
  visible: boolean;
}

const EMPTY_STATUS_BAR = calculateStatusBarData([]);
const DEFAULT_STATUS_FILTER: StatusFilter = 'enabled';

interface OpenAISectionProps {
  configs: OpenAIProviderConfig[];
  keyStats: KeyStats;
  usageDetailsBySource: UsageDetailsBySource;
  usageDetailsByAuthIndex: UsageDetailsByAuthIndex;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  resolvedTheme: string;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
}

interface IndexedOpenAIProvider {
  config: OpenAIProviderConfig;
  originalIndex: number;
}

const getApiKeyEntryRenderKey = (
  entry: NonNullable<OpenAIProviderConfig['apiKeyEntries']>[number],
  entryIndex: number
) => {
  const authIndex = entry.authIndex == null ? '' : String(entry.authIndex).trim();
  return authIndex ? `auth-index-${authIndex}` : `api-key-entry-${entryIndex}`;
};

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

const isProblemProvider = (provider: OpenAIProviderConfig, stats: KeyStatBucket) => {
  if (provider.disabled === true) {
    return true;
  }

  const total = getStatsTotal(stats);
  if (total === 0) {
    return false;
  }

  const failureRate = stats.failure / total;
  return failureRate >= 0.2 || stats.failure > stats.success;
};

export function OpenAISection({
  configs,
  keyStats,
  usageDetailsBySource,
  usageDetailsByAuthIndex,
  loading,
  disableControls,
  isSwitching,
  resolvedTheme,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: OpenAISectionProps) {
  const { t } = useTranslation();
  const pageTransitionLayer = usePageTransitionLayer();
  const isTransitionAnimating = pageTransitionLayer?.isAnimating ?? false;
  const actionsDisabled = disableControls || loading || isSwitching;
  const toggleDisabled = disableControls || loading || isSwitching;
  const [collapsed, setCollapsed] = useState(true);
  const [sortOption, setSortOption] = useState<SortOption>('priority');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_STATUS_FILTER);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [expandedProviderKeys, setExpandedProviderKeys] = useState<Set<string>>(new Set());
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [dropdownLayout, setDropdownLayout] = useState({ openAbove: false, maxHeight: 300 });
  const [floatingToolbarStyle, setFloatingToolbarStyle] = useState<FloatingToolbarStyle>({
    left: 0,
    top: 0,
    width: 0,
    visible: false,
  });
  const sectionRef = useRef<HTMLDivElement>(null);
  const topToolbarAnchorRef = useRef<HTMLDivElement>(null);
  const topDropdownRef = useRef<HTMLDivElement>(null);
  const floatingDropdownRef = useRef<HTMLDivElement>(null);

  const shouldRenderFloatingToolbar =
    !collapsed && !isTransitionAnimating && floatingToolbarStyle.visible;

  useEffect(() => {
    if (isTransitionAnimating) {
      return;
    }

    const updateFloatingToolbar = () => {
      const section = sectionRef.current;
      const anchor = topToolbarAnchorRef.current;

      if (!section || !anchor) {
        return;
      }

      const sectionRect = section.getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const rootStyles = getComputedStyle(document.documentElement);
      const fixedTop = Number.parseFloat(rootStyles.getPropertyValue('--header-height')) || 64;
      const toolbarHeight = anchorRect.height;
      const isMobile = window.innerWidth <= 768;
      const shouldShow =
        !collapsed &&
        !isMobile &&
        anchorRect.top <= fixedTop &&
        sectionRect.bottom > fixedTop + toolbarHeight;

      setFloatingToolbarStyle((prev) => {
        const next = {
          left: sectionRect.left,
          top: fixedTop,
          width: sectionRect.width,
          visible: shouldShow,
        };

        if (
          prev.left === next.left &&
          prev.top === next.top &&
          prev.width === next.width &&
          prev.visible === next.visible
        ) {
          return prev;
        }

        return next;
      });
    };

    updateFloatingToolbar();
    window.addEventListener('resize', updateFloatingToolbar);
    window.addEventListener('scroll', updateFloatingToolbar, true);

    return () => {
      window.removeEventListener('resize', updateFloatingToolbar);
      window.removeEventListener('scroll', updateFloatingToolbar, true);
    };
  }, [
    configs.length,
    isDropdownOpen,
    isTransitionAnimating,
    selectedModels,
    sortDirection,
    sortOption,
    statusFilter,
    collapsed,
  ]);

  useEffect(() => {
    if (!isDropdownOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedTop = topDropdownRef.current?.contains(target);
      const clickedFloating = floatingDropdownRef.current?.contains(target);

      if (!clickedTop && !clickedFloating) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

  useEffect(() => {
    if (!isDropdownOpen) {
      return;
    }

    const updateDropdownLayout = () => {
      const wrapper = floatingToolbarStyle.visible
        ? floatingDropdownRef.current
        : topDropdownRef.current;

      if (!wrapper) {
        return;
      }

      const rect = wrapper.getBoundingClientRect();
      const viewportPadding = 12;
      const dropdownGap = 4;
      const preferredMaxHeight = 300;
      const minimumMaxHeight = 120;
      const availableBelow = Math.max(
        0,
        window.innerHeight - rect.bottom - viewportPadding - dropdownGap
      );
      const availableAbove = Math.max(0, rect.top - viewportPadding - dropdownGap);
      const openAbove = availableBelow < preferredMaxHeight && availableAbove > availableBelow;
      const availableSpace = openAbove ? availableAbove : availableBelow;
      const maxHeight = Math.max(minimumMaxHeight, Math.min(preferredMaxHeight, availableSpace));

      setDropdownLayout((prev) => {
        if (prev.openAbove === openAbove && prev.maxHeight === maxHeight) {
          return prev;
        }

        return { openAbove, maxHeight };
      });
    };

    updateDropdownLayout();
    window.addEventListener('resize', updateDropdownLayout);
    window.addEventListener('scroll', updateDropdownLayout, true);

    return () => {
      window.removeEventListener('resize', updateDropdownLayout);
      window.removeEventListener('scroll', updateDropdownLayout, true);
    };
  }, [floatingToolbarStyle.visible, isDropdownOpen]);

  const allModelNames = useMemo(() => {
    const modelSet = new Set<string>();
    configs.forEach((provider) => {
      provider.models?.forEach((model) => {
        if (model.name) {
          modelSet.add(model.name);
        }
      });
    });
    return Array.from(modelSet).sort();
  }, [configs]);
  const selectedModelNames = useMemo(() => Array.from(selectedModels).sort(), [selectedModels]);
  const modelFilterActive = selectedModelNames.length > 0;
  const modelFilterLabel = modelFilterActive
    ? t('ai_providers.model_discovery_selected_count', { count: selectedModelNames.length })
    : t('ai_providers.model_search_placeholder');
  const modelFilterTitle = modelFilterActive
    ? selectedModelNames.join(', ')
    : t('ai_providers.model_search_placeholder');

  const statusBarCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof calculateStatusBarData>>();

    configs.forEach((provider, index) => {
      const providerKey = getOpenAIProviderKey(provider, index);
      cache.set(
        providerKey,
        calculateStatusBarData(
          collectOpenAIProviderUsageDetails(provider, usageDetailsBySource, usageDetailsByAuthIndex)
        )
      );
    });

    return cache;
  }, [configs, usageDetailsByAuthIndex, usageDetailsBySource]);

  const sortOptions = useMemo(
    () => [
      { value: 'priority', label: t('ai_providers.sort_by_priority') },
      { value: 'name', label: t('ai_providers.sort_by_name') },
      { value: 'recent-success', label: t('ai_providers.sort_by_recent_success') },
    ],
    [t]
  );

  const statusOptions = useMemo(() => {
    const counts = configs.reduce(
      (acc, provider) => {
        const stats = getOpenAIProviderStats(provider, keyStats);
        const disabled = provider.disabled === true;

        acc.all += 1;
        if (disabled) {
          acc.disabled += 1;
        } else {
          acc.enabled += 1;
        }
        if (isProblemProvider(provider, stats)) {
          acc.problem += 1;
        }

        return acc;
      },
      { all: 0, enabled: 0, disabled: 0, problem: 0 }
    );

    return [
      {
        value: 'all' as const,
        label: t('ai_providers.status_filter_all'),
        count: counts.all,
      },
      {
        value: 'enabled' as const,
        label: t('ai_providers.status_filter_enabled'),
        count: counts.enabled,
      },
      {
        value: 'disabled' as const,
        label: t('ai_providers.status_filter_disabled'),
        count: counts.disabled,
      },
      {
        value: 'problem' as const,
        label: t('ai_providers.status_filter_problem'),
        count: counts.problem,
      },
    ];
  }, [configs, keyStats, t]);

  const sortedConfigs = useMemo<IndexedOpenAIProvider[]>(() => {
    const indexed = configs.map((config, originalIndex) => ({ config, originalIndex }));
    const filtered = indexed
      .filter(({ config }) => {
        if (selectedModels.size === 0) return true;
        return config.models?.some((model) => selectedModels.has(model.name));
      })
      .filter(({ config }) => {
        const disabled = config.disabled === true;

        if (statusFilter === 'enabled') {
          return !disabled;
        }
        if (statusFilter === 'disabled') {
          return disabled;
        }
        if (statusFilter === 'problem') {
          return isProblemProvider(config, getOpenAIProviderStats(config, keyStats));
        }

        return true;
      });

    const sorted = [...filtered];
    const direction = sortDirection === 'desc' ? -1 : 1;
    const providerStats =
      sortOption === 'recent-success'
        ? new Map(sorted.map(({ config }) => [config, getOpenAIProviderStats(config, keyStats)]))
        : null;

    switch (sortOption) {
      case 'name':
        sorted.sort((a, b) => direction * a.config.name.localeCompare(b.config.name));
        break;
      case 'priority':
        sorted.sort((a, b) => {
          const priorityA = a.config.priority ?? Number.MAX_SAFE_INTEGER;
          const priorityB = b.config.priority ?? Number.MAX_SAFE_INTEGER;
          const priorityDiff = priorityA - priorityB;

          if (priorityDiff !== 0) {
            return direction * priorityDiff;
          }

          return direction * a.config.name.localeCompare(b.config.name);
        });
        break;
      case 'recent-success':
        sorted.sort((a, b) => {
          const successDiff =
            (providerStats?.get(a.config)?.success ?? 0) -
            (providerStats?.get(b.config)?.success ?? 0);

          if (successDiff !== 0) {
            return direction * successDiff;
          }

          return direction * a.config.name.localeCompare(b.config.name);
        });
        break;
      default:
        break;
    }

    return sorted;
  }, [configs, sortOption, sortDirection, keyStats, selectedModels, statusFilter]);

  const toggleModelSelection = (modelName: string) => {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelName)) {
        next.delete(modelName);
      } else {
        next.add(modelName);
      }
      return next;
    });
  };

  const clearAllModels = () => {
    setSelectedModels(new Set());
  };

  const handleSortOptionChange = (value: SortOption) => {
    setSortOption(value);
  };

  const toggleSortDirection = () => {
    setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  const toggleProviderExpanded = (providerKey: string) => {
    setExpandedProviderKeys((prev) => {
      const next = new Set(prev);
      if (next.has(providerKey)) {
        next.delete(providerKey);
      } else {
        next.add(providerKey);
      }
      return next;
    });
  };

  const clearListFilters = () => {
    setSelectedModels(new Set());
    setStatusFilter('all');
  };

  const toggleSectionCollapsed = () => {
    setCollapsed((prev) => !prev);
    setIsDropdownOpen(false);
  };

  const toggleDropdown = () => setIsDropdownOpen((prev) => !prev);

  const renderStatusFilters = () => (
    <div className={styles.statusFilterTabs} role="group" aria-label={t('common.status')}>
      {statusOptions.map((option) => {
        const selected = statusFilter === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={`${styles.statusFilterTab} ${selected ? styles.statusFilterTabActive : ''}`}
            onClick={() => setStatusFilter(option.value)}
            disabled={actionsDisabled}
            aria-pressed={selected}
            data-card-header-ignore-click="true"
          >
            <span>{option.label}</span>
            <strong>{option.count}</strong>
          </button>
        );
      })}
    </div>
  );

  const renderSortControls = () => (
    <div className={styles.sortControls}>
      <Select
        value={sortOption}
        options={sortOptions}
        onChange={(value) => handleSortOptionChange(value as SortOption)}
        className={styles.sortSelect}
        disabled={actionsDisabled}
        ariaLabel={t('ai_providers.sort_by_priority')}
        fullWidth={false}
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={toggleSortDirection}
        className={styles.sortDirectionButton}
        disabled={actionsDisabled}
        title={
          sortDirection === 'asc'
            ? t('ai_providers.sort_ascending')
            : t('ai_providers.sort_descending')
        }
        aria-label={
          sortDirection === 'asc'
            ? t('ai_providers.sort_ascending')
            : t('ai_providers.sort_descending')
        }
      >
        <span className={styles.sortDirectionIcon}>
          {sortDirection === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </span>
        <span>
          {sortDirection === 'asc'
            ? t('ai_providers.sort_asc_short')
            : t('ai_providers.sort_desc_short')}
        </span>
      </Button>
    </div>
  );

  const renderToolbar = (isFloating = false) => {
    const isActiveToolbar = isFloating === shouldRenderFloatingToolbar;
    const dropdownClassName = dropdownLayout.openAbove
      ? `${styles.modelDropdownList} ${styles.modelDropdownListAbove}`
      : styles.modelDropdownList;

    return (
      <div className={styles.cardHeaderActions}>
        <Button
          variant="secondary"
          size="sm"
          onClick={toggleSectionCollapsed}
          className={styles.collapseToggleButton}
          aria-expanded={!collapsed}
          data-card-header-ignore-click="true"
        >
          <span className={styles.collapseToggleIcon} aria-hidden="true">
            {collapsed ? <IconChevronDown size={14} /> : <IconChevronUp size={14} />}
          </span>
          {collapsed ? t('ai_providers.expand') : t('ai_providers.collapse')}
        </Button>
        {!collapsed && (
          <>
            {renderStatusFilters()}
            <div
              className={styles.modelMultiSelectWrapper}
              ref={isFloating ? floatingDropdownRef : topDropdownRef}
            >
              <div
                className={[
                  styles.modelFilterControl,
                  modelFilterActive ? styles.modelFilterControlActive : '',
                  actionsDisabled ? styles.modelFilterControlDisabled : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  className={styles.modelFilterTrigger}
                  onClick={toggleDropdown}
                  disabled={actionsDisabled}
                  title={modelFilterTitle}
                  aria-label={modelFilterTitle}
                  aria-haspopup="true"
                  aria-expanded={isActiveToolbar && isDropdownOpen}
                >
                  <span className={styles.modelFilterIcon} aria-hidden="true">
                    <IconSlidersHorizontal size={14} />
                  </span>
                  <span className={styles.modelFilterText}>{modelFilterLabel}</span>
                  {modelFilterActive && (
                    <span className={styles.modelFilterCount}>{selectedModelNames.length}</span>
                  )}
                  <span className={styles.modelFilterChevron} aria-hidden="true">
                    <IconChevronDown size={14} />
                  </span>
                </button>
                {modelFilterActive && (
                  <button
                    type="button"
                    className={styles.modelFilterInlineClear}
                    onClick={clearAllModels}
                    disabled={actionsDisabled}
                    aria-label={t('ai_providers.model_search_clear')}
                    title={t('ai_providers.model_search_clear')}
                  >
                    <IconX size={14} />
                  </button>
                )}
              </div>
              {isActiveToolbar && isDropdownOpen && (
                <div
                  className={dropdownClassName}
                  style={{ maxHeight: `${dropdownLayout.maxHeight}px` }}
                >
                  <div className={styles.modelDropdownHeader}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedModels(new Set(allModelNames))}
                      className={styles.modelDropdownSelectAll}
                      disabled={actionsDisabled || allModelNames.length === 0}
                    >
                      {t('ai_providers.model_select_all')}
                    </Button>
                    {modelFilterActive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearAllModels}
                        className={styles.modelDropdownClear}
                        disabled={actionsDisabled}
                      >
                        {t('ai_providers.model_search_clear')}
                      </Button>
                    )}
                  </div>
                  <div
                    className={styles.modelDropdownItems}
                    role="group"
                    aria-label={t('ai_providers.model_search_placeholder')}
                  >
                    {allModelNames.length === 0 ? (
                      <div className={styles.modelDropdownEmpty}>
                        {t('ai_providers.model_filter_empty')}
                      </div>
                    ) : (
                      allModelNames.map((name) => (
                        <SelectionCheckbox
                          key={`top-option-${name}`}
                          checked={selectedModels.has(name)}
                          onChange={() => toggleModelSelection(name)}
                          disabled={actionsDisabled}
                          className={styles.modelDropdownItem}
                          labelClassName={styles.modelDropdownItemLabel}
                          label={<span title={name}>{name}</span>}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        {!collapsed && renderSortControls()}
        <Button
          size="sm"
          onClick={onAdd}
          disabled={actionsDisabled}
          className={styles.openaiAddButton}
        >
          {t('ai_providers.openai_add_button')}
        </Button>
      </div>
    );
  };

  const renderStaticTitle = () => (
    <span className={styles.cardTitle}>
      <img
        src={resolvedTheme === 'dark' ? iconOpenaiDark : iconOpenaiLight}
        alt=""
        className={styles.cardTitleIcon}
      />
      {t('ai_providers.openai_title')}
    </span>
  );

  const renderProviderCard = ({ config: provider, originalIndex }: IndexedOpenAIProvider) => {
    const stats = getOpenAIProviderStats(provider, keyStats);
    const headerEntries = Object.entries(provider.headers || {});
    const apiKeyEntries = provider.apiKeyEntries || [];
    const models = provider.models || [];
    const providerKey = getOpenAIProviderKey(provider, originalIndex);
    const statusData = statusBarCache.get(providerKey) || EMPTY_STATUS_BAR;
    const providerDisabled = provider.disabled === true;
    const expanded = expandedProviderKeys.has(providerKey);
    const totalRequests = getStatsTotal(stats);
    const successRate = getSuccessRate(stats);
    const problem = isProblemProvider(provider, stats);
    const healthClassName =
      successRate === null
        ? styles.providerHealthIdle
        : successRate >= 95
          ? styles.providerHealthGood
          : successRate >= 80
            ? styles.providerHealthWarn
            : styles.providerHealthBad;

    return (
      <div
        key={`openai-provider-${originalIndex}`}
        className={[
          styles.openaiProviderCard,
          providerDisabled ? styles.openaiProviderCardDisabled : '',
          problem && !providerDisabled ? styles.openaiProviderCardProblem : '',
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
            onClick={() => toggleProviderExpanded(providerKey)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') {
                return;
              }
              event.preventDefault();
              toggleProviderExpanded(providerKey);
            }}
          >
            <div className={styles.openaiProviderTitleBlock}>
              <div className={styles.openaiProviderTitle}>{provider.name}</div>
              <span
                className={
                  providerDisabled ? styles.providerStatusDisabled : styles.providerStatusEnabled
                }
              >
                {providerDisabled
                  ? t('ai_providers.status_filter_disabled')
                  : t('ai_providers.status_filter_enabled')}
              </span>
            </div>
            <div className={styles.providerHealthSummary}>
              <span className={`${styles.providerHealthRate} ${healthClassName}`}>
                {formatSuccessRate(successRate)}
              </span>
              <span className={styles.providerHealthCounts}>
                {stats.success}/{stats.failure}
              </span>
            </div>
          </div>
          <div className={styles.providerSummaryGrid}>
            <div className={styles.providerSummaryItem}>
              <span>{t('common.base_url')}</span>
              <strong title={provider.baseUrl}>{provider.baseUrl}</strong>
            </div>
            <div className={styles.providerSummaryItem}>
              <span>{t('ai_providers.openai_keys_count')}</span>
              <strong>{apiKeyEntries.length}</strong>
            </div>
            <div className={styles.providerSummaryItem}>
              <span>{t('ai_providers.openai_models_count')}</span>
              <strong>{models.length}</strong>
            </div>
            <div className={styles.providerSummaryItem}>
              <span>{t('ai_providers.openai_requests_count')}</span>
              <strong>{totalRequests}</strong>
            </div>
          </div>
          {(provider.priority !== undefined || provider.prefix || provider.testModel) && (
            <div className={styles.providerCompactMeta}>
              {provider.priority !== undefined && (
                <span>
                  {t('common.priority')}: <strong>{provider.priority}</strong>
                </span>
              )}
              {provider.prefix && (
                <span>
                  {t('common.prefix')}: <strong>{provider.prefix}</strong>
                </span>
              )}
              {provider.testModel && (
                <span>
                  {t('ai_providers.openai_test_model')}: <strong>{provider.testModel}</strong>
                </span>
              )}
            </div>
          )}
          {expanded && (
            <div className={styles.providerDetails}>
              {headerEntries.length > 0 && (
                <div className={styles.headerBadgeList}>
                  {headerEntries.map(([key, value]) => (
                    <span key={key} className={styles.headerBadge}>
                      <strong>{key}:</strong> {value}
                    </span>
                  ))}
                </div>
              )}
              {apiKeyEntries.length > 0 && (
                <div className={styles.apiKeyEntriesSection}>
                  <div className={styles.providerDetailHeader}>
                    <span>
                      <IconKey size={14} /> {t('ai_providers.openai_keys_count')}:{' '}
                      {apiKeyEntries.length}
                    </span>
                  </div>
                  <div className={styles.apiKeyEntryList}>
                    {apiKeyEntries.map((entry, entryIndex) => {
                      const entryStats = getStatsForIdentity(
                        { authIndex: entry.authIndex, apiKey: entry.apiKey },
                        keyStats
                      );
                      return (
                        <div
                          key={getApiKeyEntryRenderKey(entry, entryIndex)}
                          className={styles.apiKeyEntryCard}
                        >
                          <span className={styles.apiKeyEntryIndex}>{entryIndex + 1}</span>
                          <span className={styles.apiKeyEntryKey}>{maskApiKey(entry.apiKey)}</span>
                          {entry.proxyUrl && (
                            <span className={styles.apiKeyEntryProxy}>{entry.proxyUrl}</span>
                          )}
                          <div className={styles.apiKeyEntryStats}>
                            <span
                              className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}
                            >
                              <IconCheck size={12} /> {entryStats.success}
                            </span>
                            <span
                              className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}
                            >
                              <IconX size={12} /> {entryStats.failure}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {models.length > 0 && (
                <div className={styles.providerModelsSection}>
                  <div className={styles.providerDetailHeader}>
                    <span>
                      <IconModelCluster size={14} /> {t('ai_providers.openai_models_count')}:{' '}
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
              )}
            </div>
          )}
          <div className={styles.cardStats}>
            <span className={`${styles.statPill} ${styles.statSuccess}`}>
              {t('stats.success')}: {stats.success}
            </span>
            <span className={`${styles.statPill} ${styles.statFailure}`}>
              {t('stats.failure')}: {stats.failure}
            </span>
          </div>
          <ProviderStatusBar statusData={statusData} />
        </div>
        <div className={styles.openaiProviderActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => toggleProviderExpanded(providerKey)}
            disabled={actionsDisabled}
            aria-expanded={expanded}
          >
            <span className={styles.collapseToggleIcon} aria-hidden="true">
              {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            </span>
            {expanded ? t('ai_providers.hide_details') : t('ai_providers.show_details')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onEdit(originalIndex)}
            disabled={actionsDisabled}
          >
            {t('common.edit')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => onDelete(originalIndex)}
            disabled={actionsDisabled}
          >
            {t('common.delete')}
          </Button>
          <ToggleSwitch
            label={t('ai_providers.config_toggle_label')}
            checked={!providerDisabled}
            disabled={toggleDisabled}
            onChange={(value) => void onToggle(originalIndex, value)}
          />
        </div>
      </div>
    );
  };

  return (
    <>
      <div ref={sectionRef}>
        <Card
          title={renderStaticTitle()}
          onHeaderClick={toggleSectionCollapsed}
          headerExpanded={!collapsed}
          headerAriaLabel={collapsed ? t('ai_providers.expand') : t('ai_providers.collapse')}
          extra={
            <div
              ref={topToolbarAnchorRef}
              className={shouldRenderFloatingToolbar ? styles.openaiToolbarAnchorHidden : undefined}
            >
              {renderToolbar(false)}
            </div>
          }
        >
          {!collapsed &&
            (loading && sortedConfigs.length === 0 ? (
              <div className="hint">{t('common.loading')}</div>
            ) : configs.length > 0 && sortedConfigs.length === 0 ? (
              <EmptyState
                title={t('ai_providers.openai_filtered_empty_title')}
                description={t('ai_providers.openai_filtered_empty_desc')}
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={clearListFilters}
                    disabled={actionsDisabled}
                  >
                    {t('ai_providers.model_search_clear')}
                  </Button>
                }
              />
            ) : sortedConfigs.length === 0 ? (
              <EmptyState
                title={t('ai_providers.openai_empty_title')}
                description={t('ai_providers.openai_empty_desc')}
              />
            ) : (
              <div className={styles.openaiProviderList}>
                {sortedConfigs.map(renderProviderCard)}
              </div>
            ))}
        </Card>
      </div>
      {typeof document !== 'undefined' && shouldRenderFloatingToolbar
        ? createPortal(
            <div
              className={`card ${styles.openaiFloatingToolbar}`}
              style={{
                left: `${floatingToolbarStyle.left}px`,
                top: `${floatingToolbarStyle.top}px`,
                width: `${floatingToolbarStyle.width}px`,
              }}
            >
              <div className="card-header">
                <div className="title">{renderStaticTitle()}</div>
                {renderToolbar(true)}
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
