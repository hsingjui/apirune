import type { ProxyConfig } from "../types/http";
import type { AppSettings } from "../types/settings";

export const SETTINGS_STORAGE_KEY = "apirune:settings";

/** 检测系统语言：中文环境返回 zh-CN，其余返回 en-US */
export function detectSystemLanguage(): AppSettings["language"] {
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  uiFont: "system",
  monoFont: "jetbrains",
  uiScale: 100,
  language: detectSystemLanguage(),
  restoreTabs: true,
  requestTimeoutMs: 300_000,
  sslVerify: true,
  followRedirects: true,
  noCacheHeader: false,
  proxyMode: "none",
  proxyProtocol: "http",
  proxyHost: "",
  proxyPort: "",
  proxyForHttp: true,
  proxyForHttps: true,
  proxyAuthEnabled: false,
  proxyUsername: "",
  proxyPassword: "",
  proxyBypass: "localhost, 127.0.0.1",
};

/** 读取当前设置；与默认值合并，兼容旧版本缺失的字段 */
export function loadSettings(): AppSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed =
      raw == null ? {} : (JSON.parse(raw) as Partial<AppSettings> & { proxyUrl?: string });
    // 首次启动或旧版本缺失语言字段时，按系统语言写入默认语言并持久化
    if (parsed.language == null) {
      parsed.language = DEFAULT_SETTINGS.language;
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed));
    }
    // 迁移旧版本的 proxyUrl（protocol://host:port）到拆分后的字段
    if (parsed.proxyUrl && parsed.proxyHost == null) {
      const match = /^(?:(https?):\/\/)?([^:/\s]+)(?::(\d+))?/.exec(parsed.proxyUrl.trim());
      if (match) {
        parsed.proxyProtocol = match[1] === "https" ? "https" : "http";
        parsed.proxyHost = match[2];
        parsed.proxyPort = match[3] ?? "";
      }
    }
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** 根据设置生成随请求发送的代理配置 */
export function toProxyConfig(settings: AppSettings): ProxyConfig {
  if (settings.proxyMode !== "custom") return { mode: settings.proxyMode };
  const host = settings.proxyHost.trim();
  const port = settings.proxyPort.trim();
  return {
    mode: "custom",
    url: host ? `${settings.proxyProtocol}://${host}${port ? `:${port}` : ""}` : "",
    forHttp: settings.proxyForHttp,
    forHttps: settings.proxyForHttps,
    username: settings.proxyAuthEnabled ? settings.proxyUsername : "",
    password: settings.proxyAuthEnabled ? settings.proxyPassword : "",
    bypass: settings.proxyBypass,
  };
}
