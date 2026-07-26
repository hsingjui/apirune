// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod http;

use tauri::{Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Size height to the monitor work area (between menu bar and Dock) and center horizontally.
fn place_window_in_work_area(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = window
        .current_monitor()?
        .or(window.primary_monitor()?)
    else {
        let _ = window.center();
        return Ok(());
    };

    let work_area = monitor.work_area();
    let outer = window.outer_size()?;

    // Keep configured width when possible; always use full work-area height.
    let width = outer.width.min(work_area.size.width).max(1);
    let height = work_area.size.height.max(1);
    window.set_size(PhysicalSize::new(width, height))?;

    let outer = window.outer_size()?;
    let x = work_area.position.x + (work_area.size.width as i32 - outer.width as i32) / 2;
    // Align to the top of the work area so the window sits under the menu bar
    // and extends down to the Dock.
    let y = work_area.position.y;

    window.set_position(PhysicalPosition::new(x, y))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(
                    "sqlite:apirune.db",
                    vec![Migration {
                        version: 1,
                        description: "create_tables",
                        sql: "CREATE TABLE IF NOT EXISTS projects (\n                          id          TEXT    PRIMARY KEY,\n                          name        TEXT    NOT NULL,\n                          icon        TEXT    NOT NULL,\n                          created_at  INTEGER NOT NULL,\n                          updated_at  INTEGER NOT NULL\n                        );\n                        CREATE TABLE IF NOT EXISTS folders (\n                          id          TEXT    PRIMARY KEY,\n                          project_id  TEXT    NOT NULL,\n                          parent_id   TEXT,\n                          name        TEXT    NOT NULL,\n                          sort_order  INTEGER NOT NULL DEFAULT 0,\n                          created_at  INTEGER NOT NULL,\n                          updated_at  INTEGER NOT NULL\n                        );\n                        CREATE TABLE IF NOT EXISTS requests (\n                          id          TEXT    PRIMARY KEY,\n                          project_id  TEXT    NOT NULL,\n                          folder_id   TEXT,\n                          name        TEXT    NOT NULL,\n                          method      TEXT    NOT NULL DEFAULT 'GET',\n                          url         TEXT    NOT NULL DEFAULT '',\n                          params      TEXT    NOT NULL DEFAULT '[]',\n                          headers     TEXT    NOT NULL DEFAULT '[]',\n                          body_type   TEXT    NOT NULL DEFAULT 'none',\n                          body        TEXT    NOT NULL DEFAULT '',\n                          sort_order  INTEGER NOT NULL DEFAULT 0,\n                          created_at  INTEGER NOT NULL,\n                          updated_at  INTEGER NOT NULL\n                        );\n                        CREATE TABLE IF NOT EXISTS history (\n                          id               TEXT    PRIMARY KEY,\n                          project_id       TEXT    NOT NULL,\n                          request_id       TEXT,\n                          method           TEXT    NOT NULL,\n                          url              TEXT    NOT NULL,\n                          params           TEXT    NOT NULL DEFAULT '[]',\n                          headers          TEXT    NOT NULL DEFAULT '[]',\n                          body_type        TEXT    NOT NULL DEFAULT 'none',\n                          body             TEXT    NOT NULL DEFAULT '',\n                          status           INTEGER,\n                          duration_ms      INTEGER,\n                          response_headers TEXT    NOT NULL DEFAULT '{}',\n                          response_body    TEXT    NOT NULL DEFAULT '',\n                          error            TEXT,\n                          created_at       INTEGER NOT NULL\n                        );\n                        CREATE INDEX IF NOT EXISTS idx_folders_project ON folders (project_id);\n                        CREATE INDEX IF NOT EXISTS idx_requests_project ON requests (project_id);\n                        CREATE INDEX IF NOT EXISTS idx_requests_folder ON requests (folder_id);\n                        CREATE INDEX IF NOT EXISTS idx_history_project ON history (project_id, created_at);",
                        kind: MigrationKind::Up,
                    }],
                )
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = place_window_in_work_area(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, http::send_http_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
