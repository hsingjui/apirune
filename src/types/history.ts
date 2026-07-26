import type { ResponseBodyEncoding } from "./http";
import type { BodyType, HttpMethod, KeyValueItem } from "./request";

/** 一条完整的请求历史（发送时的请求快照 + 响应结果） */
export interface HistoryEntry {
  id: string;
  projectId: string;
  /** 关联的已保存请求，快捷请求为 null */
  requestId: string | null;
  method: HttpMethod;
  url: string;
  params: KeyValueItem[];
  headers: KeyValueItem[];
  bodyType: BodyType;
  body: string;
  /** 响应状态码，请求失败（未收到响应）时为 null */
  status: number | null;
  /** 请求耗时（毫秒） */
  durationMs: number | null;
  responseHeaders: Record<string, string>;
  responseBody: string;
  /** 响应体编码：二进制响应以 Base64 存储 */
  responseBodyEncoding: ResponseBodyEncoding;
  /** 失败原因，成功时为 null */
  error: string | null;
  createdAt: number;
}

/** 历史列表项，不含请求体/响应体等大字段 */
export type HistoryEntrySummary = Omit<
  HistoryEntry,
  | "params"
  | "headers"
  | "bodyType"
  | "body"
  | "responseHeaders"
  | "responseBody"
  | "responseBodyEncoding"
>;

/** 记录一次发送。id 与 createdAt 由后端生成 */
export type AddHistoryInput = Omit<HistoryEntry, "id" | "createdAt">;
