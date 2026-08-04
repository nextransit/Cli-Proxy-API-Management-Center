# 请求事件明细表高度扩大 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将「使用统计 → 请求事件明细」表格可视区 `max-height` 从 460px 提到 720px，使得默认窗口即可看到 14~15 条完整记录行。

**Architecture:** 单点 SCSS 属性调整。不引入新依赖、不动组件树、不动 i18n 文案、不动 `MAX_RENDERED_EVENTS`、不动响应式断点。

**Tech Stack:** SCSS Modules、`vite-plugin-singlefile` 打包、`git submodule` 工作流（`Cli-Proxy-API-Management-Center` 是父仓库的 submodule）。

---

## File Structure

| 操作 | 路径 | 责任 |
|---|---|---|
| Modify | `Cli-Proxy-API-Management-Center/src/pages/UsagePage.module.scss:1919` | 调整 `.requestEventsTableWrapper` 的 `max-height` |

只动一个属性值。其他文件保持原样。

---

## Task 1: 扩大请求事件明细表可视区高度

**Files:**
- Modify: `Cli-Proxy-API-Management-Center/src/pages/UsagePage.module.scss:1919`

- [ ] **Step 1: 阅读目标行上下文**

打开文件，定位到 1917-1923 行的 `.requestEventsTableWrapper` 块。确认规则包括 `overflow: auto;` 和 `max-height: <n>px;` 两行。

- [ ] **Step 2: 修改 max-height**

将第 1919 行的
```scss
  max-height: 460px;
```
替换为
```scss
  max-height: 720px;
```
其他行（含 `overflow: auto;` 及其下方 4 行）不得修改。

- [ ] **Step 3: 自验 diff**

运行：
```bash
cd /Users/zhouyong/Desktop/work/Decard/gitlab/ai/CLIProxyAPI/Cli-Proxy-API-Management-Center
git diff src/pages/UsagePage.module.scss
```
**Expected output**（允许上下文行号差异，实质内容一致即可）：
```diff
 .requestEventsTableWrapper {
   overflow: auto;
-  max-height: 460px;
+  max-height: 720px;
   border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
   border-radius: $radius-md;
   background: color-mix(in srgb, var(--bg-secondary) 72%, transparent);
 }
```
只有 `max-height` 这一行被改动，其他上下文保持不变。

- [ ] **Step 4: 提交（submodule 内）**

```bash
cd /Users/zhouyong/Desktop/work/Decard/gitlab/ai/CLIProxyAPI/Cli-Proxy-API-Management-Center
git add src/pages/UsagePage.module.scss
git commit -m "fix(usage): raise request events table viewport to 720px (15 rows)"
```

- [ ] **Step 5: 同步 submodule 引用到父仓库**

```bash
cd /Users/zhouyong/Desktop/work/Decard/gitlab/ai/CLIProxyAPI
git add Cli-Proxy-API-Management-Center
git commit -m "chore(submodule): pick up request events table height fix"
```

---

## Self-Review

- **Spec coverage：**
  - §2.1 单点改动 SCSS → Task 1 ✅
  - §3.1 `max-height: 720px` → Task 1 Step 2 ✅
  - §3.2 ≥ 14 行可见 → Task 1 完成后由 720px 值满足（50px/行 × 14 ≈ 700px） ✅
  - §3.3 只改 `max-height` 属性 → Task 1 Step 3 diff 校验 ✅
  - §3.4 不引入依赖/文件/i18n key → 仅 1 个文件、1 行改动 ✅
  - §3.5 `git diff` 只动一个属性值 → Task 1 Step 3 ✅

- **Placeholder scan：** 无 TBD / TODO。

- **Type consistency：** 不涉及 TS 类型变化。

- **范围：** 改动足够小，单 Task 计划合适。
