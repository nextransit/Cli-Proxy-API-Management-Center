# 主题规范指南

## 1. 主题系统架构

### 1.1 主题类型
| Theme Key | data-theme 属性 | 说明 |
|-----------|----------------|------|
| `light` | 无属性 (`:root:not([data-theme])`) | 羊毛纸主题 |
| `white` | `data-theme='white'` | 纯白主题 |
| `dark` | `data-theme='dark'` | 深色主题 |
| `auto` | 跟随系统 | 自动切换 |

### 1.2 CSS 选择器规则
```scss
// 羊毛纸主题 (light) - 注意：light 主题没有 data-theme 属性
:root:not([data-theme]) {
  // ... 变量定义
}

// 纯白主题
[data-theme='white'] {
  // ... 变量定义
}

// 深色主题
[data-theme='dark'] {
  // ... 变量定义
}
```

## 2. CSS 变量规范

### 2.1 必须使用的变量

| 变量分类 | 变量名 | 说明 |
|---------|--------|------|
| **背景色** | `--bg-secondary` | 页面背景 |
| | `--bg-primary` | 卡片/容器背景 |
| | `--bg-tertiary` | hover/次级背景 |
| | `--bg-hover` | 悬停背景 |
| **文字色** | `--text-primary` | 主文字 |
| | `--text-secondary` | 次级文字 |
| | `--text-tertiary` | 辅助文字 |
| **边框色** | `--border-color` | 边框 |
| **阴影** | `--shadow` | 小阴影 |
| | `--shadow-lg` | 大阴影 |

### 2.2 禁止硬编码的颜色

```scss
// ❌ 禁止使用
background: #ffffff;
background: #000000;
background: rgba(20, 20, 20, 0.86);
color: #1a1a1a;
border: 1px solid #f0f0f0;

// ✅ 必须使用
background: var(--bg-primary);
color: var(--text-primary);
border: 1px solid var(--border-color);
```

## 3. 组件开发规范

### 3.1 卡片组件
```scss
.card {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: var(--shadow);
  
  &:hover {
    box-shadow: var(--shadow-lg);
  }
}
```

### 3.2 表格组件
```scss
.table {
  background: transparent;
  
  thead th {
    background: var(--bg-secondary);
    color: var(--text-primary);
    border-bottom: 2px solid var(--border-color);
  }
  
  tbody tr:nth-child(odd) {
    background: var(--bg-primary);
  }
  
  tbody tr:hover {
    background: var(--bg-hover);
  }
}
```

### 3.3 按钮组件
```scss
.btn-primary {
  background: var(--primary-color);
  color: var(--primary-contrast);
  
  &:hover {
    background: var(--primary-hover);
  }
}

.btn-secondary {
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}
```

### 3.4 输入框组件
```scss
.input {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  
  &:focus {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary-color) 20%, transparent);
  }
}
```

## 4. 图表/波形图规范

### 4.1 图表容器
```scss
.chartWrapper {
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
}

// 画布背景必须透明
.chartWrapper canvas,
.chartWrapper svg {
  background: transparent !important;
}
```

### 4.2 图表图例
```scss
.chartLegend {
  background: transparent;
  color: var(--text-secondary);
}
```

## 5. 状态颜色规范

### 5.1 主题变量（推荐）
```scss
--success-color: #10b981;
--error-color: #c65746;
--warning-color: #e0aa14;
```

### 5.2 徽章组件
```scss
.success-badge {
  color: var(--success-badge-text);
  background: var(--success-badge-bg);
  border: 1px solid var(--success-badge-border);
}

.failure-badge {
  color: var(--failure-badge-text);
  background: var(--failure-badge-bg);
  border: 1px solid var(--failure-badge-border);
}
```

## 6. SCSS 模块规范

### 6.1 命名约定
```scss
// 组件样式文件
ComponentName.module.scss

// 使用 CSS Modules
import styles from './ComponentName.module.scss';
```

### 6.2 主题覆盖写法
```scss
// ✅ 正确写法
.myComponent {
  background: var(--bg-primary);
  color: var(--text-primary);
}

// ❌ 错误写法
.myComponent {
  background: #ffffff;  // 硬编码！
  color: #2d2a26;
}
```

### 6.3 伪类选择器
```scss
.myComponent {
  // 默认状态
  background: var(--bg-primary);
  
  // 深色主题覆盖
  [data-theme='dark'] & {
    background: var(--bg-primary);
  }
  
  // 羊毛纸主题覆盖
  :root:not([data-theme]) & {
    background: var(--bg-primary);
  }
}
```

## 7. 新增主题步骤

### 7.1 添加主题变量
在 `src/styles/themes.scss` 中添加：
```scss
[data-theme='new-theme'] {
  --bg-secondary: #XXXXXX;
  --bg-primary: #XXXXXX;
  // ... 其他变量
}
```

### 7.2 更新主题切换逻辑
在 `src/stores/useThemeStore.ts` 的 `applyTheme` 函数中添加：
```typescript
if (resolved === 'new-theme') {
  document.documentElement.setAttribute('data-theme', 'new-theme');
  return;
}
```

### 7.3 更新主题顺序
在 `cycleTheme` 函数的 `order` 数组中添加新主题。

## 8. 检查清单

新增组件样式时必须检查：
- [ ] 所有背景色使用 CSS 变量
- [ ] 所有文字色使用 CSS 变量
- [ ] 所有边框色使用 CSS 变量
- [ ] 所有阴影使用 CSS 变量
- [ ] 深色主题下显示正常
- [ ] 羊毛纸主题下显示正常
- [ ] 纯白主题下显示正常

---

## 9. 快速检查脚本

### 检查 SCSS 文件中的硬编码颜色
```bash
# 检查是否有硬编码的十六进制颜色
rg '#([0-9a-fA-F]{3,6})' --type scss --glob '!node_modules' src/

# 检查是否有 rgba 硬编码背景
rg 'rgba\([0-9,.]+\)' --type scss --glob '!node_modules' src/ | grep -v 'var('

# 检查特定组件
rg 'background:\s*#[0-9a-fA-F]' --type scss src/components/usage/
```

### 运行 Stylelint 检查
```bash
npx stylelint --config .stylelintrc-theme.json "src/**/*.scss"
```

## 10. 常见问题

### Q: light 主题的选择器怎么写？
A: 使用 `:root:not([data-theme])` 而不是 `[data-theme='light']`

### Q: 硬编码颜色无法避免怎么办？
A: 只有在 CSS 变量尚未定义的特殊场景下允许，使用后需要在组件顶部添加注释说明。

### Q: 动态计算的深色值如何处理？
A: 使用 `color-mix()` 函数：
```scss
background: color-mix(in srgb, var(--bg-primary) 80%, transparent);
```

### Q: 图表画布背景如何处理？
A: 必须使用 `!important` 强制透明：
```scss
canvas {
  background: transparent !important;
}
```
