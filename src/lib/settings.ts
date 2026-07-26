import type { AppSettings } from "../types/settings";

export const SETTINGS_STORAGE_KEY = "apirune:settings";

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: "light",
  uiScale: 100,
  language: "zh-CN",
  restoreTabs: true,
  requestTimeout: 30,
  proxyMode: "none",
  proxyUrl: "",
  proxyBypass: "localhost, 127.0.0.1",
};

/** 读取当前设置；与默认值合并，兼容旧版本缺失的字段 */
export function loadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw == null) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
