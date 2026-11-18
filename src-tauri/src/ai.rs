// AI panel backend. The key lives in the settings table behind an
// API-only wall: get_settings never returns it and the webview never sees it.
// Requests stream from curl.exe (no reqwest tree) as Anthropic SSE.

use crate::secrets;
use crate::state::AppState;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Emitter, State};

pub const DEFAULT_MODEL: &str = "claude-sonnet-5-5";
const API_URL: &str = "https://api.anthropic.com/v1/messages";

static RUNNING: Mutex<Option<HashMap<String, Child>>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub has_key: bool,
    pub model: String,
}

fn model_of(conn: &rusqlite::Connection) -> String {
    use rusqlite::OptionalExtension;
    conn.query_row("SELECT value FROM settings WHERE key = 'ai.model'", [], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .map(|v| serde_json::from_str::<Value>(&v).ok().and_then(|x| x.as_str().map(|s| s.to_string())).unwrap_or(v))
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

#[tauri::command]
pub fn ai_status(state: State<'_, AppState>) -> Result<AiStatus, String> {
    let conn = state.db.lock().map_err(|_| "db lock".to_string())?;
    Ok(AiStatus {
        has_key: secrets::get_key().is_some(),
        model: model_of(&conn),
    })
}

#[tauri::command]
pub fn ai_set_key(state: State<'_, AppState>, key: String) -> Result<(), String> {
    // the key goes to the OS keychain; the database only keeps the model choice
    let conn = state.db.lock().map_err(|_| "db lock".to_string())?;
    let _ = conn.execute("DELETE FROM settings WHERE key = 'ai.key'", []);
    drop(conn);
    secrets::set_key(&key)
}

#[tauri::command]
pub fn ai_clear_key(state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "db lock".to_string())?;
    let _ = conn.execute("DELETE FROM settings WHERE key = 'ai.key'", []);
    drop(conn);
    secrets::clear_key()
}

fn run_curl(key: &str, body: &Value) -> Result<std::process::Output, String> {
    let mut command = Command::new("curl.exe");
    command
        .args([
            "-sS",
            "--max-time",
            "90",
            "-H",
            "content-type: application/json",
            "-H",
            &format!("x-api-key: {key}"),
            "-H",
            "anthropic-version: 2023-06-01",
            "-d",
            &body.to_string(),
            API_URL,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command.output().map_err(|e| format!("run curl: {e}"))
}

#[tauri::command]
pub fn ai_test(state: State<'_, AppState>) -> Result<Value, String> {
    let conn = state.db.lock().map_err(|_| "db lock".to_string())?;
    let model = model_of(&conn);
    drop(conn);
    let key = secrets::get_key().ok_or("no API key saved")?;
    let body = json!({
        "model": model,
        "max_tokens": 16,
        "messages": [{ "role": "user", "content": "Reply with the single word: ready" }]
    });
    let output = run_curl(&key, &body)?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        Ok(json!({ "ok": true, "reply": text.chars().take(200).collect::<String>() }))
    } else {
        Ok(json!({ "ok": false, "error": friendly(&text, output.status.code()) }))
    }
}

fn friendly(body: &str, code: Option<i32>) -> String {
    if let Ok(v) = serde_json::from_str::<Value>(body) {
        if let Some(msg) = v.get("error").and_then(|e| e.get("message")).and_then(|m| m.as_str()) {
            return msg.to_string();
        }
    }
    match code {
        Some(401) => "The API key was rejected. Check it in Settings.".into(),
        Some(429) => "Anthropic is rate limiting requests. Try again in a moment.".into(),
        Some(0) | None => "Could not reach Anthropic. Check the network and try again.".into(),
        Some(c) => format!("Anthropic returned HTTP {c}."),
    }
}

/// Streams a completion: emits ai://chunk, ai://done, ai://error.
#[tauri::command]
pub fn ai_generate(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    model: Option<String>,
    prompt: String,
    context: String,
    max_tokens: Option<u32>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|_| "db lock".to_string())?;
    let model = model.unwrap_or_else(|| model_of(&conn));
    drop(conn);
    let key = secrets::get_key().ok_or("no API key saved")?;

    let system = if context.trim().is_empty() {
        "You are a precise YouTube script editor. Answer in plain text, no markdown headers.".to_string()
    } else {
        format!(
            "You are a precise YouTube script editor. Answer in plain text, no markdown headers. \
             Here is the board context:\n\n{context}"
        )
    };
    let body = json!({
        "model": model,
        "max_tokens": max_tokens.unwrap_or(2048),
        "stream": true,
        "system": system,
        "messages": [{ "role": "user", "content": prompt }]
    });

    let mut command = Command::new("curl.exe");
    command
        .args([
            "-sS",
            "-N",
            "--max-time",
            "180",
            "-H",
            "content-type: application/json",
            "-H",
            &format!("x-api-key: {key}"),
            "-H",
            "anthropic-version: 2023-06-01",
            "--data-binary",
            "@-",
            API_URL,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|e| format!("run curl: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin.write_all(body.to_string().as_bytes()).map_err(|e| e.to_string())?;
    }

    {
        let mut running = RUNNING.lock().map_err(|_| "ai lock".to_string())?;
        running.get_or_insert_with(HashMap::new).insert(request_id.clone(), child);
    }

    let app2 = app.clone();
    let rid = request_id.clone();
    std::thread::spawn(move || {
        let mut child = {
            let mut running = match RUNNING.lock() {
                Ok(r) => r,
                Err(_) => return,
            };
            match running.as_mut().and_then(|m| m.remove(&rid)) {
                Some(c) => c,
                None => return,
            }
        };
        let stdout = match child.stdout.take() {
            Some(s) => s,
            None => {
                let _ = app2.emit("ai://error", json!({"requestId": rid, "error": "no output stream"}));
                return;
            }
        };
        let reader = BufReader::new(stdout);
        let mut text = String::new();
        let mut failed: Option<String> = None;
        for line in reader.lines().map_while(Result::ok) {
            let line = line.trim().to_string();
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data == "[DONE]" {
                    break;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if let Some(err) = v.get("error") {
                        failed = Some(err.get("message").and_then(|m| m.as_str()).unwrap_or("request failed").to_string());
                        break;
                    }
                    if let Some(delta) = v
                        .get("delta")
                        .and_then(|d| d.get("text"))
                        .and_then(|t| t.as_str())
                    {
                        text.push_str(delta);
                        let _ = app2.emit("ai://chunk", json!({"requestId": rid, "text": delta}));
                    }
                    if v.get("type").and_then(|t| t.as_str()) == Some("message_stop") {
                        break;
                    }
                }
            }
        }
        let status = child.wait().ok().and_then(|s| s.code());
        match failed {
            Some(err) => {
                let _ = app2.emit("ai://error", json!({"requestId": rid, "error": friendly(&err, status)}));
            }
            None => {
                let _ = app2.emit("ai://done", json!({"requestId": rid, "text": text, "code": status}));
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn ai_cancel(request_id: String) -> Result<(), String> {
    if let Ok(mut running) = RUNNING.lock() {
        if let Some(map) = running.as_mut() {
            if let Some(child) = map.remove(&request_id) {
                let mut child = child;
                let _ = child.kill();
            }
        }
    }
    Ok(())
}
