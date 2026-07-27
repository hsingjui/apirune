// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod fonts;
mod http;
mod ws;

use tauri::{Manager, PhysicalPosition, PhysicalSize};
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

/// 根据屏幕工作区放置窗口：高度填满工作区，宽度按屏幕宽度的比例计算并限制范围，
/// 随后水平居中、垂直贴顶（位于菜单栏下方、Dock 上方）。
fn place_window_in_work_area(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window
        .current_monitor()?
        .or(window.primary_monitor()?)
    else {
        let _ = window.center();
        return Ok(());
    };

    let work_area = monitor.work_area();
    let work_w = work_area.size.width as i32;
    let work_h = work_area.size.height as i32;

    // 宽度取屏幕宽度的 88%，并 clamp 到 [960, 2400]：小屏不溢出、超宽屏不过空；
    // 当工作区比最小宽度还窄时，再贴合工作区宽度。高度直接填满工作区。
    const MIN_WIDTH: i32 = 960;
    const MAX_WIDTH: i32 = 2400;
    let width = (work_w as f64 * 0.88).round() as i32;
    let width = width.clamp(MIN_WIDTH, MAX_WIDTH).min(work_w).max(1);
    let height = work_h.max(1);

    window.set_size(PhysicalSize::new(width as u32, height as u32))?;

    let outer = window.outer_size()?;
    let x = work_area.position.x + (work_w - outer.width as i32) / 2;
    let y = work_area.position.y;

    window.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
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
                    }],
                )
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // 先按屏幕工作区确定尺寸与位置，再显示，避免初始 1280×800 闪现后跳变。
                let _ = place_window_in_work_area(&window);
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
