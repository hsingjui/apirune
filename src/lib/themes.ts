import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types/settings";

/** 内置主题定义；具体令牌覆盖见 styles/global.css 的 [data-theme] 块 */
export interface ThemeDef {
  id: string;
  name: string;
  appearance: "light" | "dark";
  /** 设置面板迷你预览图配色 */
  preview: {
    canvas: string;
    side: string;
    line: string;
    accent: string;
  };
}

export const THEMES: ThemeDef[] = [
  {
    id: "light",
    name: "纸墨",
    appearance: "light",
    preview: { canvas: "#faf9f5", side: "#f0eee7", line: "#e3e0d6", accent: "#cc7c5e" },
  },
  {
    id: "dark",
    name: "暖夜",
    appearance: "dark",
    preview: { canvas: "#262521", side: "#302e29", line: "#4a463f", accent: "#cc7c5e" },
  },
  {
    id: "sage",
    name: "青瓷",
    appearance: "light",
    preview: { canvas: "#f5f7f2", side: "#e9eee4", line: "#dbe2d3", accent: "#5f8d63" },
  },
  {
    id: "ocean",
    name: "海雾",
    appearance: "light",
    preview: { canvas: "#f4f7f9", side: "#e8eef2", line: "#d8e1e8", accent: "#4f7fa3" },
  },
  {
    id: "night",
    name: "墨岩",
    appearance: "dark",
    preview: { canvas: "#1f2126", side: "#282b31", line: "#484d54", accent: "#8ba8d0" },
  },
  {
    id: "wisteria",
    name: "紫藤",
    appearance: "light",
    preview: { canvas: "#f7f5fa", side: "#eeeaf4", line: "#e1dbea", accent: "#7d6bae" },
  },
  {
    id: "rose",
    name: "胭脂",
    appearance: "light",
    preview: { canvas: "#faf6f5", side: "#f3eae8", line: "#ecdfdd", accent: "#c26473" },
  },
  {
    id: "forest",
    name: "松影",
    appearance: "dark",
    preview: { canvas: "#20241f", side: "#2a2f28", line: "#474e43", accent: "#92b888" },
  },
  {
    id: "plum",
    name: "暮紫",
    appearance: "dark",
    preview: { canvas: "#232028", side: "#2c2933", line: "#4b4656", accent: "#b3a1d6" },
  },
  {
    id: "tianshui",
    name: "天水碧",
    appearance: "light",
    preview: { canvas: "#f3f7f7", side: "#e5eeee", line: "#d3e2e2", accent: "#5aa4ae" },
  },
  {
    id: "zhehuang",
    name: "柘黄",
    appearance: "light",
    preview: { canvas: "#f7f4ea", side: "#efe9d9", line: "#e5dcc4", accent: "#c67915" },
  },
  {
    id: "luozidai",
    name: "螺子黛",
    appearance: "dark",
    preview: { canvas: "#1c2529", side: "#253034", line: "#435459", accent: "#87c0ca" },
  },
];

/** 字体选项：不打包字体文件，仅切换字体栈，缺失时按栈回退 */
export interface FontOption {
  id: string;
  name: string;
  stack: string;
}

export const UI_FONTS: FontOption[] = [
  {
    id: "system",
    name: "系统默认",
    stack:
      '"Inter", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  },
  {
    id: "serif",
    name: "衬线",
    stack:
      '"Newsreader", "Source Han Serif SC", "Songti SC", "STSong", "Noto Serif SC", Georgia, serif',
  },
  {
    id: "rounded",
    name: "圆体",
    stack: '"Yuanti SC", "YouYuan", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
];

export const MONO_FONTS: FontOption[] = [
  {
    id: "jetbrains",
    name: "JetBrains Mono",
    stack: '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
  },
  { id: "sf-mono", name: "SF Mono", stack: '"SF Mono", "SFMono-Regular", Menlo, monospace' },
  { id: "menlo", name: "Menlo", stack: "Menlo, Monaco, Consolas, monospace" },
  { id: "fira", name: "Fira Code", stack: '"Fira Code", "JetBrains Mono", Menlo, monospace' },
  { id: "cascadia", name: "Cascadia Code", stack: '"Cascadia Code", Menlo, Consolas, monospace' },
];

/** 系统字体家族，由 Rust 侧 list_font_families 命令扫描返回 */
export interface SystemFontFamily {
  name: string;
  monospaced: boolean;
  /** 是否覆盖当前界面语言的探测字符 */
  supportsText: boolean;
}

/** 各界面语言的字体探测字符：新增语言时在此登记 */
export const FONT_PROBES: Record<AppSettings["language"], string> = {
  "zh-CN": "永",
  "en-US": "Ag",
};

export function listFontFamilies(probe: string): Promise<SystemFontFamily[]> {
  return invoke<SystemFontFamily[]>("list_font_families", { probe });
}

/** 设置值为内置预设 id 时用其字体栈，否则视为系统字体家族名，缺失时回退到默认栈 */
export function resolveFontStack(id: string, presets: FontOption[]): string {
  const preset = presets.find((item) => item.id === id);
  if (preset) return preset.stack;
  return `"${id}", ${presets[0].stack}`;
}

/** 将主题与字体设置应用到文档根节点，启动时与设置变更时调用 */
export function applyAppearance(
  settings: Pick<AppSettings, "theme" | "uiFont" | "monoFont">,
): void {
  const root = document.documentElement;
  const theme = THEMES.find((item) => item.id === settings.theme) ?? THEMES[0];
  if (theme.id === THEMES[0].id) {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme.id;
  }
  /* 同步 color-scheme：原生表单控件（日期、复选框等）随主题明暗渲染 */
  root.style.colorScheme = theme.appearance;
  const uiFontStack = resolveFontStack(settings.uiFont, UI_FONTS);
  root.style.setProperty("--font-sans", uiFontStack);
  root.style.setProperty("--font-serif", uiFontStack);
  root.style.setProperty("--font-mono", resolveFontStack(settings.monoFont, MONO_FONTS));
}
