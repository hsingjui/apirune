// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod fonts;
mod http;
mod ws;

use tauri::{LogicalSize, Manager, PhysicalSize};
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 读取本地文本文件（OpenAPI 导入等场景）；限制 20 MB，非 UTF-8 文本时报错
#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    const MAX_SIZE: u64 = 20 * 1024 * 1024;
    let meta = std::fs::metadata(&path).map_err(|e| format!("读取文件 {path} 失败: {e}"))?;
    if meta.len() > MAX_SIZE {
        return Err(format!(
            "文件过大（{:.1} MB），最大支持 20 MB",
            meta.len() as f64 / 1024.0 / 1024.0
        ));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("读取文件 {path} 失败: {e}"))
}

/// 根据物理工作区和缩放因子计算逻辑窗口尺寸，确保高 DPI 显示器保持相同视觉比例。
fn window_size_for_work_area(
    work_area_size: PhysicalSize<u32>,
    scale_factor: f64,
) -> LogicalSize<f64> {
    let work_area_size = work_area_size.to_logical::<f64>(scale_factor);
    let work_w = work_area_size.width.round() as i32;
    let work_h = work_area_size.height.round() as i32;

    // macOS 的 Retina 内建屏逻辑工作区较小，使用更大的占比；其他平台保持现有观感。
    #[cfg(target_os = "macos")]
    const WIDTH_RATIO: f64 = 0.80;
    #[cfg(not(target_os = "macos"))]
    const WIDTH_RATIO: f64 = 0.63;
    #[cfg(target_os = "macos")]
    const HEIGHT_RATIO: f64 = 0.96;
    #[cfg(not(target_os = "macos"))]
    const HEIGHT_RATIO: f64 = 0.73;

    // 小屏不溢出、超宽屏不过空；当工作区比最小尺寸还窄时，再贴合工作区尺寸。
    const MIN_WIDTH: i32 = 960;
    const MAX_WIDTH: i32 = 1800;
    const MIN_HEIGHT: i32 = 520;
    let width = (work_w as f64 * WIDTH_RATIO).round() as i32;
    let width = width.clamp(MIN_WIDTH, MAX_WIDTH).min(work_w).max(1);
    let height = (work_h as f64 * HEIGHT_RATIO).round() as i32;
    let height = height.clamp(MIN_HEIGHT, work_h).max(1);

    LogicalSize::new(width as f64, height as f64)
}

/// 根据当前显示器工作区设置默认尺寸，并在显示前使用系统原生逻辑居中。
fn place_window_in_work_area(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) else {
        return window.center();
    };

    let work_area = monitor.work_area();
    let window_size = window_size_for_work_area(work_area.size, monitor.scale_factor());

    window.set_size(window_size)?;
    window.center()
}

#[cfg(test)]
mod tests {
    use super::window_size_for_work_area;
    use tauri::PhysicalSize;

    #[test]
    fn keeps_window_size_consistent_across_dpi_scales() {
        let standard_dpi = window_size_for_work_area(PhysicalSize::new(1920, 1080), 1.0);
        let retina = window_size_for_work_area(PhysicalSize::new(3840, 2160), 2.0);

        assert_eq!(retina, standard_dpi);
        assert!(standard_dpi.width <= 1800.0);
    }
}

/// Windows 11：请求 DWM 对无边框窗口做原生圆角裁切（抗锯齿、随 DPI 精确渲染）；
/// Windows 10 不支持该属性，DwmSetWindowAttribute 静默失败后退化为直角窗口。
#[cfg(target_os = "windows")]
fn enable_native_rounded_corners(window: &tauri::WebviewWindow) {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE,
    };
    /// DWMWCP_ROUND：强制圆角（窗口最大化时 DWM 自动退化为直角）
    const DWMWCP_ROUND: i32 = 2;

    if let Ok(handle) = window.window_handle() {
        if let RawWindowHandle::Win32(raw) = handle.as_raw() {
            let preference: i32 = DWMWCP_ROUND;
            unsafe {
                // Win10 上该属性不存在，调用失败仅返回错误码，无副作用
                let _ = DwmSetWindowAttribute(
                    raw.hwnd.get() as _,
                    DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                    &preference as *const i32 as *const _,
                    std::mem::size_of_val(&preference) as u32,
                );
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:apirune.db",
                    vec![Migration {
                        version: 1,
                        description: "create_tables",
                        sql: "CREATE TABLE IF NOT EXISTS projects (\n                          id          TEXT    PRIMARY KEY,\n                          name        TEXT    NOT NULL,\n                          icon        TEXT    NOT NULL,\n                          created_at  INTEGER NOT NULL,\n                          updated_at  INTEGER NOT NULL\n                        );\n                        CREATE TABLE IF NOT EXISTS folders (\n                          id          TEXT    PRIMARY KEY,\n                          project_id  TEXT    NOT NULL,\n                          parent_id   TEXT,\n                          name        TEXT    NOT NULL,\n                          sort_order  INTEGER NOT NULL DEFAULT 0,\n                          created_at  INTEGER NOT NULL,\n                          updated_at  INTEGER NOT NULL\n                        );\n                        CREATE TABLE IF NOT EXISTS requests (\n                          id          TEXT    PRIMARY KEY,\n                          project_id  TEXT    NOT NULL,\n                          folder_id   TEXT,\n                          name        TEXT    NOT NULL,\n                          method      TEXT    NOT NULL DEFAULT 'GET',\n                          url         TEXT    NOT NULL DEFAULT '',\n                          params      TEXT    NOT NULL DEFAULT '[]',\n                          headers     TEXT    NOT NULL DEFAULT '[]',\n                          body_type   TEXT    NOT NULL DEFAULT 'none',\n                          body        TEXT    NOT NULL DEFAULT '',\n                          sort_order  INTEGER NOT NULL DEFAULT 0,\n                          created_at  INTEGER NOT NULL,\n                          updated_at  INTEGER NOT NULL\n                        );\n                        CREATE TABLE IF NOT EXISTS history (\n                          id               TEXT    PRIMARY KEY,\n                          project_id       TEXT    NOT NULL,\n                          request_id       TEXT,\n                          method           TEXT    NOT NULL,\n                          url              TEXT    NOT NULL,\n                          params           TEXT    NOT NULL DEFAULT '[]',\n                          headers          TEXT    NOT NULL DEFAULT '[]',\n                          body_type        TEXT    NOT NULL DEFAULT 'none',\n                          body             TEXT    NOT NULL DEFAULT '',\n                          status           INTEGER,\n                          duration_ms      INTEGER,\n                          response_headers TEXT    NOT NULL DEFAULT '{}',\n                          response_body    TEXT    NOT NULL DEFAULT '',\n                          error            TEXT,\n                          created_at       INTEGER NOT NULL\n                        );\n                        CREATE INDEX IF NOT EXISTS idx_folders_project ON folders (project_id);\n                        CREATE INDEX IF NOT EXISTS idx_requests_project ON requests (project_id);\n                        CREATE INDEX IF NOT EXISTS idx_requests_folder ON requests (folder_id);\n                        CREATE INDEX IF NOT EXISTS idx_history_project ON history (project_id, created_at);
                        CREATE TABLE IF NOT EXISTS environments (\n                          id          TEXT    PRIMARY KEY,\n                          project_id  TEXT    NOT NULL,\n                          name        TEXT    NOT NULL,\n                          base_url    TEXT    NOT NULL DEFAULT '',\n                          variables   TEXT    NOT NULL DEFAULT '[]',\n                          sort_order  INTEGER NOT NULL DEFAULT 0,\n                          created_at  INTEGER NOT NULL,\n                          updated_at  INTEGER NOT NULL\n                        );\n                        CREATE TABLE IF NOT EXISTS project_globals (\n                          project_id  TEXT    PRIMARY KEY,\n                          variables   TEXT    NOT NULL DEFAULT '[]',\n                          params      TEXT    NOT NULL DEFAULT '[]',\n                          updated_at  INTEGER NOT NULL\n                        );\n                        CREATE TABLE IF NOT EXISTS project_env_state (\n                          project_id     TEXT    PRIMARY KEY,\n                          active_env_id  TEXT,\n                          updated_at     INTEGER NOT NULL\n                        );\n                        CREATE INDEX IF NOT EXISTS idx_environments_project ON environments (project_id, sort_order);
                        CREATE TABLE IF NOT EXISTS quick_folders (
                          id          TEXT    PRIMARY KEY,
                          project_id  TEXT    NOT NULL,
                          parent_id   TEXT,
                          name        TEXT    NOT NULL,
                          sort_order  INTEGER NOT NULL DEFAULT 0,
                          created_at  INTEGER NOT NULL,
                          updated_at  INTEGER NOT NULL
                        );
                        CREATE TABLE IF NOT EXISTS quick_requests (
                          id          TEXT    PRIMARY KEY,
                          project_id  TEXT    NOT NULL,
                          folder_id   TEXT,
                          name        TEXT    NOT NULL,
                          method      TEXT    NOT NULL DEFAULT 'GET',
                          url         TEXT    NOT NULL DEFAULT '',
                          params      TEXT    NOT NULL DEFAULT '[]',
                          headers     TEXT    NOT NULL DEFAULT '[]',
                          body_type   TEXT    NOT NULL DEFAULT 'none',
                          body        TEXT    NOT NULL DEFAULT '',
                          sort_order  INTEGER NOT NULL DEFAULT 0,
                          created_at  INTEGER NOT NULL,
                          updated_at  INTEGER NOT NULL
                        );
                        CREATE INDEX IF NOT EXISTS idx_quick_folders_project ON quick_folders (project_id);
                        CREATE INDEX IF NOT EXISTS idx_quick_requests_project ON quick_requests (project_id);
                        CREATE INDEX IF NOT EXISTS idx_quick_requests_folder ON quick_requests (folder_id);",
                        kind: MigrationKind::Up,
                    },
                    Migration {
                        version: 2,
                        description: "history_response_body_encoding",
                        // 二进制响应以 Base64 存入 response_body，此列标记编码方式：text | base64
                        sql: "ALTER TABLE history ADD COLUMN response_body_encoding TEXT NOT NULL DEFAULT 'text';",
                        kind: MigrationKind::Up,
                    },
                    Migration {
                        version: 3,
                        description: "environments_auth",
                        // 环境级鉴权配置（AuthConfig 的 JSON 串），'{}' 表示未配置
                        sql: "ALTER TABLE environments ADD COLUMN auth TEXT NOT NULL DEFAULT '{}';",
                        kind: MigrationKind::Up,
                    },
                    Migration {
                        version: 4,
                        description: "projects_sort_order",
                        // 项目手动排序位次；旧数据按原展示顺序（创建时间倒序）回填
                        sql: "ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;\n                        UPDATE projects SET sort_order = (\n                          SELECT COUNT(*) FROM projects p2\n                          WHERE p2.created_at > projects.created_at\n                             OR (p2.created_at = projects.created_at AND p2.id > projects.id)\n                        );",
                        kind: MigrationKind::Up,
                    },
                    Migration {
                        version: 5,
                        description: "project_globals_import_url_rules",
                        // 项目级导入 URL 规则（ImportUrlRule[] 的 JSON 串）
                        sql: "ALTER TABLE project_globals ADD COLUMN import_url_rules TEXT NOT NULL DEFAULT '[]';",
                        kind: MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // 先按屏幕工作区确定尺寸与位置，再显示，避免初始 1280×800 闪现后跳变。
                let _ = place_window_in_work_area(&window);
                #[cfg(target_os = "windows")]
                enable_native_rounded_corners(&window);
                let _ = window.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            read_text_file,
            http::send_http_request,
            http::cancel_http_request,
            http::clear_project_cookies,
            http::save_response_body,
            ws::ws_connect,
            ws::ws_send,
            ws::ws_disconnect,
            fonts::list_font_families
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
