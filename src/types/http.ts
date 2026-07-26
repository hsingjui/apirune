import type { BodyType, HttpMethod, KeyValueItem } from "./request";

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
  /** 请求体原文；form 类为 KeyValueItem[] 的 JSON 串 */
  body?: string;
  auth?: AuthConfig;
  /** 超时时间（毫秒），默认 30000 */
  timeoutMs?: number;
}

/** 响应结果 */
export interface HttpResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  sizeBytes: number;
}
