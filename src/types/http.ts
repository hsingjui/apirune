import type { BodyType, HttpMethod, KeyValueItem } from "./request";
import type { ProxyMode } from "./settings";

/** 代理配置，随请求发送给后端：mode 为 custom 时其余字段生效 */
export interface ProxyConfig {
  mode: ProxyMode;
  /** 自定义代理地址，如 http://127.0.0.1:7890 */
  url?: string;
  /** 代理是否应用于 HTTP 请求 */
  forHttp?: boolean;
  /** 代理是否应用于 HTTPS 请求 */
  forHttps?: boolean;
  /** 身份验证，用户名为空表示不验证 */
  username?: string;
  password?: string;
  /** 排除列表，逗号分隔 */
  bypass?: string;
}

/** 认证方式 */
export type AuthType = "none" | "bearer" | "basic" | "api-key";

/** 认证配置：authType 决定使用哪些字段 */
export interface AuthConfig {
  authType: AuthType;
  /** bearer */
  token?: string;
  /** basic */
  username?: string;
  password?: string;
  /** api-key */
  key?: string;
  value?: string;
  addTo?: "header" | "query";
}

/** 一次请求的完整配置，对应后端 send_http_request 的入参 */
export interface SendRequestInput {
  method: HttpMethod;
  url: string;
  params?: KeyValueItem[];
  headers?: KeyValueItem[];
  bodyType?: BodyType;
  /** 请求体原文；form 类为 FormField[] 的 JSON 串 */
  body?: string;
  auth?: AuthConfig;
  /** 代理配置，缺省使用系统代理 */
  proxy?: ProxyConfig;
  /** 超时时间（毫秒），0 表示不限制，默认 300000 */
  timeoutMs?: number;
  /** 发送请求时验证 SSL 证书，默认验证 */
  sslVerify?: boolean;
  /** 收到 3xx 响应时自动跟随重定向，默认跟随 */
  followRedirects?: boolean;
  /** 自动附加 Cache-Control: no-cache 请求头 */
  noCacheHeader?: boolean;
  /** 会话 Cookie jar 标识（项目 id）；有值时后端自动记住并回发该会话的 Cookie */
  cookieJarId?: string;
  /** 取消标识；有值时可通过 cancelHttpRequest 中断该请求 */
  cancelId?: string;
}

/** 响应体编码：文本原样；二进制（非 UTF-8）为 Base64 */
export type ResponseBodyEncoding = "text" | "base64";

/** 响应结果 */
export interface HttpResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  /** body 的编码方式 */
  bodyEncoding: ResponseBodyEncoding;
  durationMs: number;
  sizeBytes: number;
  /** 实际发出的请求方法 / URL（含 Query）/ 请求头 */
  requestMethod: string;
  requestUrl: string;
  requestHeaders: Record<string, string>;
  /** 是否为 SSE（text/event-stream）流式响应，事件已经 Channel 逐条推送 */
  isEventStream?: boolean;
}

/** SSE 流式事件，后端经 Channel 逐条推送 */
export interface SseEvent {
  /** open（已连接）/ message（收到事件）/ error（流中断）/ close（已断开连接） */
  kind: "open" | "message" | "error" | "close";
  /** SSE event 字段，空为缺省的 message */
  event: string;
  /** open 为连接 URL；message 为 data 字段；error 为错误信息 */
  data: string;
  /** 事件时刻（Unix 毫秒） */
  timestampMs: number;
}
