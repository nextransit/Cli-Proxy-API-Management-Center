# 请求事件明细表高度扩大 Design

> 单文件 SCSS 改动。扩大「使用统计 → 请求事件明细」表格可视区高度，目标是默认渲染即可看到至少 15 条完整记录。

**Date:** 2026-08-04
**Status:** Draft
**Scope:** Cli-Proxy-API-Management-Center 前端单一文件改动

---

## 1. 背景与现状

### 1.1 现象
- 用户在「使用统计」页面的「请求事件明细」卡片中，希望不滚动即可看到至少 15 条请求事件。
- 当前 `requestEventsTableWrapper` 容器使用 `max-height: 460px`，实际可看到的完整记录行数（含 token 多行展示）约为 8~10 条。

### 1.2 现状代码（关键行）

`Cli-Proxy-API-Management-Center/src/pages/UsagePage.module.scss` 第 1917-1923 行：

```scss
.requestEventsTableWrapper {
  overflow: auto;
  max-height: 460px;
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  border-radius: $radius-md;
  background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
}
```

`Cli-Proxy-API-Management-Center/src/components/usage/RequestEventsDetailsCard.tsx` 第 38 行：

```ts
const MAX_RENDERED_EVENTS = 500;
```

### 1.3 真实行高估算
- 单行 `<tr>` 在标准布局下约为 28~34 px
- token 列存在双行展示（`tokenSummaryTotal` + `tokenSummaryParts`），多数情况下撑高到 ~52 px
- 加上 padding/border：完整可读行高度落在 **44~58 px** 区间

因此：

| max-height | 实际可见完整行（按 50 px/行） |
|---|---|
| 460 px（现状） | ~9 行 |
| 720 px（目标） | ~14~15 行 |
| 800 px（参考上界） | ~16 行 |

### 1.4 用户决策
- 高度策略：**固定高度 720px**（用户已在 brainstorming 中确认）
- 优化范围：**只改高度**，不改 MAX_RENDERED_EVENTS、不动图表动画、不引入虚拟滚动库
- 实现方式：**改 SCSS 即可**

---

## 2. 设计

### 2.1 改动

**单点改动：** `UsagePage.module.scss` 中 `.requestEventsTableWrapper` 的 `max-height` 从 `460px` 提升到 `720px`。

### 2.2 完整新值

```scss
.requestEventsTableWrapper {
  overflow: auto;
  max-height: 720px;
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  border-radius: $radius-md;
  background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
}
```

只改 `max-height` 这一行，其他属性保持原样。

### 2.3 为什么是 720px
- 50 px/行（保守估计含 token 双行）× 15 行 ≈ 750 px，加 1 行 buffer → **720 px** 给出 14~15 行可见完整记录。
- 与现状 460px 相比，表体高度增加 ~260 px，页面整体仍是滚动布局，不破坏响应式布局。
- 仍保留滚动条，提示当 `filteredRows.length > MAX_RENDERED_EVENTS` 时存在更多数据（提示文案保持 `request_events_limit_hint`）。

### 2.4 不在范围内
- `MAX_RENDERED_EVENTS = 500`：保留。用户当前要求是「高度」，未要求解除渲染上限。
- 图表 `animation: false`：保留 TelemetryChart 默认行为。
- i18n 文案：保留 `"仅展示 {{shown}} / {{total}} 条事件"` 提示，不需要改。
- 虚拟滚动 / Web Worker / 数据采样：本期不做。
- 响应式断点：本期不做小屏降级。

### 2.5 风险评估

| 风险 | 等级 | 说明 |
|---|---|---|
| 浏览器滚动卡顿 | 低 | `MAX_RENDERED_EVENTS = 500` 保持不变，DOM 节点数恒定 |
| 移动端占用过高 | 低 | 现有布局已经是滚动页面；超出部分以滚动条呈现 |
| 主题样式破坏 | 极低 | 仅改一个数值，其他样式不变 |

---

## 3. 验收标准

1. `UsagePage.module.scss` 中 `.requestEventsTableWrapper` 的 `max-height` 是 `720px`。
2. 在常规分辨率（≥ 1280×800）下，「请求事件明细」表默认可见完整记录行数 ≥ 14（按 50 px/行保守估算），紧凑行高下可达 ~15 行。
3. 改动只影响 `.requestEventsTableWrapper` 的 `max-height`；该规则其他属性未被修改。
4. 没有引入新依赖、新文件、新 i18n key。
5. `git diff` 显示只动了一个属性值。

---

## 4. 文件清单

| 操作 | 路径 | 行数变化 |
|---|---|---|
| Modify | `Cli-Proxy-API-Management-Center/src/pages/UsagePage.module.scss` | 1 行 |