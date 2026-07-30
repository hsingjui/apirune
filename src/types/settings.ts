/** 代理模式 */
export type ProxyMode = "none" | "system" | "custom";

/** 自定义代理协议 */
export type ProxyProtocol = "http" | "https";

/** 应用设置，持久化在 localStorage */
export interface AppSettings {
  /** 内置主题 id，见 lib/themes.ts 的 THEMES */
  theme: string;
  /** 界面字体 id，见 lib/themes.ts 的 UI_FONTS */
  uiFont: string;
  /** 代码字体 id，见 lib/themes.ts 的 MONO_FONTS */
  monoFont: string;
  /** 界面缩放百分比：80–120 */
  uiScale: number;
  /** 圆角预设：sharp 4px / default 10px / round 16px */
  radius: "sharp" | "default" | "round";
  language: "zh-CN" | "en-US";
  /** 启动时恢复上次打开的项目标签 */
  restoreTabs: boolean;
  /** 请求超时毫秒数，0 表示不限制 */
  requestTimeoutMs: number;
  /** 发送请求时验证 SSL 证书 */
  sslVerify: boolean;
  /** 收到 3xx 响应时自动跟随重定向 */
  followRedirects: boolean;
  /** 自动附加 Cache-Control: no-cache 请求头 */
  noCacheHeader: boolean;
  proxyMode: ProxyMode;
  /** 自定义代理协议 */
  proxyProtocol: ProxyProtocol;
  /** 自定义代理服务器主机，如 127.0.0.1 */
  proxyHost: string;
  /** 自定义代理服务器端口，如 7890 */
  proxyPort: string;
  /** 代理是否应用于 HTTP 请求 */
  proxyForHttp: boolean;
  /** 代理是否应用于 HTTPS 请求 */
  proxyForHttps: boolean;
  /** 是否启用代理身份验证 */
  proxyAuthEnabled: boolean;
  proxyUsername: string;
  proxyPassword: string;
  /** 代理排除列表，逗号分隔 */
  proxyBypass: string;
}
