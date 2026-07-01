use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection};

use crate::{models::recent_project::RecentProject, services::storage_paths::StoragePathService};

#[derive(Debug, Default)]
pub struct StorageService;

impl StorageService {
    pub fn state_db_path() -> Result<PathBuf, String> {
        let paths = StoragePathService::ensure_global_layout()?;
        Ok(paths.global_dir.join("state.db"))
    }

    pub fn connect() -> Result<Connection, String> {
        let db_path = Self::state_db_path()?;
        let connection = Connection::open(db_path)
            .map_err(|error| format!("Failed to open Basebuild state database: {error}"))?;
        Self::initialize(&connection)?;
        Ok(connection)
    }

    pub fn remember_recent_project(path: impl AsRef<Path>) -> Result<RecentProject, String> {
        let path = path.as_ref();
        let project = RecentProject {
            path: path.to_string_lossy().to_string(),
            name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Project")
                .to_string(),
            last_opened_at: unix_timestamp(),
            last_active_session_id: None,
        };

        let connection = Self::connect()?;
        connection
            .execute(
                "INSERT INTO recent_projects(path, name, last_opened_at, last_active_session_id)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(path) DO UPDATE SET
                   name = excluded.name,
                   last_opened_at = excluded.last_opened_at",
                params![
                    project.path,
                    project.name,
                    project.last_opened_at,
                    project.last_active_session_id
                ],
            )
            .map_err(|error| format!("Failed to persist recent project: {error}"))?;

        Ok(project)
    }

    pub fn list_recent_projects(limit: u32) -> Result<Vec<RecentProject>, String> {
        let connection = Self::connect()?;
        let mut statement = connection
            .prepare(
                "SELECT path, name, last_opened_at, last_active_session_id
                 FROM recent_projects
                 ORDER BY last_opened_at DESC
                 LIMIT ?1",
            )
            .map_err(|error| format!("Failed to prepare recent projects query: {error}"))?;

        let rows = statement
            .query_map([limit], |row| {
                Ok(RecentProject {
                    path: row.get(0)?,
                    name: row.get(1)?,
                    last_opened_at: row.get(2)?,
                    last_active_session_id: row.get(3)?,
                })
            })
            .map_err(|error| format!("Failed to query recent projects: {error}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Failed to read recent project row: {error}"))
    }
    pub fn remove_recent_project(path: &str) -> Result<(), String> {
        let connection = Self::connect()?;
        connection
            .execute("DELETE FROM recent_projects WHERE path = ?1", params![path])
            .map_err(|error| format!("Failed to remove recent project: {error}"))?;
        Ok(())
    }

    pub fn set_last_active_session(project_path: &str, session_id: &str) -> Result<(), String> {
        let connection = Self::connect()?;
        connection
            .execute(
                "UPDATE recent_projects SET last_active_session_id = ?1 WHERE path = ?2",
                params![session_id, project_path],
            )
            .map_err(|error| format!("Failed to set last active session: {error}"))?;
        Ok(())
    }

    fn initialize(connection: &Connection) -> Result<(), String> {
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS recent_projects (
                    path TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    last_opened_at INTEGER NOT NULL,
                    last_active_session_id TEXT
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY NOT NULL,
                    project_path TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path);

                CREATE TABLE IF NOT EXISTS session_tabs (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'terminal',
                    title TEXT NOT NULL,
                    terminal_id INTEGER,
                    file_path TEXT,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_tabs_session ON session_tabs(session_id);
                ALTER TABLE session_tabs ADD COLUMN IF NOT EXISTS file_path TEXT;

                CREATE TABLE IF NOT EXISTS idea_categories (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_categories_session ON idea_categories(session_id);

                CREATE TABLE IF NOT EXISTS ideas (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    category_id TEXT,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    status TEXT NOT NULL DEFAULT 'concept',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                    FOREIGN KEY (category_id) REFERENCES idea_categories(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_ideas_session ON ideas(session_id);
                CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);

                CREATE TABLE IF NOT EXISTS plans (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    reference_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    goal TEXT,
                    status TEXT NOT NULL DEFAULT 'draft',
                    priority INTEGER NOT NULL DEFAULT 50,
                    tags TEXT NOT NULL DEFAULT '[]',
                    ai_enhanced INTEGER NOT NULL DEFAULT 0,
                    context TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    finished_at INTEGER,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id);
                CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
                CREATE INDEX IF NOT EXISTS idx_plans_reference ON plans(reference_id);
                ",
            )
            .map_err(|error| format!("Failed to initialize Basebuild state database: {error}"))?;

        // Migration: add last_active_session_id to existing databases
        let has_column = connection
            .prepare("SELECT last_active_session_id FROM recent_projects LIMIT 0")
            .is_ok();
        if !has_column {
            let _ = connection.execute(
                "ALTER TABLE recent_projects ADD COLUMN last_active_session_id TEXT",
                [],
            );
        }

        Ok(())
    }
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
