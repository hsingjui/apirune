//! 核心发请求能力：接收前端的完整请求配置，发出 HTTP 请求并返回响应。
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use reqwest::header::CONTENT_TYPE;
use serde::{Deserialize, Serialize};

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
    /// 请求体原文；form 类为 KeyValueItem[] 的 JSON 串
    #[serde(default)]
    pub body: String,
    pub auth: Option<AuthConfig>,
    pub timeout_ms: Option<u64>,
}

/// 响应结果
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequestOutput {
    pub status: u16,
    pub status_text: String,
    pub headers: BTreeMap<String, String>,
    pub body: String,
    pub duration_ms: u64,
    pub size_bytes: usize,
}

/// 过滤出启用且 key 非空的条目
fn enabled_items(items: &[KeyValueItem]) -> impl Iterator<Item = &KeyValueItem> {
    items.iter().filter(|item| item.enabled && !item.key.is_empty())
}

/// 解析 form 类请求体（KeyValueItem[] 的 JSON 串）
fn parse_form_body(body: &str) -> Result<Vec<KeyValueItem>, String> {
    if body.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(body).map_err(|e| format!("表单请求体解析失败: {e}"))
}

/// 用户是否已手动指定了 Content-Type
fn has_content_type(headers: &[KeyValueItem]) -> bool {
    enabled_items(headers).any(|h| h.key.eq_ignore_ascii_case("content-type"))
}

#[tauri::command]
pub async fn send_http_request(input: SendRequestInput) -> Result<SendRequestOutput, String> {
    let method = reqwest::Method::from_bytes(input.method.as_bytes())
        .map_err(|_| format!("无效的请求方法: {}", input.method))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(input.timeout_ms.unwrap_or(30_000)))
        .build()
        .map_err(|e| e.to_string())?;

    let mut builder = client.request(method, &input.url);

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
            let form: Vec<(&str, &str)> = enabled_items(&items)
                .map(|item| (item.key.as_str(), item.value.as_str()))
                .collect();
            builder = builder.form(&form);
        }
        "form-data" => {
            let items = parse_form_body(&input.body)?;
            let mut form = reqwest::multipart::Form::new();
            for item in enabled_items(&items) {
                form = form.text(item.key.clone(), item.value.clone());
            }
            builder = builder.multipart(form);
        }
        _ => {}
    }

    // 发送并计时
    let started = Instant::now();
    let response = builder.send().await.map_err(|e| e.to_string())?;
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

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    let duration_ms = started.elapsed().as_millis() as u64;

    Ok(SendRequestOutput {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
        size_bytes: bytes.len(),
        body: String::from_utf8_lossy(&bytes).into_owned(),
        duration_ms,
    })
}
