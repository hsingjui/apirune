import { useSyncExternalStore } from "react";
import { loadSettings } from "../lib/settings";
import { enUS } from "./en-US";
import { zhCN } from "./zh-CN";

export type Language = "zh-CN" | "en-US";

const DICTS: Record<Language, Record<string, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

// 启动时从设置读取语言；之后由设置页调用 setLanguage 切换
let current: Language = loadSettings().language === "en-US" ? "en-US" : "zh-CN";

const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

/** 切换界面语言并通知所有订阅组件重新渲染 */
export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  for (const listener of listeners) listener();
}

/** 取当前语言的文案；支持 {name} 占位参数，缺失 key 时回退中文再回退 key */
export function t(key: string, params?: Record<string, string | number>): string {
  let message = DICTS[current][key] ?? DICTS["zh-CN"][key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      message = message.split(`{${name}}`).join(String(value));
    }
  }
  return message;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 组件内使用：订阅语言变化，切换语言时自动重渲染 */
export function useI18n(): { t: typeof t; language: Language } {
  useSyncExternalStore(subscribe, getLanguage);
  return { t, language: current };
}
