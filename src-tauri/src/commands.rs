use crate::state::AppState;
use crate::{new_id, now_ms, zip};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;

const SNAPSHOT_INTERVAL_MS: i64 = 10 * 60 * 1000;
const TRASH_DAYS: i64 = 30;
const MAX_BUNDLE: u64 = 500 * 1024 * 1024;

fn lock_db<'a>(
    state: &'a State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state.db.lock().map_err(|_| "db lock poisoned".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub db_path: String,
    pub data_dir: String,
    pub schema_version: i64,
    pub projects: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub status: String,
    pub tags: String,
    pub archived: bool,
    pub deleted_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub card_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRow {
    pub id: String,
    pub project_id: String,
    pub label: String,
    pub created_at: i64,
    pub card_count: i64,
}

fn project_row(conn: &Connection, pid: &str) -> Result<Option<ProjectRow>, String> {
    conn.query_row(
        "SELECT p.id, p.name, p.status, p.tags, p.archived, p.deleted_at, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id)
         FROM projects p WHERE p.id = ?1",
        params![pid],
        |r| {
            Ok(ProjectRow {
                id: r.get(0)?,
                name: r.get(1)?,
                status: r.get(2)?,
                tags: r.get(3)?,
                archived: r.get::<_, i64>(4)? != 0,
                deleted_at: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
                card_count: r.get(8)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Entity ids are primary keys in every table, so a board copied from a
/// template, duplicated or imported must get fresh ids before it is written.
fn remap_board_ids(board: &mut Value) {
    use std::collections::HashMap;
    let mut map: HashMap<String, String> = HashMap::new();
    if let Some(cards) = board.get_mut("cards").and_then(|c| c.as_array_mut()) {
        for card in cards.iter_mut() {
            if let Some(obj) = card.as_object_mut() {
                if let Some(old) = obj.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()) {
                    let new = crate::new_id("c");
                    obj.insert("id".into(), Value::String(new.clone()));
                    map.insert(old, new);
                }
            }
        }
    }
    for entity in ["frames", "strokes", "shapes", "vines"] {
        if let Some(items) = board.get_mut(entity).and_then(|c| c.as_array_mut()) {
            for item in items.iter_mut() {
                if let Some(obj) = item.as_object_mut() {
                    if obj.contains_key("id") {
                        obj.insert("id".into(), Value::String(crate::new_id("x")));
                    }
                    if entity == "vines" {
                        for key in ["from", "to"] {
                            if let Some(old) = obj.get(key).and_then(|v| v.as_str()).map(|s| s.to_string()) {
                                if let Some(new) = map.get(&old) {
                                    obj.insert(key.into(), Value::String(new.clone()));
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/* ───────────── app + projects ───────────── */

#[tauri::command]
pub fn app_info(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<AppInfo, String> {
    let conn = lock_db(&state)?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let projects: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM projects WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let data_dir = crate::data_dir(&app).to_string_lossy().into_owned();
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        db_path: state.db_path.to_string_lossy().into_owned(),
        data_dir,
        schema_version: version,
        projects,
    })
}

#[tauri::command]
pub fn list_projects(
    state: State<'_, AppState>,
    include_trash: Option<bool>,
) -> Result<Vec<ProjectRow>, String> {
    let conn = lock_db(&state)?;
    let sql = if include_trash.unwrap_or(false) {
        "SELECT p.id, p.name, p.status, p.tags, p.archived, p.deleted_at, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id)
         FROM projects p ORDER BY p.updated_at DESC"
    } else {
        "SELECT p.id, p.name, p.status, p.tags, p.archived, p.deleted_at, p.created_at, p.updated_at,
                (SELECT COUNT(*) FROM cards c WHERE c.project_id = p.id)
         FROM projects p WHERE p.deleted_at IS NULL ORDER BY p.updated_at DESC"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ProjectRow {
                id: r.get(0)?,
                name: r.get(1)?,
                status: r.get(2)?,
                tags: r.get(3)?,
                archived: r.get::<_, i64>(4)? != 0,
                deleted_at: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
                card_count: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    name: Option<String>,
    seed: Option<Value>,
    status: Option<String>,
) -> Result<ProjectRow, String> {
    let conn = lock_db(&state)?;
    let pid = new_id("p");
    let seed_name = seed
        .as_ref()
        .and_then(|s| s.get("name"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let seed_status = seed
        .as_ref()
        .and_then(|s| s.get("status"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let name = name.or(seed_name).unwrap_or_else(|| "Untitled board".into());
    let status = status.or(seed_status).unwrap_or_else(|| "Spark".into());
    conn.execute(
        "INSERT INTO projects (id, name, status, created_at, updated_at, viewport, wpm)
         VALUES (?1, ?2, ?3, ?4, ?4, '{}', 150)",
        params![pid, name, status, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    if let Some(mut board) = seed {
        remap_board_ids(&mut board);
        board["projectId"] = Value::String(pid.clone());
        crate::store::write_board(&conn, &pid, &board)?;
    }
    project_row(&conn, &pid)?.ok_or_else(|| "project vanished".into())
}

#[tauri::command]
pub fn rename_project(state: State<'_, AppState>, id: String, name: String) -> Result<(), String> {
    let conn = lock_db(&state)?;
    conn.execute(
        "UPDATE projects SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, name, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_project_status(
    state: State<'_, AppState>,
    id: String,
    status: String,
) -> Result<(), String> {
    let conn = lock_db(&state)?;
    conn.execute(
        "UPDATE projects SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, status, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_project_tags(state: State<'_, AppState>, id: String, tags: String) -> Result<(), String> {
    let conn = lock_db(&state)?;
    conn.execute(
        "UPDATE projects SET tags = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, tags, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn archive_project(
    state: State<'_, AppState>,
    id: String,
    archived: bool,
) -> Result<(), String> {
    let conn = lock_db(&state)?;
    conn.execute(
        "UPDATE projects SET archived = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, if archived { 1 } else { 0 }, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Soft delete: the row stays for 30 days so the trash filter can restore it.
#[tauri::command]
pub fn delete_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = lock_db(&state)?;
    conn.execute(
        "UPDATE projects SET deleted_at = ?2 WHERE id = ?1",
        params![id, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn restore_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = lock_db(&state)?;
    conn.execute(
        "UPDATE projects SET deleted_at = NULL, updated_at = ?2 WHERE id = ?1",
        params![id, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn purge_project(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = lock_db(&state)?;
    conn.execute("DELETE FROM projects WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn purge_expired_trash(state: State<'_, AppState>) -> Result<usize, String> {
    let conn = lock_db(&state)?;
    let cutoff = now_ms() - TRASH_DAYS * 24 * 3600 * 1000;
    conn.execute(
        "DELETE FROM projects WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
        params![cutoff],
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn duplicate_project(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
) -> Result<ProjectRow, String> {
    let conn = lock_db(&state)?;
    let mut board = crate::store::read_board(&conn, &id)?.ok_or("project not found")?;
    remap_board_ids(&mut board);
    let copy_id = new_id("p");
    let original_name = board.get("name").and_then(|v| v.as_str()).unwrap_or("Board");
    let name = name.unwrap_or_else(|| format!("{original_name} copy"));
    conn.execute(
        "INSERT INTO projects (id, name, status, tags, created_at, updated_at, viewport, wpm)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
        params![
            copy_id,
            name,
            board.get("status").and_then(|v| v.as_str()).unwrap_or("Spark"),
            board.get("tags").and_then(|v| v.as_str()).unwrap_or(""),
            now_ms(),
            board.get("viewport").cloned().unwrap_or(json!({})).to_string(),
            board.get("wpm").and_then(|v| v.as_i64()).unwrap_or(150),
        ],
    )
    .map_err(|e| e.to_string())?;
    crate::store::write_board(&conn, &copy_id, &board)?;
    conn.execute(
        "UPDATE attachments SET project_id = ?1 WHERE project_id = ?2",
        params![copy_id, id],
    )
    .map_err(|e| e.to_string())?;
    project_row(&conn, &copy_id)?.ok_or_else(|| "duplicate vanished".into())
}

/* ───────────── board ───────────── */

#[tauri::command]
pub fn load_board(state: State<'_, AppState>, project_id: String) -> Result<Value, String> {
    let conn = lock_db(&state)?;
    Ok(crate::store::read_board(&conn, &project_id)?.unwrap_or(Value::Null))
}

#[tauri::command]
pub fn save_board(
    state: State<'_, AppState>,
    project_id: String,
    board: Value,
) -> Result<bool, String> {
    let mut conn = lock_db(&state)?;
    {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        crate::store::write_board(&tx, &project_id, &board)?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    maybe_snapshot(&conn, &project_id, &board, "autosave")
}

/// Dirty-entity save: only the changed rows travel over IPC.
#[tauri::command]
pub fn apply_changes(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    changes: Value,
) -> Result<Value, String> {
    let mut conn = lock_db(&state)?;
    let touched;
    {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        touched = crate::store::apply_changes(&tx, &project_id, &changes)?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    crate::log::write(
        &app,
        if touched > 0 { "info" } else { "debug" },
        &format!("apply_changes project={project_id} touched={touched}"),
    );
    let snapshotted = if touched > 0 {
        let board = crate::store::read_board(&conn, &project_id)?.unwrap_or(Value::Null);
        maybe_snapshot(&conn, &project_id, &board, "autosave")?
    } else {
        false
    };
    Ok(json!({ "touched": touched, "snapshotted": snapshotted }))
}

fn maybe_snapshot(
    conn: &Connection,
    project_id: &str,
    board: &Value,
    label: &str,
) -> Result<bool, String> {
    if board.is_null() {
        return Ok(false);
    }
    let newest: Option<i64> = conn
        .query_row(
            "SELECT MAX(created_at) FROM snapshots WHERE project_id = ?1",
            params![project_id],
            |r| r.get::<_, Option<i64>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten();
    let now = now_ms();
    if newest.map(|t| now - t > SNAPSHOT_INTERVAL_MS).unwrap_or(true) {
        insert_snapshot(conn, project_id, label, &board.to_string())?;
        return Ok(true);
    }
    Ok(false)
}

/* ───────────── snapshots ───────────── */

fn insert_snapshot(
    conn: &Connection,
    project_id: &str,
    label: &str,
    payload: &str,
) -> Result<String, String> {
    let sid = new_id("s");
    conn.execute(
        "INSERT INTO snapshots (id, project_id, label, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![sid, project_id, label, payload, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(sid)
}

#[tauri::command]
pub fn list_snapshots(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<SnapshotRow>, String> {
    let conn = lock_db(&state)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, project_id, label, created_at, payload FROM snapshots
             WHERE project_id = ?1 ORDER BY created_at DESC LIMIT 100",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![project_id], |r| {
            let payload: String = r.get(4)?;
            let cards = serde_json::from_str::<Value>(&payload)
                .ok()
                .and_then(|v| v.get("cards").and_then(|c| c.as_array()).map(|a| a.len()))
                .unwrap_or(0) as i64;
            Ok(SnapshotRow {
                id: r.get(0)?,
                project_id: r.get(1)?,
                label: r.get(2)?,
                created_at: r.get(3)?,
                card_count: cards,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn snapshot_now(
    state: State<'_, AppState>,
    project_id: String,
    label: String,
) -> Result<String, String> {
    let conn = lock_db(&state)?;
    let board = crate::store::read_board(&conn, &project_id)?.ok_or("project not found")?;
    insert_snapshot(&conn, &project_id, &label, &board.to_string())
}

#[tauri::command]
pub fn restore_snapshot(state: State<'_, AppState>, snapshot_id: String) -> Result<Value, String> {
    let conn = lock_db(&state)?;
    let (project_id, payload): (String, String) = conn
        .query_row(
            "SELECT project_id, payload FROM snapshots WHERE id = ?1",
            params![snapshot_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    if let Some(current) = crate::store::read_board(&conn, &project_id)? {
        let _ = insert_snapshot(&conn, &project_id, "before restore", &current.to_string());
    }
    let board: Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    crate::store::write_board(&conn, &project_id, &board)?;
    Ok(board)
}

/* ───────────── settings ───────────── */

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Value, String> {
    let conn = lock_db(&state)?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut out = Map::new();
    for (k, v) in rows {
        // the API key is write-only from the webview's point of view
        if k == "ai.key" {
            continue;
        }
        out.insert(k, serde_json::from_str::<Value>(&v).unwrap_or(Value::String(v)));
    }
    Ok(Value::Object(out))
}

#[tauri::command]
pub fn put_settings(state: State<'_, AppState>, patch: Value) -> Result<(), String> {
    let conn = lock_db(&state)?;
    let obj = patch.as_object().ok_or("settings patch must be an object")?;
    for (k, v) in obj {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![k, v.to_string()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/* ───────────── attachments ───────────── */

/// Saves bytes under app-data/attachments/<sha256>.<ext>, deduped by hash.
#[tauri::command]
pub fn save_attachment(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    project_id: String,
    name: String,
    mime: String,
    width: i64,
    height: i64,
    bytes: Vec<u8>,
) -> Result<Value, String> {
    if bytes.len() > 40 * 1024 * 1024 {
        return Err("image is larger than 40 MB".into());
    }
    let dir = crate::data_dir(&app).join("attachments");
    std::fs::create_dir_all(&dir).map_err(|e| format!("attachments dir: {e}"))?;
    let hash = sha256_hex(&bytes);
    let ext = Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .filter(|e| ["png", "jpg", "jpeg", "webp", "gif", "avif"].contains(&e.as_str()))
        .unwrap_or_else(|| match mime.as_str() {
            "image/png" => "png".into(),
            "image/webp" => "webp".into(),
            "image/gif" => "gif".into(),
            _ => "jpg".into(),
        });
    let file = format!("{hash}.{ext}");
    let path = dir.join(&file);
    if !path.exists() {
        let tmp = dir.join(format!("{file}.tmp"));
        std::fs::write(&tmp, &bytes).map_err(|e| format!("write attachment: {e}"))?;
        std::fs::rename(&tmp, &path).map_err(|e| format!("commit attachment: {e}"))?;
    }
    let conn = lock_db(&state)?;
    let aid = new_id("a");
    conn.execute(
        "INSERT INTO attachments (id, project_id, file_name, mime, w, h, hash, bytes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![aid, project_id, file, mime, width, height, hash, bytes.len() as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({
        "id": aid,
        "src": format!("attachments/{file}"),
        "file": file,
        "hash": hash,
        "width": width,
        "height": height,
        "bytes": bytes.len(),
    }))
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/* ───────────── page titles (curl, no reqwest) ───────────── */

#[tauri::command]
pub fn fetch_page_title(url: String) -> Result<Value, String> {
    let lower = url.to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("only http and https URLs can be fetched".into());
    }
    let mut command = Command::new("curl.exe");
    command
        .args([
            "-sS",
            "-L",
            "--max-redirs",
            "3",
            "--max-time",
            "5",
            "-A",
            "Mozilla/5.0 (compatible; Bloom/0.1)",
            &url,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| format!("run curl: {e}"))?;
    let mut stdout = child.stdout.take().ok_or("no curl output")?;
    // read at most 512 KB of the document, then stop the download
    let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
    let mut chunk = [0u8; 16 * 1024];
    loop {
        match stdout.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() >= 512 * 1024 {
                    let _ = child.kill();
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let status = child.wait().ok();
    let body = String::from_utf8_lossy(&buf).to_string();
    let title = extract_title(&body);
    if title.is_none() && buf.is_empty() {
        let mut err = String::new();
        if let Some(mut stderr) = child.stderr.take() {
            let _ = stderr.read_to_string(&mut err);
        }
        return Ok(json!({
            "title": null,
            "error": if err.trim().is_empty() {
                format!("no title found (curl exit {:?})", status.and_then(|s| s.code()))
            } else { err.trim().to_string() }
        }));
    }
    Ok(json!({ "title": title, "bytes": buf.len() }))
}

fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let open_end = lower[start..].find('>')? + start + 1;
    let end = lower[open_end..].find("</title>")? + open_end;
    let raw = html[open_end..end].trim();
    let cleaned = raw
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    let squashed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if squashed.is_empty() {
        None
    } else {
        Some(squashed.chars().take(200).collect())
    }
}

/* ───────────── backups, files, bundles ───────────── */

#[tauri::command]
pub fn backup_now(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let dir = crate::data_dir(&app).join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = chrono_stamp();
    let target = dir.join(format!("bloom-{stamp}.db"));
    let conn = lock_db(&state)?;
    conn.execute("VACUUM INTO ?1", params![target.to_string_lossy()])
        .map_err(|e| e.to_string())?;
    // keep the last seven
    let mut names: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|e| e == "db").unwrap_or(false))
        .collect();
    names.sort();
    while names.len() > 7 {
        let old = names.remove(0);
        let _ = std::fs::remove_file(old);
    }
    Ok(target.to_string_lossy().into_owned())
}

fn chrono_stamp() -> String {
    // yyyymmdd-HHMMSS from unix time, no chrono dependency
    let secs = now_ms() / 1000;
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}{m:02}{d:02}-{:02}{:02}{:02}", rem / 3600, (rem % 3600) / 60, rem % 60)
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

#[tauri::command]
pub fn backups_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = crate::data_dir(&app).join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let tmp = format!("{path}.tmp");
    std::fs::write(&tmp, contents.as_bytes()).map_err(|e| format!("write: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("commit: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn export_bloom(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    path: String,
) -> Result<String, String> {
    let conn = lock_db(&state)?;
    let board = crate::store::read_board(&conn, &project_id)?.ok_or("project not found")?;
    let data = crate::data_dir(&app);
    let manifest = json!({
        "format": 1,
        "app": "Bloom",
        "appVersion": env!("CARGO_PKG_VERSION"),
        "exportedAt": now_ms(),
        "project": {
            "name": board.get("name"),
            "status": board.get("status"),
            "tags": board.get("tags"),
        }
    });
    let mut entries: Vec<(String, Vec<u8>)> = vec![
        ("manifest.json".into(), manifest.to_string().into_bytes()),
        ("board.json".into(), board.to_string().into_bytes()),
    ];
    for src in referenced_attachments(&board) {
        let p = data.join(&src);
        if p.exists() {
            let bytes = std::fs::read(&p).map_err(|e| format!("read attachment: {e}"))?;
            entries.push((src, bytes));
        }
    }
    let zip_bytes = zip::write_zip(&entries);
    let tmp = format!("{path}.tmp");
    std::fs::write(&tmp, &zip_bytes).map_err(|e| format!("write bundle: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("commit bundle: {e}"))?;
    Ok(path)
}

fn referenced_attachments(board: &Value) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(cards) = board.get("cards").and_then(|c| c.as_array()) {
        for c in cards {
            if let Some(src) = c
                .get("image")
                .and_then(|i| i.get("src"))
                .and_then(|s| s.as_str())
            {
                if !out.iter().any(|s: &String| s == src) {
                    out.push(src.to_string());
                }
            }
        }
    }
    out
}

#[tauri::command]
pub fn import_bloom(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<ProjectRow, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("open bundle: {e}"))?;
    if meta.len() > MAX_BUNDLE {
        return Err("bundle is larger than 500 MB".into());
    }
    let mut file = std::fs::File::open(&path).map_err(|e| format!("open bundle: {e}"))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(|e| format!("read bundle: {e}"))?;
    let entries = zip::read_zip(&bytes, MAX_BUNDLE)?;

    let manifest = entries
        .iter()
        .find(|(n, _)| n == "manifest.json")
        .map(|(_, d)| String::from_utf8_lossy(d).to_string())
        .ok_or("bundle has no manifest.json")?;
    let manifest: Value = serde_json::from_str(&manifest).map_err(|e| format!("bad manifest: {e}"))?;
    if manifest.get("format").and_then(|v| v.as_i64()) != Some(1) {
        return Err("unsupported .bloom format version".into());
    }
    let board_json = entries
        .iter()
        .find(|(n, _)| n == "board.json")
        .map(|(_, d)| String::from_utf8_lossy(d).to_string())
        .ok_or("bundle has no board.json")?;
    let mut board: Value = serde_json::from_str(&board_json).map_err(|e| format!("bad board.json: {e}"))?;
    remap_board_ids(&mut board);

    let data = crate::data_dir(&app);
    let att_dir = data.join("attachments");
    std::fs::create_dir_all(&att_dir).map_err(|e| e.to_string())?;
    for (name, bytes) in &entries {
        if let Some(rest) = name.strip_prefix("attachments/") {
            if rest.is_empty() || rest.contains('/') || rest.contains("..") {
                return Err("unsafe attachment path in bundle".into());
            }
            let target = att_dir.join(rest);
            if !target.exists() {
                std::fs::write(&target, bytes).map_err(|e| format!("write attachment: {e}"))?;
            }
        }
    }

    let conn = lock_db(&state)?;
    let pid = new_id("p");
    let name = board
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported board")
        .to_string();
    conn.execute(
        "INSERT INTO projects (id, name, status, tags, created_at, updated_at, viewport, wpm)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)",
        params![
            pid,
            name,
            board.get("status").and_then(|v| v.as_str()).unwrap_or("Spark"),
            board.get("tags").and_then(|v| v.as_str()).unwrap_or(""),
            now_ms(),
            board.get("viewport").cloned().unwrap_or(json!({})).to_string(),
            board.get("wpm").and_then(|v| v.as_i64()).unwrap_or(150),
        ],
    )
    .map_err(|e| e.to_string())?;
    crate::store::write_board(&conn, &pid, &board)?;

    for src in referenced_attachments(&board) {
        let file = src.trim_start_matches("attachments/").to_string();
        let hash = file.split('.').next().unwrap_or("").to_string();
        conn.execute(
            "INSERT INTO attachments (id, project_id, file_name, mime, hash)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![crate::new_id("a"), pid, file, "", hash],
        )
        .map_err(|e| e.to_string())?;
    }

    project_row(&conn, &pid)?.ok_or_else(|| "imported project vanished".into())
}

/* ───────────── shell helpers ───────────── */

/// Timestamp used in backup file names (yyyymmdd-HHMMSS).
pub fn stamp_for_backup() -> String {
    chrono_stamp()
}

fn shell_open(target: &str) -> Result<(), String> {
    let mut command = Command::new("cmd.exe");
    command.args(["/C", "start", "", target]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
        .stdin(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("open: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    let lower = url.to_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("only http and https links can be opened".into());
    }
    shell_open(&url)
}

/// A `.bloom` passed on the command line, handed to the frontend once.
#[tauri::command]
pub fn take_launch_file() -> Option<String> {
    crate::take_launch_file()
}

/// Reads an image the user picked, without granting the webview file access.
#[tauri::command]
pub fn read_image_file(path: String) -> Result<Vec<u8>, String> {
    let p = Path::new(&path);
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if !["png", "jpg", "jpeg", "webp", "gif", "avif"].contains(&ext.as_str()) {
        return Err("only image files can be read".into());
    }
    let meta = std::fs::metadata(p).map_err(|e| format!("open image: {e}"))?;
    if meta.len() > 40 * 1024 * 1024 {
        return Err("image is larger than 40 MB".into());
    }
    std::fs::read(p).map_err(|e| format!("read image: {e}"))
}

#[tauri::command]
pub fn log_client(app: tauri::AppHandle, level: String, message: String) -> Result<(), String> {
    let clipped: String = message.chars().take(2000).collect();
    crate::log::write(&app, &level, &format!("webview: {clipped}"));
    Ok(())
}

#[tauri::command]
pub fn tail_log(app: tauri::AppHandle, lines: Option<usize>) -> Result<String, String> {
    Ok(crate::log::tail(&app, lines.unwrap_or(80)))
}

#[tauri::command]
pub fn logs_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(crate::log::dir(&app))
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("folder does not exist".into());
    }
    shell_open(&path)
}
