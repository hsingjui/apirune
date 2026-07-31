import { Channel, invoke } from "@tauri-apps/api/core";
import type {
  HttpResponseData,
  ResponseBodyEncoding,
  SendRequestInput,
  SseEvent,
} from "../types/http";

/** 发送 HTTP 请求（由 Rust 后端执行，无跨域限制）。失败时抛出错误信息字符串。
 *  响应为 SSE（text/event-stream）时，后端边收边经 Channel 调用 onSse 逐条推送事件 */
export function sendHttpRequest(
  input: SendRequestInput,
  onSse?: (event: SseEvent) => void,
): Promise<HttpResponseData> {
  const channel = new Channel<SseEvent>();
  if (onSse) channel.onmessage = onSse;
  return invoke<HttpResponseData>("send_http_request", { input, onSse: channel });
}

/** 中断指定 cancelId 的进行中请求；请求不存在或已完成时后端静默忽略 */
export function cancelHttpRequest(cancelId: string): Promise<void> {
  return invoke("cancel_http_request", { cancelId });
}

/** 将响应体保存到本地文件；encoding 为 base64 时后端先解码为原始字节 */
export function saveResponseBody(
  path: string,
  body: string,
  encoding: ResponseBodyEncoding,
): Promise<void> {
  return invoke("save_response_body", { path, body, encoding });
}
