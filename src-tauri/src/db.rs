use rusqlite::Connection;
use std::path::{Path, PathBuf};

const SCHEMA_VERSION: i64 = 3;

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("create data dir: {e}"))?;
    }
    let conn = Connection::open(path).map_err(|e| format!("open db: {e}"))?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;")
        .map_err(|e| format!("pragmas: {e}"))?;

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| format!("read user_version: {e}"))?;

    // never migrate without a copy of the previous schema's data
    if version == 2 && SCHEMA_VERSION > 2 {
        let backup = backup_path(path);
        std::fs::copy(path, &backup).map_err(|e| format!("pre-migration backup: {e}"))?;
    }

    migrate(&conn, version)?;
    Ok(conn)
}

fn migrate(conn: &Connection, version: i64) -> Result<(), String> {
    if version < 1 {
        conn.execute_batch(
            r#"
            BEGIN;
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY, name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Spark',
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
                w REAL NOT NULL DEFAULT 300, h REAL NOT NULL DEFAULT 0,
                z INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS vines (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                from_card TEXT, from_pin TEXT, to_card TEXT, to_pin TEXT,
                kind TEXT NOT NULL DEFAULT 'vine', label TEXT
            );
            CREATE TABLE IF NOT EXISTS frames (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                label TEXT NOT NULL DEFAULT '',
                x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
                w REAL NOT NULL DEFAULT 400, h REAL NOT NULL DEFAULT 300
            );
            CREATE TABLE IF NOT EXISTS strokes (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                color TEXT NOT NULL DEFAULT 'pen', width REAL NOT NULL DEFAULT 1.6,
                points TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                card_id TEXT, file_name TEXT NOT NULL, mime TEXT, w INTEGER, h INTEGER
            );
            CREATE TABLE IF NOT EXISTS snapshots (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                label TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL, created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_cards_project  ON cards(project_id);
            CREATE INDEX IF NOT EXISTS idx_vines_project  ON vines(project_id);
            CREATE INDEX IF NOT EXISTS idx_frames_project ON frames(project_id);
            CREATE INDEX IF NOT EXISTS idx_strokes_project ON strokes(project_id);
            CREATE INDEX IF NOT EXISTS idx_snap_project   ON snapshots(project_id, created_at DESC);
            PRAGMA user_version = 1;
            COMMIT;
            "#,
        )
        .map_err(|e| format!("migrate v1: {e}"))?;
    }

    if version < 2 {
        conn.execute_batch(
            r#"
            BEGIN;
            ALTER TABLE projects ADD COLUMN viewport TEXT NOT NULL DEFAULT '{}';
            ALTER TABLE projects ADD COLUMN wpm INTEGER NOT NULL DEFAULT 150;
            CREATE INDEX IF NOT EXISTS idx_attach_project ON attachments(project_id);
            PRAGMA user_version = 2;
            COMMIT;
            "#,
        )
        .map_err(|e| format!("migrate v2: {e}"))?;
    }

    if version < 3 {
        conn.execute_batch(
            r#"
            BEGIN;
            CREATE TABLE IF NOT EXISTS shapes (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                kind TEXT NOT NULL DEFAULT 'rect', color TEXT NOT NULL DEFAULT 'pen',
                width REAL NOT NULL DEFAULT 1.6,
                x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
                w REAL NOT NULL DEFAULT 0, h REAL NOT NULL DEFAULT 0,
                points TEXT NOT NULL DEFAULT '[]'
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY, value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_shapes_project ON shapes(project_id);
            CREATE INDEX IF NOT EXISTS idx_cards_project_z ON cards(project_id, z);
            CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at DESC);
            COMMIT;
            "#,
        )
        .map_err(|e| format!("migrate v3 base: {e}"))?;

        for (table, column, ddl) in [
            ("projects", "archived", "ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0"),
            ("projects", "deleted_at", "ALTER TABLE projects ADD COLUMN deleted_at INTEGER"),
            ("projects", "tags", "ALTER TABLE projects ADD COLUMN tags TEXT NOT NULL DEFAULT ''"),
            ("cards", "extra", "ALTER TABLE cards ADD COLUMN extra TEXT NOT NULL DEFAULT '{}'"),
            ("attachments", "hash", "ALTER TABLE attachments ADD COLUMN hash TEXT"),
            ("attachments", "bytes", "ALTER TABLE attachments ADD COLUMN bytes INTEGER"),
        ] {
            if !has_column(conn, table, column)? {
                conn.execute(ddl, []).map_err(|e| format!("add {table}.{column}: {e}"))?;
            }
        }
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status, archived);
             PRAGMA user_version = 3;",
        )
        .map_err(|e| format!("migrate v3 indexes: {e}"))?;
    }

    Ok(())
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(names.iter().any(|n| n == column))
}

pub fn backup_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.bak-v2", path.to_string_lossy()))
}
