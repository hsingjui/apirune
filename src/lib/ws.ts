import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { KeyValueItem } from "../types/request";
import type { WsEventPayload } from "../types/ws";

/** 建立 WebSocket 连接（由 Rust 后端执行）；成功后消息通过 "ws-event" 事件推送 */
export function wsConnect(id: string, url: string, headers: KeyValueItem[] = []): Promise<void> {
  return invoke("ws_connect", { id, url, headers });
}

/** 向指定连接发送文本消息；连接不存在时抛出错误信息字符串 */
export function wsSend(id: string, message: string): Promise<void> {
  return invoke("ws_send", { id, message });
}

/** 主动断开连接；连接不存在时后端静默忽略 */
export function wsDisconnect(id: string): Promise<void> {
  return invoke("ws_disconnect", { id });
}

/** 订阅后端推送的连接事件（所有连接共用一个事件名，按 payload.id 过滤） */
export function onWsEvent(handler: (event: WsEventPayload) => void): Promise<UnlistenFn> {
  return listen<WsEventPayload>("ws-event", (event) => handler(event.payload));
}
