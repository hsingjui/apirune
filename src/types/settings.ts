/** 主题模式：当前仅实现浅色，深色规划中 */
export type ThemeMode = "light" | "dark";

/** 代理模式 */
export type ProxyMode = "none" | "system" | "custom";

/** 应用设置，持久化在 localStorage */
export interface AppSettings {
  themeMode: ThemeMode;
  /** 界面缩放百分比：80–120 */
  uiScale: number;
  language: "zh-CN" | "en-US";
  /** 启动时恢复上次打开的项目标签 */
  restoreTabs: boolean;
  /** 请求超时秒数，0 表示不限制 */
  requestTimeout: number;
  proxyMode: ProxyMode;
  /** 自定义代理服务器地址，如 http://127.0.0.1:7890 */
  proxyUrl: string;
  /** 代理排除列表，逗号分隔 */
  proxyBypass: string;
}
