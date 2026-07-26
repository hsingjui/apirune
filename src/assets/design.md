# Claude (Editorial) UI 风格

**设计代号**：Warm Rationality (温暖的理性)

**核心美学**：纸质感、衬线体、低对比度、阅读导向。

**核心哲学**：像阅读一本排版精美的实体书一样使用软件，消除数字工具带来的焦躁感与“数码味”。

## 1. 色彩系统 (Color System)

彻底抛弃传统的纯白（`#FFF`）与纯黑（`#000`）。这套配色方案模拟了自然光下的阅读体验。

### 🎨 核心色板 (Palette)

|                    |                |              |                                                      |
| ------------------ | -------------- | ------------ | ---------------------------------------------------- |
| **语义名称**       | **色值 (HEX)** | **视觉描述** | **使用场景**                                         |
| **Canvas (画布)**  | `#FAF9F5`      | 暖米纸色     | 整个网页的 `<body >` 背景。绝对核心，奠定纸张感。    |
| **Surface (表面)** | `#F0EEE7`      | 白烟/暖卡其  | 侧边栏、对话气泡、代码块背景、引用块底色。           |
| **Surface High**   | `#FFFFFF`      | 纯白高亮层   | 必须在 Canvas 衬托下使用，用于核心输入框、独立卡片。 |
| **Accent (强调)**  | `#CC7C5E`      | 焦陶色/赤土  | 按钮、光标 (Caret)、图标高亮、链接悬停。             |
| **Ink (墨色)**     | `#38352F`      | 深暖炭色     | 正文、主标题。切勿使用纯黑，带有温度的深灰。         |

### 🌗 辅助色板 (Utility)

- **Secondary Text**: `#736F68` (中性暖灰) - 用于副标题、注释、时间戳。
- **Border (边框)**: `#E3E0D6` (沙色) - 用于极细分割线、卡片描边。
- **Focus Ring**: `rgba(204, 124, 94, 0.25)` - 陶土色的淡光晕，用于输入框聚焦。
- **Selection**: `rgba(204, 124, 94, 0.15)` - 用户选中文本时的背景色。

## 2. 字体排印 (Typography)

Claude 风格在字体上呈现“古典与现代的二元对立”。

### 🔤 字体家族 (Font Family)

- **标题 (Serif)**: 推荐 `Newsreader` (Google Fonts) 或 `Merriweather`。必须是衬线体，要有书卷气。
- **正文 (Sans)**: 推荐 `Inter` 或 `system-ui`。干净、几何感、中性，保证长时间阅读不累。
- **代码 (Mono)**: 推荐 `JetBrains Mono` 或 `Fira Code`。

### 📏 排版参数 (Typesetting Rules)

- **H1/H2 (主标题)**:
  - **Weight: 400 (Regular)** —— **关键点**：标题不要加粗，要显轻盈古典。
  - **Letter-spacing**: `-0.03em` (紧凑，增强图形感)。
- **Body (正文)**:
  - **Line-height: 1.65 (宽松)** —— 增加行高是营造“高级排版感”的最廉价方式。
  - **Color**: 使用 `#38352F` (Ink)。

## 3. UI 物理质感与细节 (UI Physics & Micro-details)

### 🔲 形状与圆角 (Radius)

追求温润，但不是圆滚滚的玩具感。

- **卡片/容器**: `12px` 到 `16px` (配合 `#F0EEE7` 背景)。
- **悬浮栏/徽章**: `9999px` (全圆角/胶囊状)。
- **按钮/输入框**: `8px` 到 `12px`。

### 💡 阴影 (Shadows)

**原则：几乎看不见。阴影不是为了“悬浮”，而是为了“体积感”。**

- **Ambient Shadow**: `0 2px 8px rgba(56, 53, 47, 0.06)`
- _解释_: 必须使用暖色调（RGB 56, 53, 47 的墨色）作为阴影基色，而非默认的纯黑阴影。

### ✨ 灵魂微交互 (The Magic Details)

1. **输入框光标 (Caret)**: 必须是焦陶色。`caret-color: var(--c-accent);`
2. **选中文字 (Selection)**: 覆盖浏览器默认的蓝色，改为焦陶色的超淡底色。
3. **动效节奏 (Timing)**: 所有 hover 和 focus 动画使用 `300ms ease-out`，钝化弹簧感。

## 4. 开发者交付标准 (Developer Handoff)

### 方案 A：原生 CSS 变量 (Global Styles)

复制以下代码到你的全局 `index.css` 或 `global.css` 中，奠定设计地基：

```
:root {
  /* 1. Surfaces (背景层级) */
  --c-canvas: #faf9f5;
  --c-surface: #f0eee7;
  --c-surface-high: #ffffff;

  /* 2. Ink (文字墨色) */
  --c-ink-primary: #38352f;
  --c-ink-secondary: #736f68;
  --c-ink-tertiary: #9e9a93;

  /* 3. Brand & Action (品牌色) */
  --c-accent: #cc7c5e;
  --c-accent-hover: #b56b50;
  --c-accent-faint: rgba(204, 124, 94, 0.15);
  --c-focus-ring: rgba(204, 124, 94, 0.25);

  /* 4. Boundaries (边界) */
  --c-border: #e3e0d6;

  /* Fonts & Shadows */
  --font-serif: "Newsreader", "Merriweather", serif;
  --shadow-subtle: 0 1px 2px rgba(56, 53, 47, 0.04);
  --shadow-float: 0 4px 12px rgba(56, 53, 47, 0.08);
}

/* 核心全局重置 */
body {
  background-color: var(--c-canvas);
  color: var(--c-ink-primary);
  font-family: "Inter", system-ui, sans-serif;
}

/* 覆盖原生高亮色 */
::selection {
  background-color: var(--c-accent-faint);
  color: var(--c-ink-primary);
}

/* 标题去粗体化 */
h1, h2, h3 {
  font-family: var(--font-serif);
  font-weight: 400;
  letter-spacing: -0.03em;
}

/* 焦陶色光标 */
input, textarea {
  caret-color: var(--c-accent);
}
```

### 方案 B：Tailwind CSS 配置映射 (tailwind.config.js)

如果你使用 Tailwind，请将以上色值注入到你的 `tailwind.config.js` 中，以便使用如 `bg-canvas`, `text-ink`, `ring-accent-faint` 等语义化类名。

```
/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {
        canvas: '#FAF9F5',
        surface: {
          DEFAULT: '#F0EEE7',
          high: '#FFFFFF',
        },
        ink: {
          DEFAULT: '#38352F',
          secondary: '#736F68',
          tertiary: '#9E9A93',
        },
        accent: {
          DEFAULT: '#CC7C5E',
          hover: '#B56B50',
          faint: 'rgba(204, 124, 94, 0.15)',
          ring: 'rgba(204, 124, 94, 0.25)',
        },
        sand: '#E3E0D6', // 用于 Border
      },
      fontFamily: {
        serif: ['Newsreader', 'Merriweather', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'subtle': '0 1px 2px rgba(56, 53, 47, 0.04)',
        'float': '0 4px 12px rgba(56, 53, 47, 0.08)',
      }
    },
  },
}
```

## 5. 终极复刻自检清单 (Checklist)

在开发或验收时，请对照此表进行灵魂拷问：

- [ ] **背景色检查**：页面底色是 `#FAF9F5`（暖米纸）吗？如果误用了纯白 `#FFF`，质感会立刻掉档变成普通后台。
- [ ] **标题排版检查**：大标题使用了 **Serif (衬线体)** 吗？字重（Weight）是不是克制在 `400 (Regular)` 而没有盲目加粗？
- [ ] **文本色检查**：正文颜色是 `#38352F`（深暖炭色）吗？绝对不能出现纯黑 `#000`。
- [ ] **光标与选中态**：在输入框打字时，闪烁的光标（Caret）是焦陶色（红棕色）吗？鼠标拖拽选中文本时，背景色是淡橙色吗？
- [ ] **阴影基色检查**：卡片阴影是暖灰色的吗？（必须使用带 RGB 值的暖色调，而非默认的黑灰色阴影）。
