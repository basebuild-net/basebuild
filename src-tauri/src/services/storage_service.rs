use std::{path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};

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
        };

        let connection = Self::connect()?;
        connection
            .execute(
                "INSERT INTO recent_projects(path, name, last_opened_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(path) DO UPDATE SET
                   name = excluded.name,
                   last_opened_at = excluded.last_opened_at",
                params![project.path, project.name, project.last_opened_at],
            )
            .map_err(|error| format!("Failed to persist recent project: {error}"))?;

        Ok(project)
    }

    pub fn list_recent_projects(limit: u32) -> Result<Vec<RecentProject>, String> {
        let connection = Self::connect()?;
        let mut statement = connection
            .prepare(
                "SELECT path, name, last_opened_at
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

    fn initialize(connection: &Connection) -> Result<(), String> {
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS recent_projects (
                    path TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    last_opened_at INTEGER NOT NULL
                );",
            )
            .map_err(|error| format!("Failed to initialize Basebuild state database: {error}"))
    }
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
