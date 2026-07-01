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

                CREATE TABLE IF NOT EXISTS runtime_profiles (
                    id TEXT PRIMARY KEY NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'chat',
                    label TEXT NOT NULL,
                    executable TEXT NOT NULL,
                    args TEXT NOT NULL DEFAULT '[]',
                    working_directory_mode TEXT NOT NULL DEFAULT 'project',
                    default_model TEXT,
                    capabilities TEXT NOT NULL DEFAULT '[]',
                    built_in INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS app_defaults (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS permission_rules (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS audit_trail (
                    id TEXT PRIMARY KEY NOT NULL,
                    action TEXT NOT NULL,
                    scope TEXT,
                    decision TEXT NOT NULL,
                    source_workflow TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_trail(created_at);

                CREATE TABLE IF NOT EXISTS analytics_events (
                    id TEXT PRIMARY KEY NOT NULL,
                    event_name TEXT NOT NULL,
                    feature_area TEXT NOT NULL,
                    outcome TEXT,
                    duration_ms INTEGER,
                    adapter_id TEXT,
                    error_class TEXT,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);
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

        // Seed built-in runtime profiles if none exist
        let profile_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM runtime_profiles", [], |r| r.get(0))
            .unwrap_or(0);
        if profile_count == 0 {
            for profile in crate::models::runtime::RuntimeProfile::built_ins() {
                let _ = connection.execute(
                    "INSERT OR IGNORE INTO runtime_profiles (id, kind, label, executable, args, working_directory_mode, default_model, capabilities, built_in) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        profile.id,
                        profile.kind.as_str(),
                        profile.label,
                        profile.executable,
                        serde_json::to_string(&profile.args).unwrap_or_default(),
                        profile.working_directory_mode.as_str(),
                        profile.default_model,
                        serde_json::to_string(&profile.capabilities).unwrap_or_default(),
                        profile.built_in as i32,
                    ],
                );
            }
        }

        // Seed conservative defaults if none exist
        let defaults_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM app_defaults", [], |r| r.get(0))
            .unwrap_or(0);
        if defaults_count == 0 {
            let defaults = crate::models::runtime::RuntimeDefaults::conservative();
            let _ = connection.execute(
                "INSERT INTO app_defaults (key, value) VALUES ('defaults', ?1)",
                params![serde_json::to_string(&defaults).unwrap_or_default()],
            );
            let rules = crate::models::permission::PermissionRules::conservative();
            let _ = connection.execute(
                "INSERT INTO permission_rules (key, value) VALUES ('rules', ?1)",
                params![serde_json::to_string(&rules).unwrap_or_default()],
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
