# OpenAI API 密钥列表 UI 优化实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将"编辑 OpenAI 兼容提供商"页面的 API 密钥列表从拥挤的表格行重构为扁平卡片式布局

**Architecture:** 保持现有组件结构不变，重构 `renderKeyEntries` 的布局结构。状态徽章增强为支持 latency 显示和错误信息 tooltip。代理 URL 默认收起，操作按钮添加二次确认。

**Tech Stack:** React + TypeScript + SCSS 模块

---

## 文件变更概览

| 文件 | 变更 |
|------|------|
| `src/pages/AiProvidersOpenAIEditPage.tsx` | 重构 `renderKeyEntries` 为卡片布局 |
| `src/pages/AiProvidersPage.module.scss` | 新增卡片样式，修改表格样式 |

---

## Task 1: StatusBadge 组件增强

**Files:**
- Modify: `src/pages/AiProvidersOpenAIEditPage.tsx:32-67`

**目标:** StatusBadge 支持 latency 显示和错误信息 tooltip

- [ ] **Step 1: 查看现有 StatusBadge 实现**

现有代码位于 `AiProvidersOpenAIEditPage.tsx:32-67`，当前仅显示静态状态文字。

- [ ] **Step 2: 修改 StatusBadge 支持 latency 参数**

```tsx
function StatusBadge({
  status,
  message,
  latency,
}: {
  status: KeyTestStatus['status'];
  message?: string;
  latency?: number;
}) {
  const { t } = useTranslation();

  const getBadgeClass = () => {
    switch (status) {
      case 'loading':
        return styles.keyStatusBadgeLoading;
      case 'success':
        return styles.keyStatusBadgeSuccess;
      case 'error':
        return styles.keyStatusBadgeError;
      default:
        return styles.keyStatusBadgeIdle;
    }
  };

  const getLabel = () => {
    switch (status) {
      case 'loading':
        return t('ai_providers.openai_test_status_loading');
      case 'success':
        return latency ? `${t('ai_providers.openai_test_status_success')} (${latency}ms)` : t('ai_providers.openai_test_status_success');
      case 'error':
        return t('ai_providers.openai_test_status_error');
      default:
        return t('ai_providers.openai_test_status_idle');
    }
  };

  return (
    <span
      className={`${styles.keyStatusBadge} ${getBadgeClass()}`}
      title={message || ''}
    >
      {status === 'loading' && <span className={styles.statusSpinner}>⟳</span>}
      {getLabel()}
    </span>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/AiProvidersOpenAIEditPage.tsx
git commit -m "feat: enhance StatusBadge with latency display and tooltip"
```

---

## Task 2: 重构 renderKeyEntries 为卡片布局

**Files:**
- Modify: `src/pages/AiProvidersOpenAIEditPage.tsx:441-606`

**目标:** 将表格行 `keyTableRow` 重构为横向卡片 `keyCard`

- [ ] **Step 1: 理解现有 renderKeyEntries 结构**

现有 `renderKeyEntries` 函数返回表格结构：`.keyTableShell` > `.keyTableHeader` + 多个 `.keyTableRow`

- [ ] **Step 2: 替换表格结构为卡片列表结构**

将 `keyTableShell` 内内容替换为垂直卡片列表：

```tsx
// 替换 .keyTableShell 内容
<div className={styles.keyCardList}>
  {list.map((entry, index) => {
    const keyStatus = keyTestStatuses[index]?.status ?? 'idle';
    const canTestKey = Boolean(entry.apiKey?.trim()) && hasConfiguredModels;

    return (
      <div key={index} className={styles.keyCard}>
        {/* 卡片主体：状态 + 密钥 + 权重 */}
        <div className={styles.keyCardMain}>
          {/* 状态 */}
          <div className={styles.keyCardStatus}>
            <StatusBadge status={keyStatus} message={keyTestStatuses[index]?.message} />
          </div>

          {/* 密钥输入 + 操作图标 */}
          <div className={styles.keyCardKeySection}>
            <div className={styles.keyInputGroup}>
              <input
                type={visibleKeyIndexes.has(index) ? 'text' : 'password'}
                value={entry.apiKey}
                onChange={(e) => updateEntry(index, { apiKey: e.target.value })}
                disabled={saving || disableControls || isTestingKeys}
                className={`input ${styles.keyCardInput}`}
                placeholder={t('ai_providers.openai_key_placeholder')}
              />
              <button
                type="button"
                className={styles.keyInputToggle}
                onClick={() => toggleKeyVisibility(index)}
                title={visibleKeyIndexes.has(index) ? t('common.hide') : t('common.show')}
                disabled={saving || disableControls || isTestingKeys}
              >
                {visibleKeyIndexes.has(index) ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              </button>
              <button
                type="button"
                className={styles.keyInputCopy}
                onClick={() => copyKeyToClipboard(entry.apiKey)}
                title={t('common.copy')}
                disabled={saving || disableControls || isTestingKeys || !entry.apiKey?.trim()}
              >
                <IconCopy size={14} />
              </button>
            </div>
          </div>

          {/* 权重 */}
          <div className={styles.keyCardWeight}>
            <WeightStepper
              value={entry.weight ?? 1}
              onChange={(val) => updateEntry(index, { weight: val })}
              min={1}
              disabled={saving || disableControls || isTestingKeys}
            />
          </div>

          {/* 展开/收起代理 */}
          <button
            type="button"
            className={styles.keyCardProxyToggle}
            onClick={() => toggleProxyExpanded(index)}
          >
            {expandedProxyIndexes.has(index) ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
            {expandedProxyIndexes.has(index) ? t('ai_providers.openai_proxy_collapse') : t('ai_providers.openai_proxy_expand')}
          </button>
        </div>

        {/* 代理展开区 */}
        {expandedProxyIndexes.has(index) && (
          <div className={styles.keyCardProxyExpanded}>
            <input
              type="text"
              value={entry.proxyUrl ?? ''}
              onChange={(e) => updateEntry(index, { proxyUrl: e.target.value })}
              disabled={saving || disableControls || isTestingKeys}
              className={`input ${styles.keyProxyInput}`}
              placeholder={t('ai_providers.openai_proxy_placeholder')}
            />
          </div>
        )}

        {/* 操作按钮 */}
        <div className={styles.keyCardActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void testSingleKey(index)}
            disabled={saving || disableControls || isTestingKeys || !canTestKey}
            loading={keyStatus === 'loading'}
          >
            {t('ai_providers.openai_test_single_action')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => handleDeleteConfirmation(index)}
            disabled={saving || disableControls || isTestingKeys || list.length <= 1}
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>
    );
  })}
</div>
```

- [ ] **Step 3: 添加删除确认状态管理**

在组件顶部添加状态：

```tsx
const [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(null);
```

- [ ] **Step 4: 添加 handleDeleteConfirmation 函数**

使用全局 `useNotificationStore` 的 `showConfirmation` 方法：

```tsx
import { useNotificationStore } from '@/stores';

const handleDeleteConfirmation = (index: number) => {
  useNotificationStore.getState().showConfirmation({
    title: t('ai_providers.openai_key_delete_confirm_title'),
    message: `${t('ai_providers.openai_key_delete_confirm_message')}: ${maskApiKey(form.apiKeyEntries[index]?.apiKey || '')}`,
    confirmText: t('common.delete'),
    cancelText: t('common.cancel'),
    variant: 'danger',
    onConfirm: async () => {
      removeEntry(index);
    },
  });
};
```

**注意**: 不再需要 `deleteConfirmIndex` 状态和 `confirmDelete/cancelDelete` 函数。删除确认由 `ConfirmationModal` 组件通过 store 自动处理。

- [ ] **Step 5: 移除之前的错误实现**

如果之前写了 `deleteConfirmIndex` 状态和相关的 `confirmDelete`/`cancelDelete`，需要删除。

- [ ] **Step 6: Commit**

```bash
git add src/pages/AiProvidersOpenAIEditPage.tsx
git commit -m "feat: refactor key entries to card layout with delete confirmation"
```

---

## Task 3: 编写卡片布局样式

**Files:**
- Modify: `src/pages/AiProvidersPage.module.scss`

**目标:** 新增 `.keyCardList` 和 `.keyCard` 系列样式

- [ ] **Step 1: 在样式文件末尾添加卡片样式**

```scss
// API Key Card List (replaces table layout)
.keyCardList {
  display: flex;
  flex-direction: column;
  gap: $spacing-md;
}

// Individual Key Card
.keyCard {
  display: flex;
  flex-direction: column;
  gap: $spacing-sm;
  padding: $spacing-md;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: $radius-lg;
  transition: background 0.15s ease;

  &:hover {
    background: var(--bg-tertiary);
  }
}

// Card main row: status + key + weight + proxy toggle
.keyCardMain {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  flex-wrap: wrap;
}

// Status badge column
.keyCardStatus {
  flex-shrink: 0;
  min-width: 100px;
}

// Key input section (grows to fill space)
.keyCardKeySection {
  flex: 1 1 280px;
  min-width: 200px;
}

// Weight stepper column
.keyCardWeight {
  flex-shrink: 0;
}

// Proxy toggle button
.keyCardProxyToggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
}

// Expanded proxy URL row
.keyCardProxyExpanded {
  padding: $spacing-sm;
  background: var(--bg-tertiary);
  border-radius: $radius-md;
}

// Card actions row
.keyCardActions {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
  padding-top: $spacing-xs;
  border-top: 1px solid var(--border-secondary);
}

// Card input styling
.keyCardInput {
  width: 100%;
  padding: 8px 12px;
  font-size: 14px;
  font-family: monospace;
  min-height: 38px;
}

// Mobile responsive
@include mobile {
  .keyCardMain {
    flex-direction: column;
    align-items: stretch;
  }

  .keyCardStatus {
    width: 100%;
  }

  .keyCardKeySection {
    width: 100%;
  }

  .keyCardWeight {
    width: 100%;
  }

  .keyCardProxyToggle {
    align-self: flex-start;
  }

  .keyCardActions {
    justify-content: flex-end;
  }
}
```

- [ ] **Step 2: 隐藏原有表格结构（临时方案）**

找到 `.keyTableShell` 相关样式，添加 `display: none`：

```scss
.keyTableShell {
  display: none; // Temporarily hidden, will be removed in future cleanup
}
```

或者直接在组件中注释掉表格结构。

- [ ] **Step 3: Commit**

```bash
git add src/pages/AiProvidersPage.module.scss
git commit -m "feat: add card-based styles for API key list"
```

---

## Task 4: 验证与调整

- [ ] **Step 1: 运行应用验证布局**

```bash
cd Cli-Proxy-API-Management-Center
npm run dev
```

访问编辑 OpenAI 提供商页面，检查密钥列表是否显示为卡片布局。

- [ ] **Step 2: 测试各项交互**

- [ ] 切换密钥明文/密文
- [ ] 复制密钥到剪贴板
- [ ] 展开/收起代理 URL
- [ ] 测试密钥连通性
- [ ] 删除密钥（二次确认）
- [ ] 权重步进器

- [ ] **Step 3: 检查暗色模式**

验证暗色主题下样式是否正常。

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "fix: complete API key list card layout optimization"
```

---

## 验证清单

| 功能 | 状态 |
|------|------|
| StatusBadge 支持 latency 显示 | ☐ |
| StatusBadge 错误信息 tooltip | ☐ |
| 密钥脱敏显示 | ☐ |
| 眼睛图标切换明文 | ☐ |
| 复制图标 | ☐ |
| 权重步进器 80px | ☐ |
| 代理 URL 默认收起 | ☐ |
| 删除二次确认弹窗 | ☐ |
| 响应式移动端适配 | ☐ |
| 暗色模式适配 | ☐ |
