//! 核心发请求能力：接收前端的完整请求配置，发出 HTTP 请求并返回响应。
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use base64::Engine as _;
use reqwest::cookie::Jar;
use reqwest::header::{CACHE_CONTROL, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

/// 键值对条目，对应前端的 KeyValueItem（Query 参数 / 请求头 / 表单）
#[derive(Deserialize)]
pub struct KeyValueItem {
    pub key: String,
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// 表单字段条目，对应前端的 FormField（form 类请求体）
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormField {
    pub key: String,
    /// text 的字段值；file 为文件绝对路径
    #[serde(default)]
    pub value: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// text（缺省）/ file / array
    #[serde(default)]
    pub field_type: String,
    /// array 类型的多个值，同名 key 重复发送
    #[serde(default)]
    pub values: Vec<String>,
}

/// 认证配置：auth_type 决定使用哪些字段
/// - bearer: token
/// - basic: username / password
/// - api-key: key / value / add_to ("header" | "query")
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AuthConfig {
    pub auth_type: String,
    pub token: String,
    pub username: String,
    pub password: String,
    pub key: String,
    pub value: String,
    pub add_to: String,
}

/// 代理配置：mode 为 system / none / custom，custom 时其余字段生效
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxyConfig {
    pub mode: String,
    /// 自定义代理地址，如 http://127.0.0.1:7890
    pub url: String,
    /// 代理是否应用于 HTTP / HTTPS 请求
    pub for_http: bool,
    pub for_https: bool,
    /// 身份验证，用户名为空表示不验证
    pub username: String,
    pub password: String,
    /// 排除列表，逗号分隔
    pub bypass: String,
}

/// 一次请求的完整配置
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequestInput {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub params: Vec<KeyValueItem>,
    #[serde(default)]
    pub headers: Vec<KeyValueItem>,
    /// none | json | form-data | x-www-form-urlencoded | raw
    #[serde(default)]
    pub body_type: String,
    /// 请求体原文；form 类为 FormField[] 的 JSON 串
    #[serde(default)]
    pub body: String,
    pub auth: Option<AuthConfig>,
    /// 代理配置，缺省跟随系统代理
    pub proxy: Option<ProxyConfig>,
    /// 超时毫秒数，0 表示不限制，缺省 300000
    pub timeout_ms: Option<u64>,
    /// 发送请求时验证 SSL 证书，缺省验证
    #[serde(default = "default_true")]
    pub ssl_verify: bool,
    /// 收到 3xx 响应时自动跟随重定向，缺省跟随
    #[serde(default = "default_true")]
    pub follow_redirects: bool,
    /// 自动附加 Cache-Control: no-cache 请求头
    #[serde(default)]
    pub no_cache_header: bool,
    /// 会话 Cookie jar 标识（项目 id）；有值时自动记住并回发该会话的 Cookie
    #[serde(default)]
    pub cookie_jar_id: Option<String>,
    /// 取消标识；有值时可通过 cancel_http_request 中断该请求
    #[serde(default)]
    pub cancel_id: Option<String>,
}

/// 响应结果
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequestOutput {
    pub status: u16,
    pub status_text: String,
    pub headers: BTreeMap<String, String>,
    /// 响应体：文本原样返回；二进制（非 UTF-8）以 Base64 编码返回
    pub body: String,
    /// body 的编码方式：text | base64
    pub body_encoding: String,
    pub duration_ms: u64,
    pub size_bytes: usize,
    /// 实际发出的请求方法 / URL（含 Query）/ 请求头，供前端“实际请求”页签展示
    pub request_method: String,
    pub request_url: String,
    pub request_headers: BTreeMap<String, String>,
    /// 是否为 SSE（text/event-stream）流式响应，事件已经 Channel 逐条推送
    pub is_event_stream: bool,
}

/// SSE 流式事件，经 Channel 逐条推送给前端
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SseEvent {
    /// open（已连接）/ message（收到事件）/ error（流中断）/ close（已断开连接）
    pub kind: String,
    /// SSE event 字段，缺省为空（即 message）
    pub event: String,
    /// open 为连接 URL；message 为 data 字段；error 为错误信息
    pub data: String,
    /// 事件时刻（Unix 毫秒），前端时间线展示用
    pub timestamp_ms: u64,
}

impl SseEvent {
    fn now(kind: &str, event: &str, data: String) -> Self {
        let timestamp_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64);
        Self { kind: kind.into(), event: event.into(), data, timestamp_ms }
    }
}

/// 在缓冲区中查找首个事件分隔空行（\n\n 或 \r\n\r\n），返回（记录结束位置, 分隔符长度）
fn find_sse_boundary(buf: &[u8]) -> Option<(usize, usize)> {
    let lf = buf.windows(2).position(|w| w == b"\n\n").map(|p| (p, 2));
    let crlf = buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| (p, 4));
    match (lf, crlf) {
        (Some(a), Some(b)) => Some(if a.0 <= b.0 { a } else { b }),
        (a, b) => a.or(b),
    }
}

/// 解析单个 SSE 事件块，返回（event 字段, data 字段）；无 data 的块（如注释心跳）返回 None
fn parse_sse_record(record: &str) -> Option<(String, String)> {
    let mut event = String::new();
    let mut data: Vec<&str> = Vec::new();
    for line in record.lines() {
        if line.starts_with(':') {
            continue; // 注释行（常用作心跳）
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line, ""),
        };
        match field {
            "event" => event = value.to_string(),
            "data" => data.push(value),
            _ => {}
        }
    }
    if data.is_empty() {
        return None;
    }
    Some((event, data.join("\n")))
}

/// 流式读取 SSE 响应体：按空行切分事件块并经 Channel 逐条推送，返回完整原始字节。
/// 流中断（超时 / 网络错误）时推送 error 事件并返回已收到的内容。
async fn stream_sse_body(
    response: &mut reqwest::Response,
    channel: &Channel<SseEvent>,
    request_url: &str,
) -> Vec<u8> {
    let _ = channel.send(SseEvent::now("open", "", request_url.to_string()));
    let mut raw: Vec<u8> = Vec::new();
    let mut parsed = 0; // raw 中已解析完的字节数
    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                raw.extend_from_slice(&chunk);
                while let Some((end, sep)) = find_sse_boundary(&raw[parsed..]) {
                    let record = String::from_utf8_lossy(&raw[parsed..parsed + end]).into_owned();
                    parsed += end + sep;
                    if let Some((event, data)) = parse_sse_record(&record) {
                        let _ = channel.send(SseEvent::now("message", &event, data));
                    }
                }
            }
            Ok(None) => break,
            Err(e) => {
                let _ = channel.send(SseEvent::now("error", "", e.to_string()));
                break;
            }
        }
    }
    // 末尾不完整块（服务端可能不以空行收尾）也尝试解析
    if parsed < raw.len() {
        let record = String::from_utf8_lossy(&raw[parsed..]).into_owned();
        if let Some((event, data)) = parse_sse_record(&record) {
            let _ = channel.send(SseEvent::now("message", &event, data));
        }
    }
    // 流结束（正常关闭或中断）后推送已断开事件
    let _ = channel.send(SseEvent::now("close", "", String::new()));
    raw
}

/// 过滤出启用且 key 非空的条目
fn enabled_items(items: &[KeyValueItem]) -> impl Iterator<Item = &KeyValueItem> {
    items.iter().filter(|item| item.enabled && !item.key.is_empty())
}

/// 过滤出启用且 key 非空的表单字段
fn enabled_fields(items: &[FormField]) -> impl Iterator<Item = &FormField> {
    items.iter().filter(|item| item.enabled && !item.key.is_empty())
}

/// 解析 form 类请求体（FormField[] 的 JSON 串）
fn parse_form_body(body: &str) -> Result<Vec<FormField>, String> {
    if body.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(body).map_err(|e| format!("表单请求体解析失败: {e}"))
}

/// 用户是否已手动指定了 Content-Type
fn has_content_type(headers: &[KeyValueItem]) -> bool {
    enabled_items(headers).any(|h| h.key.eq_ignore_ascii_case("content-type"))
}

/// Client 级基础配置（证书校验 / 重定向策略）
fn base_builder(ssl_verify: bool, follow_redirects: bool) -> reqwest::ClientBuilder {
    let mut builder = reqwest::Client::builder().danger_accept_invalid_certs(!ssl_verify);
    if !follow_redirects {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }
    builder
}

/// 复用 Client 以复用连接池（TCP/TLS keep-alive）；证书校验、重定向策略与
/// 是否禁用代理是 Client 级配置，按组合缓存 8 个实例；超时按请求单独设置。
/// 缺省 Client 会自动跟随系统代理，no_proxy 为 true 时强制直连
fn shared_client(ssl_verify: bool, follow_redirects: bool, no_proxy: bool) -> &'static reqwest::Client {
    static CLIENTS: [OnceLock<reqwest::Client>; 8] = [const { OnceLock::new() }; 8];
    let index = (no_proxy as usize) << 2 | (ssl_verify as usize) << 1 | follow_redirects as usize;
    CLIENTS[index].get_or_init(|| {
        let mut builder = base_builder(ssl_verify, follow_redirects);
        if no_proxy {
            builder = builder.no_proxy();
        }
        builder.build().expect("创建 HTTP 客户端失败")
    })
}

/// 按项目隔离的会话 Cookie jar：同一项目的请求共享，项目间互不可见
static COOKIE_JARS: Mutex<BTreeMap<String, Arc<Jar>>> = Mutex::new(BTreeMap::new());

/// 使用会话 jar 的 Client 缓存，键为 jar id + Client 级配置组合
static JAR_CLIENTS: Mutex<BTreeMap<String, reqwest::Client>> = Mutex::new(BTreeMap::new());

/// 取项目的会话 Cookie jar，不存在时创建
fn project_jar(jar_id: &str) -> Arc<Jar> {
    let mut jars = COOKIE_JARS.lock().unwrap();
    jars.entry(jar_id.to_string()).or_default().clone()
}

/// 使用项目会话 jar 的 Client：cookie_provider 是 Client 级配置，按 jar + 配置组合缓存
fn jar_client(
    jar_id: &str,
    ssl_verify: bool,
    follow_redirects: bool,
    no_proxy: bool,
) -> reqwest::Client {
    let key = format!("{jar_id}|{ssl_verify}|{follow_redirects}|{no_proxy}");
    let mut cache = JAR_CLIENTS.lock().unwrap();
    if let Some(client) = cache.get(&key) {
        return client.clone();
    }
    let mut builder = base_builder(ssl_verify, follow_redirects).cookie_provider(project_jar(jar_id));
    if no_proxy {
        builder = builder.no_proxy();
    }
    let client = builder.build().expect("创建 HTTP 客户端失败");
    cache.insert(key, client.clone());
    client
}

/// 清除项目的会话 Cookie：丢弃 jar 并淘汰所有引用它的缓存 Client
#[tauri::command]
pub fn clear_project_cookies(project_id: String) {
    COOKIE_JARS.lock().unwrap().remove(&project_id);
    let prefix = format!("{project_id}|");
    JAR_CLIENTS
        .lock()
        .unwrap()
        .retain(|key, _| !key.starts_with(&prefix));
    // 自定义代理 Client 缓存的键含 jar 标记，命中时一并丢弃
    let mut cached = CUSTOM_PROXY_CACHE.lock().unwrap();
    if let Some((key, _)) = cached.as_ref() {
        if key.contains(&format!("|jar:{project_id}|")) {
            *cached = None;
        }
    }
}

/// 自定义代理 Client 缓存：按完整配置缓存最近一个，配置不变时复用连接池
static CUSTOM_PROXY_CACHE: Mutex<Option<(String, reqwest::Client)>> = Mutex::new(None);

/// 自定义代理 Client：cookie_jar_id 有值时挂接项目会话 jar
fn custom_proxy_client(
    cfg: &ProxyConfig,
    ssl_verify: bool,
    follow_redirects: bool,
    cookie_jar_id: Option<&str>,
) -> Result<reqwest::Client, String> {
    if cfg.url.trim().is_empty() {
        return Err("未配置代理服务器地址，请在设置的代理页填写".into());
    }
    let key = format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|jar:{}|",
        cfg.url, cfg.for_http, cfg.for_https, cfg.username, cfg.password, cfg.bypass,
        ssl_verify, follow_redirects,
        cookie_jar_id.unwrap_or(""),
    );
    let mut cached = CUSTOM_PROXY_CACHE.lock().unwrap();
    if let Some((cached_key, client)) = cached.as_ref() {
        if *cached_key == key {
            return Ok(client.clone());
        }
    }

    let mut builder = base_builder(ssl_verify, follow_redirects);
    if let Some(jar_id) = cookie_jar_id {
        builder = builder.cookie_provider(project_jar(jar_id));
    }
    if !cfg.for_http && !cfg.for_https {
        // 两类流量都不经代理，等同于直连
        builder = builder.no_proxy();
    } else {
        let proxy = if cfg.for_http && cfg.for_https {
            reqwest::Proxy::all(&cfg.url)
        } else if cfg.for_http {
            reqwest::Proxy::http(&cfg.url)
        } else {
            reqwest::Proxy::https(&cfg.url)
        };
        let mut proxy = proxy.map_err(|e| format!("代理服务器地址无效: {e}"))?;
        if !cfg.username.is_empty() {
            proxy = proxy.basic_auth(&cfg.username, &cfg.password);
        }
        let bypass = cfg.bypass.trim();
        if !bypass.is_empty() {
            proxy = proxy.no_proxy(reqwest::NoProxy::from_string(bypass));
        }
        builder = builder.proxy(proxy);
    }
    let client = builder
        .build()
        .map_err(|e| format!("创建代理客户端失败: {e}"))?;
    *cached = Some((key, client.clone()));
    Ok(client)
}

#[tauri::command]
pub async fn send_http_request(
    input: SendRequestInput,
    on_sse: Channel<SseEvent>,
) -> Result<SendRequestOutput, String> {
    let method = reqwest::Method::from_bytes(input.method.as_bytes())
        .map_err(|_| format!("无效的请求方法: {}", input.method))?;

    // 按代理模式选择客户端：custom 自定义代理 / none 直连 / 缺省跟随系统代理；
    // 指定 cookie_jar_id 时使用挂接项目会话 jar 的客户端
    let jar_id = input.cookie_jar_id.as_deref();
    let client = match input.proxy.as_ref() {
        Some(cfg) if cfg.mode == "custom" => {
            custom_proxy_client(cfg, input.ssl_verify, input.follow_redirects, jar_id)?
        }
        Some(cfg) if cfg.mode == "none" => match jar_id {
            Some(id) => jar_client(id, input.ssl_verify, input.follow_redirects, true),
            None => shared_client(input.ssl_verify, input.follow_redirects, true).clone(),
        },
        _ => match jar_id {
            Some(id) => jar_client(id, input.ssl_verify, input.follow_redirects, false),
            None => shared_client(input.ssl_verify, input.follow_redirects, false).clone(),
        },
    };
    let mut builder = client.request(method, &input.url);
    // 0 表示不限制超时
    let timeout_ms = input.timeout_ms.unwrap_or(300_000);
    if timeout_ms > 0 {
        builder = builder.timeout(Duration::from_millis(timeout_ms));
    }

    // Query 参数
    let query: Vec<(&str, &str)> = enabled_items(&input.params)
        .map(|p| (p.key.as_str(), p.value.as_str()))
        .collect();
    if !query.is_empty() {
        builder = builder.query(&query);
    }

    // 请求头
    for header in enabled_items(&input.headers) {
        builder = builder.header(&header.key, &header.value);
    }
    // 无缓存头：用户已手动指定 Cache-Control 时不覆盖
    if input.no_cache_header
        && !enabled_items(&input.headers).any(|h| h.key.eq_ignore_ascii_case("cache-control"))
    {
        builder = builder.header(CACHE_CONTROL, "no-cache");
    }

    // 认证
    if let Some(auth) = &input.auth {
        match auth.auth_type.as_str() {
            "bearer" => builder = builder.bearer_auth(&auth.token),
            "basic" => builder = builder.basic_auth(&auth.username, Some(&auth.password)),
            "api-key" if !auth.key.is_empty() => {
                if auth.add_to == "query" {
                    builder = builder.query(&[(auth.key.as_str(), auth.value.as_str())]);
                } else {
                    builder = builder.header(&auth.key, &auth.value);
                }
            }
            _ => {}
        }
    }

    // 请求体
    match input.body_type.as_str() {
        "json" => {
            if !has_content_type(&input.headers) {
                builder = builder.header(CONTENT_TYPE, "application/json");
            }
            builder = builder.body(input.body.clone());
        }
        "raw" => {
            if !has_content_type(&input.headers) {
                builder = builder.header(CONTENT_TYPE, "text/plain");
            }
            builder = builder.body(input.body.clone());
        }
        "x-www-form-urlencoded" => {
            let items = parse_form_body(&input.body)?;
            let mut form: Vec<(&str, &str)> = Vec::new();
            for item in enabled_fields(&items) {
                if item.field_type == "array" {
                    // array 字段：同名 key 重复发送多个值
                    form.extend(item.values.iter().map(|v| (item.key.as_str(), v.as_str())));
                } else {
                    form.push((item.key.as_str(), item.value.as_str()));
                }
            }
            builder = builder.form(&form);
        }
        "form-data" => {
            let items = parse_form_body(&input.body)?;
            let mut form = reqwest::multipart::Form::new();
            for item in enabled_fields(&items) {
                match item.field_type.as_str() {
                    // 文件字段：读取本地文件作为文件 part，文件名取自路径
                    "file" => {
                        let path = item.value.trim();
                        if path.is_empty() {
                            continue;
                        }
                        let bytes = std::fs::read(path)
                            .map_err(|e| format!("读取文件 {path} 失败: {e}"))?;
                        let file_name = std::path::Path::new(path)
                            .file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                            .unwrap_or_else(|| "file".into());
                        let part = reqwest::multipart::Part::bytes(bytes).file_name(file_name);
                        form = form.part(item.key.clone(), part);
                    }
                    // array 字段：同名 key 重复发送多个值
                    "array" => {
                        for value in &item.values {
                            form = form.text(item.key.clone(), value.clone());
                        }
                    }
                    _ => form = form.text(item.key.clone(), item.value.clone()),
                }
            }
            builder = builder.multipart(form);
        }
        _ => {}
    }

    // 先构建请求，记录实际发出的方法 / URL / 请求头（Host、Cookie 等由底层追加的头不含在内）
    let request = builder.build().map_err(|e| e.to_string())?;
    let request_method = request.method().to_string();
    let request_url = request.url().to_string();
    let mut request_headers = BTreeMap::new();
    for (name, value) in request.headers() {
        let value = String::from_utf8_lossy(value.as_bytes()).into_owned();
        request_headers
            .entry(name.to_string())
            .and_modify(|existing: &mut String| {
                existing.push_str(", ");
                existing.push_str(&value);
            })
            .or_insert(value);
    }

    // 发送并计时；带 request_id 时与取消信号竞争，前端取消即中断请求
    let started = Instant::now();
    let fut = async move {
        let mut response = client.execute(request).await.map_err(|e| e.to_string())?;
        let status = response.status();

        let mut headers = BTreeMap::new();
        for (name, value) in response.headers() {
            let value = String::from_utf8_lossy(value.as_bytes()).into_owned();
            headers
                .entry(name.to_string())
                .and_modify(|existing: &mut String| {
                    existing.push_str(", ");
                    existing.push_str(&value);
                })
                .or_insert(value);
        }

        // SSE（text/event-stream）响应：逐块读取并经 Channel 推送事件；其余一次性读完
        let is_event_stream = headers
            .get("content-type")
            .is_some_and(|ct| ct.to_ascii_lowercase().contains("text/event-stream"));
        let bytes: Vec<u8> = if is_event_stream {
            stream_sse_body(&mut response, &on_sse, &request_url).await
        } else {
            response.bytes().await.map_err(|e| e.to_string())?.into()
        };
        let duration_ms = started.elapsed().as_millis() as u64;

        // 文本响应原样返回；二进制（非 UTF-8）以 Base64 编码，由前端预览 / 保存
        let size_bytes = bytes.len();
        let (body, body_encoding) = match String::from_utf8(bytes) {
            Ok(text) => (text, "text"),
            Err(err) => (
                base64::engine::general_purpose::STANDARD.encode(err.as_bytes()),
                "base64",
            ),
        };

        Ok(SendRequestOutput {
            status: status.as_u16(),
            status_text: status.canonical_reason().unwrap_or("").to_string(),
            headers,
            size_bytes,
            body,
            body_encoding: body_encoding.to_string(),
            duration_ms,
            request_method,
            request_url,
            request_headers,
            is_event_stream,
        })
    };

    match input.cancel_id.as_deref() {
        Some(id) => {
            let (tx, rx) = tokio::sync::oneshot::channel::<()>();
            cancel_senders().lock().unwrap().insert(id.to_string(), tx);
            let result = tokio::select! {
                res = fut => res,
                _ = rx => Err("请求已取消".to_string()),
            };
            cancel_senders().lock().unwrap().remove(id);
            result
        }
        None => fut.await,
    }
}

/// 进行中请求的取消发送端：cancel_id -> 取消信号
fn cancel_senders() -> &'static Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>> {
    static SENDERS: OnceLock<Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>> =
        OnceLock::new();
    SENDERS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 中断指定 cancel_id 的进行中请求；请求不存在或已完成时静默忽略
#[tauri::command]
pub fn cancel_http_request(cancel_id: String) {
    if let Some(tx) = cancel_senders().lock().unwrap().remove(&cancel_id) {
        let _ = tx.send(());
    }
}

/// 将响应体写入本地文件；encoding 为 base64 时先解码为原始字节
#[tauri::command]
pub fn save_response_body(path: String, body: String, encoding: String) -> Result<(), String> {
    let bytes = if encoding == "base64" {
        base64::engine::general_purpose::STANDARD
            .decode(body.as_bytes())
            .map_err(|e| format!("Base64 解码失败: {e}"))?
    } else {
        body.into_bytes()
    };
    std::fs::write(&path, bytes).map_err(|e| format!("写入文件 {path} 失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::{find_sse_boundary, parse_sse_record};

    #[test]
    fn boundary_lf_and_crlf() {
        assert_eq!(find_sse_boundary(b"data: a\n\ndata: b"), Some((7, 2)));
        assert_eq!(find_sse_boundary(b"data: a\r\n\r\ndata: b"), Some((7, 4)));
        assert_eq!(find_sse_boundary(b"data: a"), None);
    }

    #[test]
    fn record_basic_and_multiline() {
        assert_eq!(
            parse_sse_record("data: hello"),
            Some(("".into(), "hello".into()))
        );
        assert_eq!(
            parse_sse_record("event: delta\ndata: l1\ndata: l2"),
            Some(("delta".into(), "l1\nl2".into()))
        );
        // 注释心跳与无 data 的块不派发
        assert_eq!(parse_sse_record(": keep-alive"), None);
        assert_eq!(parse_sse_record("id: 1"), None);
    }
}
