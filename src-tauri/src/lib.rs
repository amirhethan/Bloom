mod ai;
mod commands;
mod db;
mod log;
mod secrets;
mod state;
mod store;
mod zip;

use state::AppState;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

static ID_SEQ: AtomicU64 = AtomicU64::new(0);
static LAUNCH_FILE: Mutex<Option<String>> = Mutex::new(None);

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn new_id(prefix: &str) -> String {
    format!(
        "{prefix}_{:x}{:x}",
        now_ms(),
        ID_SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

pub fn take_launch_file() -> Option<String> {
    LAUNCH_FILE.lock().ok().and_then(|mut slot| slot.take())
}

pub fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn read_setting(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    use rusqlite::OptionalExtension;
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .ok()
    .flatten()
}

fn write_setting(conn: &rusqlite::Connection, key: &str, value: &str) {
    let _ = conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key.to_string(), value.to_string()],
    );
}

fn daily_backup(app: &tauri::AppHandle, conn: &rusqlite::Connection, force: bool) {
    let last = read_setting(conn, "backup.last")
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    if !force && now_ms() - last < 24 * 3600 * 1000 {
        return;
    }
    let dir = data_dir(app).join("backups");
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let target = dir.join(format!("bloom-{}.db", commands::stamp_for_backup()));
    if conn
        .execute("VACUUM INTO ?1", [target.to_string_lossy().to_string()])
        .is_ok()
    {
        write_setting(conn, "backup.last", &now_ms().to_string());
    }
    let mut names: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map(|it| it.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    names.retain(|p| p.extension().map(|e| e == "db").unwrap_or(false));
    names.sort();
    while names.len() > 7 {
        let old = names.remove(0);
        let _ = std::fs::remove_file(old);
    }
}

/// `mobile_entry_point` generates the JNI symbol the Android activity looks for.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let dir = data_dir(&handle);
            std::fs::create_dir_all(&dir)?;
            secrets::init(&dir);
            let db_path = dir.join("bloom.db");
            let conn = db::open(&db_path).map_err(|e| format!("db init failed: {e}"))?;

            // the asset protocol never sees anything outside attachments/
            let att = dir.join("attachments");
            let _ = std::fs::create_dir_all(&att);
            #[cfg(desktop)]
            let _ = app.asset_protocol_scope().allow_directory(&att, true);

            // trash older than 30 days is gone for good
            let _ = conn.execute(
                "DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
                [now_ms() - 30 * 24 * 3600 * 1000],
            );

            daily_backup(&handle, &conn, false);

            // older builds kept the API key in the database; move it to the keychain
            let legacy: Option<String> = read_setting(&conn, "ai.key");
            if let Some(raw) = legacy {
                let key = serde_json::from_str::<serde_json::Value>(&raw)
                    .ok()
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
                    .unwrap_or(raw);
                if !key.trim().is_empty() {
                    let _ = secrets::set_key(&key);
                }
                let _ = conn.execute("DELETE FROM settings WHERE key = 'ai.key'", []);
            }

            // a .bloom handed to the exe (file association / "Open with"); Android delivers
            // files through intents, so this only exists on the desktop
            #[cfg(desktop)]
            if let Some(arg) = std::env::args().skip(1).find(|a| a.to_lowercase().ends_with(".bloom")) {
                if std::path::Path::new(&arg).exists() {
                    if let Ok(mut slot) = LAUNCH_FILE.lock() {
                        *slot = Some(arg);
                    }
                }
            }

            log::write(
                &handle,
                "info",
                &format!(
                    "start v{} schema {} db {}",
                    env!("CARGO_PKG_VERSION"),
                    read_setting(&conn, "noop").unwrap_or_else(|| "3".into()),
                    db_path.to_string_lossy()
                ),
            );

            #[cfg(desktop)]
            if let Some(window) = app.get_webview_window("main") {
                let w = read_setting(&conn, "window.w").and_then(|v| v.parse::<f64>().ok());
                let h = read_setting(&conn, "window.h").and_then(|v| v.parse::<f64>().ok());
                if let (Some(w), Some(h)) = (w, h) {
                    let _ = window.set_size(tauri::LogicalSize::new(w.max(900.0), h.max(600.0)));
                }
                let x = read_setting(&conn, "window.x").and_then(|v| v.parse::<f64>().ok());
                let y = read_setting(&conn, "window.y").and_then(|v| v.parse::<f64>().ok());
                if let (Some(x), Some(y)) = (x, y) {
                    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
                }
                let events = handle.clone();
                window.on_window_event(move |event| match event {
                    tauri::WindowEvent::Resized(size) => {
                        let state: tauri::State<AppState> = events.state();
                        if let Ok(conn) = state.db.lock() {
                            write_setting(&conn, "window.w", &size.width.to_string());
                            write_setting(&conn, "window.h", &size.height.to_string());
                        };
                    }
                    tauri::WindowEvent::Moved(pos) => {
                        let state: tauri::State<AppState> = events.state();
                        if let Ok(conn) = state.db.lock() {
                            write_setting(&conn, "window.x", &pos.x.to_string());
                            write_setting(&conn, "window.y", &pos.y.to_string());
                        };
                    }
                    _ => {}
                });
            }

            app.manage(AppState {
                db: Mutex::new(conn),
                db_path,
            });

            // one backup per day even if the app never restarts
            let tick = handle.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(6 * 3600));
                let state: tauri::State<AppState> = tick.state();
                if let Ok(conn) = state.db.lock() {
                    daily_backup(&tick, &conn, false);
                };
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::list_projects,
            commands::create_project,
            commands::rename_project,
            commands::set_project_status,
            commands::set_project_tags,
            commands::archive_project,
            commands::delete_project,
            commands::restore_project,
            commands::purge_project,
            commands::purge_expired_trash,
            commands::duplicate_project,
            commands::load_board,
            commands::save_board,
            commands::apply_changes,
            commands::list_snapshots,
            commands::snapshot_now,
            commands::restore_snapshot,
            commands::get_settings,
            commands::put_settings,
            commands::save_attachment,
            commands::read_image_file,
            commands::take_launch_file,
            commands::fetch_page_title,
            commands::open_url,
            commands::open_folder,
            commands::backup_now,
            commands::backups_dir,
            commands::write_text_file,
            commands::export_bloom,
            commands::import_bloom,
            commands::log_client,
            commands::tail_log,
            commands::logs_dir,
            ai::ai_status,
            ai::ai_set_key,
            ai::ai_clear_key,
            ai::ai_test,
            ai::ai_generate,
            ai::ai_cancel
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bloom");
}
