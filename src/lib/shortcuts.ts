import type { ShortcutAction, ShortcutConfig } from "../types/shortcuts";

export const SHORTCUT_STORAGE_KEY = "apirune:shortcuts";
export const SHORTCUT_EVENT = "apirune:shortcut";

/** 是否为 macOS：决定默认修饰键（⌘/Ctrl）与按键符号展示 */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.platform.toUpperCase().includes("MAC");
}

/** 当前平台的主修饰键：macOS 为 ⌘(meta)，其余平台为 Ctrl */
export const MOD = isMac() ? "meta" : "ctrl";

/** 快捷键定义，按设置页分组展示；分组名取文案 `shortcuts.group.{key}`，动作名取 `shortcuts.{action}` */
export const SHORTCUT_GROUPS: { key: string; items: ShortcutAction[] }[] = [
  { key: "api", items: ["newRequest", "sendRequest", "saveRequest", "importCurl", "globalSearch"] },
  { key: "tabs", items: ["closeTab", "nextTab", "prevTab"] },
  { key: "general", items: ["newProject", "refresh", "openSettings"] },
];

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
  enabled: true,
  bindings: {
    newRequest: `${MOD}+t`,
    sendRequest: `${MOD}+Enter`,
    saveRequest: `${MOD}+s`,
    importCurl: `${MOD}+i`,
    globalSearch: `${MOD}+k`,
    closeTab: `${MOD}+w`,
    nextTab: `${MOD}+alt+ArrowRight`,
    prevTab: `${MOD}+alt+ArrowLeft`,
    newProject: `${MOD}+n`,
    refresh: `${MOD}+r`,
    openSettings: `${MOD}+,`,
  },
};

/** 读取快捷键配置；与默认值合并，兼容旧版本缺失的字段 */
export function loadShortcuts(): ShortcutConfig {
  try {
    const raw = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
    if (raw == null) return DEFAULT_SHORTCUTS;
    const parsed = JSON.parse(raw) as Partial<ShortcutConfig>;
    return {
      ...DEFAULT_SHORTCUTS,
      ...parsed,
      bindings: { ...DEFAULT_SHORTCUTS.bindings, ...parsed.bindings },
    };
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

// 设置页录制快捷键时暂停全局监听，避免录制过程误触发动作
let recording = false;
export const setShortcutRecording = (value: boolean) => {
  recording = value;
};
export const isShortcutRecording = () => recording;

interface KeyLike {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** 从键盘事件生成组合键字符串；仅按下修饰键时返回 null */
export function comboFromEvent(event: KeyLike): string | null {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return null;
  const parts: string[] = [];
  if (event.metaKey) parts.push("meta");
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  // macOS 上 ⌥/⇧ 会改变 event.key（如 ⌥N → "˜"），字母和数字改用 code 保持稳定
  let key: string;
  if (event.code.startsWith("Key")) key = event.code.slice(3).toLowerCase();
  else if (event.code.startsWith("Digit")) key = event.code.slice(5);
  else key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  parts.push(key);
  return parts.join("+");
}

/** 组合键是否包含 ⌘/⌃/⌥（录制时要求，避免与正常输入冲突） */
export function hasModifier(combo: string): boolean {
  return /(?:meta|ctrl|alt)\+/.test(combo);
}

// 修饰键与功能键的展示符号：macOS 用图形符号，其余平台用文字，更符合各自习惯
const KEY_LABELS: Record<string, string> = isMac()
  ? {
      meta: "⌘",
      ctrl: "⌃",
      alt: "⌥",
      shift: "⇧",
      Enter: "↩",
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Backspace: "⌫",
      Escape: "Esc",
      " ": "Space",
    }
  : {
      meta: "Win",
      ctrl: "Ctrl",
      alt: "Alt",
      shift: "Shift",
      Enter: "Enter",
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
      Backspace: "Backspace",
      Escape: "Esc",
      " ": "Space",
    };

/** 组合键字符串 → 用于展示的按键符号列表 */
export function formatCombo(combo: string): string[] {
  return combo.split("+").map((part) => KEY_LABELS[part] ?? part.toUpperCase());
}
