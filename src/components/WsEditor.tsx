import { Eraser, Loader2, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getLanguage, t, useI18n } from "../i18n";
import { onWsEvent, wsConnect, wsDisconnect, wsSend } from "../lib/ws";
import { createId } from "../utils/id";
import "./WsEditor.css";

/** WS 标识色（与请求方法标识色同源的 Arco 色板） */
export const WS_COLOR = "#0fc6c2";

/** 消息方向：out 已发送 / in 已接收 / sys 系统提示 */
type WsDirection = "in" | "out" | "sys";

interface WsMessage {
  dir: WsDirection;
  text: string;
  time: number;
  /** 收到的二进制消息（text 为 Base64） */
  binary?: boolean;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(getLanguage(), { hour12: false });
}

/** WebSocket 调试面板：连接地址 + 消息记录 + 发送区 */
export default function WsEditor() {
  useI18n();
  const [url, setUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<WsMessage[]>([]);
  const [draft, setDraft] = useState("");
  // 连接标识：组件生命周期内固定，后端按它路由事件
  const connIdRef = useRef(createId());
  const logRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const pushMessage = (dir: WsDirection, text: string, binary?: boolean) => {
    setMessages((prev) => [...prev, { dir, text, time: Date.now(), binary }]);
  };

  // 订阅后端连接事件（按连接 id 过滤）；卸载时取消订阅并断开连接
  // biome-ignore lint/correctness/useExhaustiveDependencies: pushMessage 仅用函数式 setState，无需进入依赖
  useEffect(() => {
    const id = connIdRef.current;
    const unlistenPromise = onWsEvent((event) => {
      if (event.id !== id) return;
      if (event.kind === "message") {
        pushMessage("in", event.data, event.binary);
      } else if (event.kind === "closed") {
        setConnected(false);
        pushMessage(
          "sys",
          event.data ? t("ws.closedWithReason", { reason: event.data }) : t("ws.closed"),
        );
      } else {
        setConnected(false);
        pushMessage("sys", t("ws.connError", { error: event.data }));
      }
    });
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
      void wsDisconnect(id);
    };
  }, []);

  // 新消息时滚动到底部
  // biome-ignore lint/correctness/useExhaustiveDependencies: messages 作为触发器，新消息时滚到底部
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleConnect = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      toast.warning(t("ws.enterUrlFirst"));
      urlInputRef.current?.focus();
      return;
    }
    // 未写协议时默认 ws://
    const target = /^wss?:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
    setConnecting(true);
    try {
      await wsConnect(connIdRef.current, target);
      setConnected(true);
      pushMessage("sys", t("ws.connectedTo", { url: target }));
    } catch (err) {
      toast.error(String(err));
      pushMessage("sys", `${t("ws.connectFailed")}: ${err}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = () => {
    // 不立即置为未连接：等后端 closed 事件回执，避免漏记关闭原因
    void wsDisconnect(connIdRef.current);
  };

  const handleSend = async () => {
    if (!connected || !draft.trim()) return;
    try {
      await wsSend(connIdRef.current, draft);
      pushMessage("out", draft);
      setDraft("");
    } catch (err) {
      toast.error(String(err));
    }
  };

  return (
    <div className="ws-editor">
      {/* 连接行：WS 徽标 + 地址 + 连接/断开 */}
      <div className="ws-line">
        <div className="ws-url-group">
          <span className="ws-method" style={{ color: WS_COLOR }}>
            WS
          </span>
          <input
            ref={urlInputRef}
            className="ws-url"
            placeholder={t("ws.urlPlaceholder")}
            aria-label={t("ws.urlAria")}
            value={url}
            disabled={connected || connecting}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !connected && !connecting) void handleConnect();
            }}
          />
        </div>
        {connected ? (
          <Button variant="outline" onClick={handleDisconnect}>
            {t("ws.disconnect")}
          </Button>
        ) : (
          <Button disabled={connecting} onClick={() => void handleConnect()}>
            {connecting && <Loader2 className="ws-connecting-spinner" aria-hidden="true" />}
            {connecting ? t("ws.connecting") : t("ws.connect")}
          </Button>
        )}
      </div>

      {/* 消息记录 */}
      <div className="ws-log-header">
        <span className={`ws-status${connected ? " is-connected" : ""}`}>
          <span className="ws-status-dot" aria-hidden="true" />
          {connected ? t("ws.statusConnected") : t("ws.statusDisconnected")}
        </span>
        <button
          type="button"
          className="ws-clear"
          disabled={messages.length === 0}
          onClick={() => setMessages([])}
        >
          <Eraser aria-hidden="true" />
          {t("ws.clear")}
        </button>
      </div>
      <div ref={logRef} className="ws-log" role="log">
        {messages.length === 0 ? (
          <div className="ws-log-empty">{t("ws.empty")}</div>
        ) : (
          messages.map((message, index) => (
            <div key={index} className={`ws-message ws-message-${message.dir}`}>
              <span className="ws-message-meta">
                <span className="ws-message-dir">
                  {message.dir === "out" ? "↑" : message.dir === "in" ? "↓" : "•"}
                </span>
                <span className="ws-message-time">{formatTime(message.time)}</span>
                {message.binary && <span className="ws-message-binary">{t("ws.binaryTag")}</span>}
              </span>
              <pre className="ws-message-text">{message.text}</pre>
            </div>
          ))
        )}
      </div>

      {/* 发送区 */}
      <div className="ws-composer">
        <textarea
          className="ws-composer-input"
          placeholder={t("ws.messagePlaceholder")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button disabled={!connected || !draft.trim()} onClick={() => void handleSend()}>
          <SendHorizontal />
          {t("ws.send")}
        </Button>
      </div>
    </div>
  );
}
