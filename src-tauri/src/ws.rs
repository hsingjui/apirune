//! WebSocket 客户端：连接 / 发送 / 断开，收到的消息通过 Tauri 事件推送给前端。
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use base64::Engine as _;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::Emitter;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};
use tokio_tungstenite::tungstenite::Message;

use crate::http::KeyValueItem;

/// 推送给前端的连接事件；事件名固定为 "ws-event"，前端按 id 过滤
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WsEvent {
    id: String,
    /// message | closed | error
    kind: String,
    /// message 为消息内容；closed 为关闭原因；error 为错误信息
    data: String,
    /// message 是否为二进制（data 为 Base64）
    binary: bool,
}

/// 活跃连接的发送端：连接 id -> 待发消息通道
fn ws_senders() -> &'static Mutex<HashMap<String, tokio::sync::mpsc::UnboundedSender<Message>>> {
    static SENDERS: OnceLock<Mutex<HashMap<String, tokio::sync::mpsc::UnboundedSender<Message>>>> =
        OnceLock::new();
    SENDERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn emit_ws_event(app: &tauri::AppHandle, id: &str, kind: &str, data: String, binary: bool) {
    let _ = app.emit(
        "ws-event",
        WsEvent {
            id: id.to_string(),
            kind: kind.to_string(),
            data,
            binary,
        },
    );
}

/// 建立 WebSocket 连接；成功后消息与关闭 / 错误通过 "ws-event" 事件推送
#[tauri::command]
pub async fn ws_connect(
    app: tauri::AppHandle,
    id: String,
    url: String,
    headers: Vec<KeyValueItem>,
) -> Result<(), String> {
    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("URL 无效: {e}"))?;
    for item in headers.iter().filter(|h| h.enabled && !h.key.is_empty()) {
        let name: HeaderName = item
            .key
            .parse()
            .map_err(|e| format!("请求头名称无效 {}: {e}", item.key))?;
        let value: HeaderValue = item
            .value
            .parse()
            .map_err(|e| format!("请求头值无效 {}: {e}", item.key))?;
        request.headers_mut().insert(name, value);
    }

    let (stream, _response) = connect_async(request)
        .await
        .map_err(|e| format!("连接失败: {e}"))?;
    let (mut write, mut read) = stream.split();

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    ws_senders().lock().unwrap().insert(id.clone(), tx);

    // 发送泵：把 ws_send / ws_disconnect 投递的消息写入连接；Close 后结束并释放写半端
    tauri::async_runtime::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let is_close = matches!(msg, Message::Close(_));
            if write.send(msg).await.is_err() || is_close {
                break;
            }
        }
    });

    // 接收循环：Ping/Pong 由 tungstenite 自动应答，此处忽略
    tauri::async_runtime::spawn(async move {
        let mut notified = false;
        while let Some(next) = read.next().await {
            match next {
                Ok(Message::Text(text)) => {
                    emit_ws_event(&app, &id, "message", text.to_string(), false);
                }
                Ok(Message::Binary(data)) => {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&data);
                    emit_ws_event(&app, &id, "message", encoded, true);
                }
                Ok(Message::Close(frame)) => {
                    let reason = frame
                        .map(|f| format!("{} {}", u16::from(f.code), f.reason).trim().to_string())
                        .unwrap_or_default();
                    emit_ws_event(&app, &id, "closed", reason, false);
                    notified = true;
                    break;
                }
                Ok(_) => {}
                Err(e) => {
                    emit_ws_event(&app, &id, "error", e.to_string(), false);
                    notified = true;
                    break;
                }
            }
        }
        ws_senders().lock().unwrap().remove(&id);
        // 流结束但未收到关闭帧（如服务器直接断开 TCP）
        if !notified {
            emit_ws_event(&app, &id, "closed", String::new(), false);
        }
    });

    Ok(())
}

/// 向指定连接发送文本消息
#[tauri::command]
pub fn ws_send(id: String, message: String) -> Result<(), String> {
    let senders = ws_senders().lock().unwrap();
    let tx = senders.get(&id).ok_or("连接不存在或已断开")?;
    tx.send(Message::Text(message.into()))
        .map_err(|_| "发送失败：连接已断开".to_string())
}

/// 主动断开连接；连接不存在时静默忽略
#[tauri::command]
pub fn ws_disconnect(id: String) {
    if let Some(tx) = ws_senders().lock().unwrap().remove(&id) {
        let _ = tx.send(Message::Close(None));
    }
}
