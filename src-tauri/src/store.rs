// Board persistence: full reads/writes plus dirty-entity application.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};

const CARD_KEYS: [&str; 8] = ["id", "type", "x", "y", "w", "h", "z", "rotation"];

fn num(v: &Value, key: &str, default: f64) -> f64 {
    v.get(key).and_then(|x| x.as_f64()).unwrap_or(default)
}

fn str_of(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or_default().to_string()
}

fn opt_str(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn card_data(card: &Map<String, Value>) -> String {
    let mut rest = card.clone();
    for key in CARD_KEYS {
        rest.remove(key);
    }
    Value::Object(rest).to_string()
}

fn upsert_card(conn: &Connection, project_id: &str, c: &Value) -> Result<(), String> {
    let obj = c.as_object().ok_or("card is not an object")?;
    let extra = c.get("extra").cloned().unwrap_or_else(|| json!({}));
    conn.execute(
        "INSERT OR REPLACE INTO cards (id, project_id, type, x, y, w, h, z, data, extra)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            str_of(c, "id"),
            project_id,
            str_of(c, "type"),
            num(c, "x", 0.0),
            num(c, "y", 0.0),
            num(c, "w", 300.0),
            num(c, "h", 0.0),
            c.get("z").and_then(|v| v.as_i64()).unwrap_or(0),
            card_data(obj),
            extra.to_string(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn upsert_vine(conn: &Connection, project_id: &str, v: &Value) -> Result<(), String> {
    let kind = str_of(v, "kind");
    conn.execute(
        "INSERT OR REPLACE INTO vines (id, project_id, from_card, from_pin, to_card, to_pin, kind, label)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            str_of(v, "id"),
            project_id,
            opt_str(v, "from"),
            str_of(v, "fromPin"),
            opt_str(v, "to"),
            str_of(v, "toPin"),
            if kind.is_empty() { "vine".to_string() } else { kind },
            opt_str(v, "label"),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn upsert_frame(conn: &Connection, project_id: &str, f: &Value) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO frames (id, project_id, label, x, y, w, h)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            str_of(f, "id"),
            project_id,
            str_of(f, "label"),
            num(f, "x", 0.0),
            num(f, "y", 0.0),
            num(f, "w", 420.0),
            num(f, "h", 320.0),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn upsert_stroke(conn: &Connection, project_id: &str, s: &Value) -> Result<(), String> {
    let color = str_of(s, "color");
    conn.execute(
        "INSERT OR REPLACE INTO strokes (id, project_id, color, width, points)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            str_of(s, "id"),
            project_id,
            if color.is_empty() { "pen".to_string() } else { color },
            num(s, "width", 1.6),
            s.get("points").cloned().unwrap_or_else(|| json!([])).to_string(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn upsert_shape(conn: &Connection, project_id: &str, s: &Value) -> Result<(), String> {
    let color = str_of(s, "color");
    conn.execute(
        "INSERT OR REPLACE INTO shapes (id, project_id, kind, color, width, x, y, w, h, points)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            str_of(s, "id"),
            project_id,
            {
                let k = str_of(s, "kind");
                if k.is_empty() { "rect".to_string() } else { k }
            },
            if color.is_empty() { "pen".to_string() } else { color },
            num(s, "width", 1.6),
            num(s, "x", 0.0),
            num(s, "y", 0.0),
            num(s, "w", 0.0),
            num(s, "h", 0.0),
            s.get("points").cloned().unwrap_or_else(|| json!([])).to_string(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

const ENTITIES: [&str; 5] = ["cards", "vines", "frames", "strokes", "shapes"];

fn table_of(entity: &str) -> &'static str {
    match entity {
        "cards" => "cards",
        "vines" => "vines",
        "frames" => "frames",
        "strokes" => "strokes",
        _ => "shapes",
    }
}

fn upsert(conn: &Connection, project_id: &str, entity: &str, item: &Value) -> Result<(), String> {
    match entity {
        "cards" => upsert_card(conn, project_id, item),
        "vines" => upsert_vine(conn, project_id, item),
        "frames" => upsert_frame(conn, project_id, item),
        "strokes" => upsert_stroke(conn, project_id, item),
        _ => upsert_shape(conn, project_id, item),
    }
}

pub fn write_board(conn: &Connection, project_id: &str, board: &Value) -> Result<(), String> {
    let empty: Vec<Value> = Vec::new();
    let viewport = board.get("viewport").cloned().unwrap_or_else(|| json!({}));
    let wpm = board.get("wpm").and_then(|v| v.as_i64()).unwrap_or(150).max(60);
    conn.execute(
        "UPDATE projects SET viewport = ?2, wpm = ?3, updated_at = ?4 WHERE id = ?1",
        params![project_id, viewport.to_string(), wpm, crate::now_ms()],
    )
    .map_err(|e| e.to_string())?;

    for entity in ENTITIES {
        conn.execute(
            &format!("DELETE FROM {} WHERE project_id = ?1", table_of(entity)),
            params![project_id],
        )
        .map_err(|e| e.to_string())?;
        for item in board.get(entity).and_then(|c| c.as_array()).unwrap_or(&empty) {
            upsert(conn, project_id, entity, item)?;
        }
    }
    Ok(())
}

/// Apply only what changed. `changes` = {cards:{upsert:[],delete:[]}, ...,
/// viewport?, wpm?}. Returns the number of rows touched.
pub fn apply_changes(conn: &Connection, project_id: &str, changes: &Value) -> Result<usize, String> {
    let mut touched = 0usize;

    for entity in ENTITIES {
        let Some(bucket) = changes.get(entity) else { continue };
        let table = table_of(entity);
        if let Some(deletes) = bucket.get("delete").and_then(|d| d.as_array()) {
            for id in deletes {
                let Some(id) = id.as_str() else { continue };
                touched += conn
                    .execute(
                        &format!("DELETE FROM {table} WHERE id = ?1 AND project_id = ?2"),
                        params![id, project_id],
                    )
                    .map_err(|e| e.to_string())?;
            }
        }
        if let Some(upserts) = bucket.get("upsert").and_then(|u| u.as_array()) {
            for item in upserts {
                upsert(conn, project_id, entity, item)?;
                touched += 1;
            }
        }
    }

    if changes.get("viewport").is_some() || changes.get("wpm").is_some() {
        let viewport: Option<String> = changes.get("viewport").map(|v| v.to_string());
        let wpm = changes.get("wpm").and_then(|v| v.as_i64());
        match (viewport, wpm) {
            (Some(v), Some(w)) => conn.execute(
                "UPDATE projects SET viewport = ?2, wpm = ?3, updated_at = ?4 WHERE id = ?1",
                params![project_id, v, w.max(60), crate::now_ms()],
            ),
            (Some(v), None) => conn.execute(
                "UPDATE projects SET viewport = ?2, updated_at = ?3 WHERE id = ?1",
                params![project_id, v, crate::now_ms()],
            ),
            (None, Some(w)) => conn.execute(
                "UPDATE projects SET wpm = ?2, updated_at = ?3 WHERE id = ?1",
                params![project_id, w.max(60), crate::now_ms()],
            ),
            (None, None) => Ok(0),
        }
        .map_err(|e| e.to_string())?;
    }

    if touched > 0 {
        conn.execute(
            "UPDATE projects SET updated_at = ?2 WHERE id = ?1",
            params![project_id, crate::now_ms()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(touched)
}

pub fn read_board(conn: &Connection, project_id: &str) -> Result<Option<Value>, String> {
    let project = conn
        .query_row(
            "SELECT name, status, viewport, wpm, tags, created_at, updated_at
             FROM projects WHERE id = ?1",
            params![project_id],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)?,
                    r.get::<_, i64>(6)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((name, status, viewport, wpm, tags, created_at, updated_at)) = project else {
        return Ok(None);
    };

    let mut board = json!({
        "projectId": project_id,
        "name": name,
        "status": status,
        "tags": tags,
        "createdAt": created_at,
        "updatedAt": updated_at,
        "wpm": wpm.max(60),
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "cards": [], "vines": [], "frames": [], "strokes": [], "shapes": []
    });
    if let Ok(v) = serde_json::from_str::<Value>(&viewport) {
        if v.get("zoom").is_some() {
            board["viewport"] = v;
        }
    }

    let mut cards = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, type, x, y, w, h, z, data, extra FROM cards WHERE project_id = ?1 ORDER BY z, rowid")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |r| {
                Ok((
                    r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, f64>(2)?,
                    r.get::<_, f64>(3)?, r.get::<_, f64>(4)?, r.get::<_, f64>(5)?,
                    r.get::<_, i64>(6)?, r.get::<_, String>(7)?, r.get::<_, String>(8)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, kind, x, y, w, h, z, data, extra) = row.map_err(|e| e.to_string())?;
            let mut obj: Map<String, Value> = serde_json::from_str(&data).unwrap_or_default();
            obj.insert("id".into(), Value::String(id));
            obj.insert("type".into(), Value::String(kind));
            obj.insert("x".into(), json!(x));
            obj.insert("y".into(), json!(y));
            obj.insert("w".into(), json!(w));
            if h > 0.0 {
                obj.insert("h".into(), json!(h));
            }
            obj.insert("z".into(), json!(z));
            let extra: Value = serde_json::from_str(&extra).unwrap_or_else(|_| json!({}));
            if extra.as_object().map(|m| !m.is_empty()).unwrap_or(false) {
                obj.insert("extra".into(), extra);
            }
            cards.push(Value::Object(obj));
        }
    }
    board["cards"] = Value::Array(cards);

    let mut vines = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, from_card, from_pin, to_card, to_pin, kind, label FROM vines WHERE project_id = ?1 ORDER BY rowid")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?,
                    "from": r.get::<_, Option<String>>(1)?,
                    "fromPin": r.get::<_, Option<String>>(2)?,
                    "to": r.get::<_, Option<String>>(3)?,
                    "toPin": r.get::<_, Option<String>>(4)?,
                    "kind": r.get::<_, String>(5)?,
                    "label": r.get::<_, Option<String>>(6)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            vines.push(row.map_err(|e| e.to_string())?);
        }
    }
    board["vines"] = Value::Array(vines);

    let mut frames = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, label, x, y, w, h FROM frames WHERE project_id = ?1 ORDER BY rowid")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |r| {
                Ok(json!({
                    "id": r.get::<_, String>(0)?, "label": r.get::<_, String>(1)?,
                    "x": r.get::<_, f64>(2)?, "y": r.get::<_, f64>(3)?,
                    "w": r.get::<_, f64>(4)?, "h": r.get::<_, f64>(5)?,
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            frames.push(row.map_err(|e| e.to_string())?);
        }
    }
    board["frames"] = Value::Array(frames);

    let mut strokes = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, color, width, points FROM strokes WHERE project_id = ?1 ORDER BY rowid")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |r| {
                let points: String = r.get(3)?;
                Ok(json!({
                    "id": r.get::<_, String>(0)?, "color": r.get::<_, String>(1)?,
                    "width": r.get::<_, f64>(2)?,
                    "points": serde_json::from_str::<Value>(&points).unwrap_or_else(|_| json!([])),
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            strokes.push(row.map_err(|e| e.to_string())?);
        }
    }
    board["strokes"] = Value::Array(strokes);

    let mut shapes = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, kind, color, width, x, y, w, h, points FROM shapes WHERE project_id = ?1 ORDER BY rowid")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_id], |r| {
                let points: String = r.get(8)?;
                Ok(json!({
                    "id": r.get::<_, String>(0)?, "kind": r.get::<_, String>(1)?,
                    "color": r.get::<_, String>(2)?, "width": r.get::<_, f64>(3)?,
                    "x": r.get::<_, f64>(4)?, "y": r.get::<_, f64>(5)?,
                    "w": r.get::<_, f64>(6)?, "h": r.get::<_, f64>(7)?,
                    "points": serde_json::from_str::<Value>(&points).unwrap_or_else(|_| json!([])),
                }))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            shapes.push(row.map_err(|e| e.to_string())?);
        }
    }
    board["shapes"] = Value::Array(shapes);

    Ok(Some(board))
}
