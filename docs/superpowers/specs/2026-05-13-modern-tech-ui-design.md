# 现代科技风界面改造设计规范

**日期**: 2026-05-13
**状态**: 已批准实施

---

## 1. 设计目标

将 CLI Proxy API Management Center 打造成具有"正常科技风"和"现代感"的界面，核心在于克制与精密。

---

## 2. 视觉风格定义

### 2.1 几何精密感 (Geometric Precision)

**装饰性线条 (Tech Lines)**
- 大标题（OVERVIEW、欢迎语）上下增加 0.5px 超细线条
- 线条末端带 3px 实心小圆点，模拟电路/机械制图锚点
- 颜色：`rgba(88, 166, 255, 0.4)`

**背景网格 (Grid Pattern)**
- 整个背景增加极浅的暗色点状阵列
- 点大小：1px，间距：24px，颜色：`rgba(255, 255, 255, 0.03)`
- 使用 CSS background-image 实现

### 2.2 玻璃拟态与材质 (Glassmorphism)

**深色透明度**
- 卡片背景：`rgba(22, 27, 34, 0.6)` + `backdrop-filter: blur(12px)`
- 边框：`rgba(255, 255, 255, 0.08)`

**边缘光 (Inner Glow)**
- 卡片内发光：顶部/左侧添加 `inset 0 1px 1px rgba(255,255,255,0.05)`
- 模拟光线照在玻璃/金属边缘

**呼吸灯状态指示器**
- 启用状态：带 `box-shadow: 0 0 8px var(--status-color)` 的 8px 圆点
- 颜色语义：成功 `#34d399`，警告 `#fbbf24`，错误 `#fb7185`

### 2.3 数据呈现数字化

**Monospace 字体**
- 强制使用：`JetBrains Mono`, `Roboto Mono`, `SF Mono`
- 应用场景：数字、版本号、日期时间、API Key、Token 数量

**分段进度条 (Segmented Progress Bar)**
- AI 提供商分布替代 "G:0 C:19" 文本
- 每种颜色代表一个厂商，横向分段显示
- 颜色映射：OpenAI `#10b981`, Claude `#a78bfa`, Gemini `#fbbf24`, Deepseek `#6366f1`

### 2.4 色调方案

**深色主题主色**
- 背景：`#0a0a0a` / `#0d1117`
- 卡片：`rgba(22, 27, 34, 0.6)` + blur
- 边框：`rgba(255, 255, 255, 0.06)`

**点缀色 (Accent Colors)**
- 主强调：`#58a6ff` (科技蓝)
- 成功：`#34d399` (电子绿)
- 警告：`#fbbf24` (琥珀)
- 错误：`#fb7185` (珊瑚红)
- 特殊：`#a78bfa` (紫罗兰)

---

## 3. 功能模块改造

### 3.1 页面标题区 (OVERVIEW)

**现状**: 纯文字标题
**改造**:
```
┌─ OVERVIEW ──────────────────────────────┬────────────────┐
│                                      │ Status Card   │
└──────────────────────────────────────┴────────────────┘
```
- 标题上下增加 Tech Lines
- 左侧带锚点装饰

### 3.2 状态卡片 (ServiceHealthCard)

**现状**: 简单文字状态
**改造**:
- 使用呼吸灯圆点指示器
- 启用：绿色发光圆点 + "在线"
- 禁用：灰色圆点 + "离线"

### 3.3 AI 提供商分布

**现状**: `G:0 C:19` 调试风格文本
**改造**:
- 横向分段进度条
- 每段长度按使用量比例
- 悬停显示详细数字

### 3.4 数字展示

**现状**: 系统字体
**改造**:
- 所有数字使用 JetBrains Mono
- 大数字使用 CountUp.js 跳动效果

### 3.5 时间显示

**现状**: 可能显示 "Invalid Date"
**改造**:
- 修复日期解析逻辑
- 格式：`YYYY-MM-DD HH:mm:ss`
- 使用 `<time>` 元素

---

## 4. 细节打磨

### 4.1 微交互动效

**卡片 Hover**
- `transform: translateY(-2px)`
- 内发光增强：`inset 0 2px 4px rgba(255,255,255,0.08)`
- 过渡：`0.2s ease`

**按钮 Hover**
- 背景微亮
- 边框发光增强

### 4.2 图标统一性

- 所有 Lucide 图标使用 `stroke-width: 1.72`
- 科技感图标可考虑自定义 SVG

### 4.3 Invalid Date 修复

**根因**: 日期解析返回 NaN
**修复**: 增加空值和无效值检查，返回 '--' 替代

---

## 5. 实施优先级

1. **P0 - Bug 修复**: Invalid Date
2. **P1 - 数据呈现**: Monospace 字体 + 分段进度条
3. **P2 - 视觉效果**: 玻璃拟态 + 内发光 + 背景网格
4. **P3 - 细节打磨**: 微交互 + 呼吸灯状态

---

## 6. 技术实现

### CSS 变量新增

```scss
// 科技风主题变量
--tech-line-color: rgba(88, 166, 255, 0.4);
--tech-dot-color: #58a6ff;
--tech-grid-dot: rgba(255, 255, 255, 0.03);
--glass-bg: rgba(22, 27, 34, 0.6);
--glass-border: rgba(255, 255, 255, 0.08);
--inner-glow: inset 0 1px 1px rgba(255,255,255,0.05);

// 状态指示器
--status-glow-green: 0 0 8px #34d399;
--status-glow-amber: 0 0 8px #fbbf24;
--status-glow-red: 0 0 8px #fb7185;
```

### 字体加载

```html
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap" rel="stylesheet">
```

---

## 7. 验收标准

- [ ] Invalid Date 不再出现
- [ ] 所有数字使用等宽字体
- [ ] 卡片具有玻璃拟态效果
- [ ] 状态使用呼吸灯指示器
- [ ] 背景有暗色点阵网格
- [ ] AI 提供商使用分段进度条
- [ ] 卡片有内发光边缘效果
