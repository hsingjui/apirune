import { invoke } from "@tauri-apps/api/core";
import type { HttpResponseData, SendRequestInput } from "../types/http";

/** 发送 HTTP 请求（由 Rust 后端执行，无跨域限制）。失败时抛出错误信息字符串 */
export function sendHttpRequest(input: SendRequestInput): Promise<HttpResponseData> {
  return invoke<HttpResponseData>("send_http_request", { input });
}
