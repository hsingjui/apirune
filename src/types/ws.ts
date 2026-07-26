/** WebSocket 连接事件，由后端通过 "ws-event" 事件推送 */
export interface WsEventPayload {
  /** 连接标识，前端建立连接时生成 */
  id: string;
  /** message 收到消息 / closed 连接关闭 / error 连接出错 */
  kind: "message" | "closed" | "error";
  /** message 为消息内容；closed 为关闭原因（可为空）；error 为错误信息 */
  data: string;
  /** message 是否为二进制（data 为 Base64） */
  binary: boolean;
}
