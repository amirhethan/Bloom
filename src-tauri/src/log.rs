// Rolling text log in app-data/logs, plus a tail for diagnostics.

use std::io::Write;
use std::path::PathBuf;
use tauri::Manager;

const MAX_BYTES: u64 = 1024 * 1024;

fn logs_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("logs");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn rotate(path: &PathBuf) {
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() > MAX_BYTES {
            let old = path.with_extension("log.1");
            let _ = std::fs::remove_file(&old);
            let _ = std::fs::rename(path, old);
        }
    }
}

pub fn write(app: &tauri::AppHandle, level: &str, message: &str) {
    let path = logs_dir(app).join("bloom.log");
    rotate(&path);
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "{} [{}] {}", crate::now_ms(), level, message);
    }
}

pub fn tail(app: &tauri::AppHandle, lines: usize) -> String {
    let path = logs_dir(app).join("bloom.log");
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let all: Vec<&str> = text.lines().collect();
    let start = all.len().saturating_sub(lines);
    all[start..].join("\n")
}

pub fn dir(app: &tauri::AppHandle) -> String {
    logs_dir(app).to_string_lossy().into_owned()
}
