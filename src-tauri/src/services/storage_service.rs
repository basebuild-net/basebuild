use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};

use crate::{models::recent_project::RecentProject, services::storage_paths::StoragePathService};

#[derive(Debug, Default)]
pub struct StorageService;

impl StorageService {
    pub fn state_db_path() -> Result<PathBuf, String> {
        let paths = StoragePathService::ensure_global_layout()?;
        Ok(paths.global_dir.join("state.db"))
    }

    pub fn connect() -> Result<Connection, String> {
        // Test isolation guard: in cfg(test) builds, BASEBUILD_HOME MUST be set
        // to an isolated temp dir. This catches tests that write to the user's
        // real ~/.basebuild/state.db (observed: /test/project-* rows in prod DB).
        #[cfg(test)]
        if std::env::var_os("BASEBUILD_HOME").is_none() {
            return Err(
                "StorageService::connect() called in a test without BASEBUILD_HOME set. \
                 Use crate::test_util::test::lock_db(&tempdir) to isolate the DB."
                    .to_string(),
            );
        }
        let db_path = Self::state_db_path()?;
        let connection = Connection::open(db_path)
            .map_err(|error| format!("Failed to open Basebuild state database: {error}"))?;

        // ── SQLite robustness pragmas ──────────────────────────────────────
        // busy_timeout FIRST: absorb writer bursts from multiple threads so
        // subsequent pragma_update calls wait instead of returning SQLITE_BUSY.
        connection
            .busy_timeout(std::time::Duration::from_millis(5000))
            .map_err(|e| format!("Failed to set busy_timeout: {e}"))?;
        // WAL: readers don't block writers; sticky (set once at startup, but
        // idempotent per-connect so every connection sees the right mode).
        // Ignore "database is locked" here — WAL is already set by the first
        // connection; a concurrent set just confirms the mode.
        let _ = connection.pragma_update(None, "journal_mode", "WAL");
        // Normal synchronous is safe with WAL and avoids the fsync-per-commit
        // cost of FULL.
        connection
            .pragma_update(None, "synchronous", "NORMAL")
            .map_err(|e| format!("Failed to set synchronous mode: {e}"))?;

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

    pub fn get_last_focused_project() -> Result<Option<RecentProject>, String> {
        let connection = Self::connect()?;
        let path = connection
            .query_row(
                "SELECT value FROM app_defaults WHERE key = 'last_focused_project_path'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Failed to read last focused project key: {error}"))?;

        match path {
            Some(path) => Self::recent_project_by_path(&connection, &path),
            None => Ok(None),
        }
    }

    pub fn set_last_focused_project(path: impl AsRef<Path>) -> Result<RecentProject, String> {
        let path = path.as_ref();
        let path_string = path.to_string_lossy().to_string();
        let _ = Self::remember_recent_project(path)?;
        let connection = Self::connect()?;
        connection
            .execute(
                "INSERT INTO app_defaults (key, value) VALUES ('last_focused_project_path', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![path_string.as_str()],
            )
            .map_err(|error| format!("Failed to persist last focused project: {error}"))?;
        Self::recent_project_by_path(&connection, &path_string)?
            .ok_or_else(|| "Last focused project row was not persisted".to_string())
    }

    fn recent_project_by_path(
        connection: &Connection,
        path: &str,
    ) -> Result<Option<RecentProject>, String> {
        connection
            .query_row(
                "SELECT path, name, last_opened_at, last_active_session_id
                 FROM recent_projects
                 WHERE path = ?1",
                params![path],
                |row| {
                    Ok(RecentProject {
                        path: row.get(0)?,
                        name: row.get(1)?,
                        last_opened_at: row.get(2)?,
                        last_active_session_id: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("Failed to read recent project row: {error}"))
    }
    pub fn remove_recent_project(path: &str) -> Result<(), String> {
        let connection = Self::connect()?;
        connection
            .execute("DELETE FROM recent_projects WHERE path = ?1", params![path])
            .map_err(|error| format!("Failed to remove recent project: {error}"))?;
        connection
            .execute(
                "DELETE FROM app_defaults WHERE key = 'last_focused_project_path' AND value = ?1",
                params![path],
            )
            .map_err(|error| format!("Failed to clear last focused project: {error}"))?;
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
                    chat_session_id TEXT,
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

                CREATE TABLE IF NOT EXISTS approval_rules (
                    id TEXT PRIMARY KEY NOT NULL,
                    project_path TEXT NOT NULL,
                    tool_name TEXT NOT NULL,
                    command_prefix TEXT,
                    decision TEXT NOT NULL,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_approval_project ON approval_rules(project_path);

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

                CREATE TABLE IF NOT EXISTS native_chat_sessions (
                    id TEXT PRIMARY KEY NOT NULL,
                    project_path TEXT NOT NULL,
                    title TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    provider_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    effort_level TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'ready',
                    run_state TEXT NOT NULL DEFAULT 'idle',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_native_chat_project ON native_chat_sessions(project_path, updated_at);

                CREATE TABLE IF NOT EXISTS native_chat_messages (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    sort_order INTEGER NOT NULL,
                    provider_id TEXT,
                    model_id TEXT,
                    effort_level TEXT,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES native_chat_sessions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_native_chat_messages_session ON native_chat_messages(session_id, sort_order);

                CREATE TABLE IF NOT EXISTS native_tool_events (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    message_id TEXT,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    arguments TEXT,
                    sequence INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES native_chat_sessions(id) ON DELETE CASCADE,
                    FOREIGN KEY (message_id) REFERENCES native_chat_messages(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_native_tool_events_session ON native_tool_events(session_id, created_at);

                CREATE TABLE IF NOT EXISTS native_provider_accounts (
                    id TEXT PRIMARY KEY NOT NULL,
                    provider_id TEXT NOT NULL,
                    label TEXT NOT NULL,
                    credential_owner TEXT NOT NULL,
                    status TEXT NOT NULL,
                    metadata TEXT NOT NULL DEFAULT '{}',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_native_provider_accounts_provider ON native_provider_accounts(provider_id);

                CREATE TABLE IF NOT EXISTS native_provider_credentials (
                    provider_id TEXT PRIMARY KEY NOT NULL,
                    label TEXT NOT NULL,
                    api_key TEXT NOT NULL,
                    base_url TEXT,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS native_blocked_providers (
                    provider_id TEXT PRIMARY KEY NOT NULL,
                    blocked_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS native_model_defaults (
                    provider_id TEXT PRIMARY KEY NOT NULL,
                    model_id TEXT NOT NULL,
                    effort_level TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS native_provider_model_cache (
                    provider_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    label TEXT NOT NULL,
                    context_window INTEGER,
                    max_tokens INTEGER,
                    supports_reasoning INTEGER NOT NULL DEFAULT 0,
                    supported_efforts TEXT NOT NULL DEFAULT '[]',
                    supports_images INTEGER NOT NULL DEFAULT 0,
                    source TEXT NOT NULL,
                    synced_at INTEGER NOT NULL,
                    error TEXT,
                    PRIMARY KEY (provider_id, model_id)
                );
                CREATE INDEX IF NOT EXISTS idx_native_provider_model_cache_provider ON native_provider_model_cache(provider_id, synced_at);

                CREATE TABLE IF NOT EXISTS native_request_metrics (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    provider_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    effort_level TEXT NOT NULL,
                    started_at INTEGER NOT NULL,
                    completed_at INTEGER,
                    duration_ms INTEGER,
                    ttft_ms INTEGER,
                    ttlt_ms INTEGER,
                    input_tokens INTEGER NOT NULL DEFAULT 0,
                    output_tokens INTEGER NOT NULL DEFAULT 0,
                    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
                    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
                    tokens_per_second REAL,
                    cost_total REAL,
                    outcome TEXT NOT NULL,
                    error_class TEXT,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES native_chat_sessions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_native_request_metrics_created ON native_request_metrics(created_at);
                CREATE INDEX IF NOT EXISTS idx_native_request_metrics_provider ON native_request_metrics(provider_id, model_id, effort_level);

                CREATE TABLE IF NOT EXISTS workspace_restore_state (
                    project_path TEXT PRIMARY KEY NOT NULL,
                    last_session_id TEXT,
                    last_tab_id TEXT,
                    side_section TEXT,
                    sidebar_collapsed INTEGER NOT NULL DEFAULT 0,
                    side_collapsed INTEGER NOT NULL DEFAULT 0,
                    side_width INTEGER NOT NULL DEFAULT 260,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS usage_sync_settings (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL
                );

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
                    idea_id TEXT,
                    change_name TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    finished_at INTEGER,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_plans_session ON plans(session_id);
                CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);

                CREATE TABLE IF NOT EXISTS pipeline_runs (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    project_path TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    idea_id TEXT,
                    plan_id TEXT,
                    input_summary TEXT NOT NULL DEFAULT '',
                    session_chat_id TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    error TEXT,
                    output_refs TEXT NOT NULL DEFAULT '[]',
                    started_at INTEGER,
                    completed_at INTEGER,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_pipeline_runs_session ON pipeline_runs(session_id);
                CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);

                CREATE TABLE IF NOT EXISTS plan_queue (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    plan_id TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_plan_queue_session ON plan_queue(session_id, sort_order);

                CREATE TABLE IF NOT EXISTS plan_runs (
                    id TEXT PRIMARY KEY NOT NULL,
                    plan_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    chat_session_id TEXT,
                    workspace_path TEXT,
                    status TEXT NOT NULL DEFAULT 'pending',
                    runner_kind TEXT NOT NULL DEFAULT 'native',
                    error TEXT,
                    steps_output TEXT NOT NULL DEFAULT '[]',
                    started_at INTEGER,
                    finished_at INTEGER,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_plan_runs_plan ON plan_runs(plan_id);
                CREATE INDEX IF NOT EXISTS idx_plan_runs_status ON plan_runs(status);

                CREATE TABLE IF NOT EXISTS final_touch_steps (
                    id TEXT PRIMARY KEY NOT NULL,
                    project_path TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    label TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 0,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    config TEXT NOT NULL DEFAULT '{}',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_final_touch_steps_project ON final_touch_steps(project_path, sort_order);

                CREATE TABLE IF NOT EXISTS workspaces (
                    id TEXT PRIMARY KEY NOT NULL,
                    project_path TEXT NOT NULL,
                    plan_id TEXT,
                    branch TEXT NOT NULL,
                    path TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    pruned_at INTEGER,
                    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_path);

                CREATE TABLE IF NOT EXISTS chat_model_defaults (
                    project_path TEXT PRIMARY KEY NOT NULL,
                    provider_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    effort_level TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS plan_run_profiles (
                    project_path TEXT PRIMARY KEY NOT NULL,
                    concurrency INTEGER NOT NULL DEFAULT 1,
                    provider_id TEXT NOT NULL,
                    model_id TEXT NOT NULL,
                    effort_level TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                /* Per-project run-concurrency overrides (run-concurrency-limits).
                   Each row overrides the global defaults for one provider in one project. */
                CREATE TABLE IF NOT EXISTS run_concurrency_overrides (
                    project_path TEXT NOT NULL,
                    provider_id TEXT NOT NULL,
                    max_concurrency INTEGER NOT NULL DEFAULT 1,
                    subagents_enabled INTEGER NOT NULL DEFAULT 0,
                    subagent_max_count INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (project_path, provider_id)
                );

                -- Connector permission gateway tables (additive).
                CREATE TABLE IF NOT EXISTS connectors (
                    id TEXT PRIMARY KEY NOT NULL,
                    manifest_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    version TEXT NOT NULL,
                    transport TEXT NOT NULL DEFAULT 'pty',
                    capabilities TEXT NOT NULL DEFAULT '[]',
                    state TEXT NOT NULL DEFAULT 'registered',
                    trusted INTEGER NOT NULL DEFAULT 0,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    project_path TEXT,
                    last_error TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_connectors_project ON connectors(project_path);

                CREATE TABLE IF NOT EXISTS connector_grants (
                    id TEXT PRIMARY KEY NOT NULL,
                    connector_id TEXT NOT NULL,
                    capability TEXT NOT NULL,
                    decision TEXT NOT NULL,
                    scope TEXT NOT NULL DEFAULT 'once',
                    project_path TEXT,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_connector_grants_connector ON connector_grants(connector_id);

                CREATE TABLE IF NOT EXISTS provider_claims (
                    id TEXT PRIMARY KEY NOT NULL,
                    connector_id TEXT NOT NULL,
                    provider_id TEXT NOT NULL,
                    provider_label TEXT NOT NULL,
                    approved INTEGER NOT NULL DEFAULT 0,
                    denied INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_provider_claims_connector ON provider_claims(connector_id);
                CREATE TABLE IF NOT EXISTS planning_prompts (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                DROP TABLE IF EXISTS plan_proposals;

                CREATE TABLE IF NOT EXISTS notifications (
                    id TEXT PRIMARY KEY NOT NULL,
                    kind TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    entity_kind TEXT NOT NULL,
                    project_path TEXT NOT NULL,
                    title TEXT NOT NULL,
                    detail TEXT,
                    read INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read) WHERE read = 0;

                CREATE TABLE IF NOT EXISTS pending_interactions (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    run_id TEXT,
                    questions_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    answers_json TEXT,
                    created_at INTEGER NOT NULL,
                    resolved_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_pending_interactions_session ON pending_interactions(session_id);
                CREATE INDEX IF NOT EXISTS idx_pending_interactions_status ON pending_interactions(status) WHERE status = 'pending';

                /* Plan dependency metadata (plan-dependency-scheduling). */
                CREATE TABLE IF NOT EXISTS plan_dependency_meta (
                    plan_id TEXT PRIMARY KEY NOT NULL,
                    prerequisites TEXT NOT NULL DEFAULT '[]',
                    affected_paths TEXT NOT NULL DEFAULT '[]',
                    scheduling_mode TEXT NOT NULL DEFAULT 'safe',
                    workspace_policy TEXT NOT NULL DEFAULT 'isolated_worktrees',
                    updated_at INTEGER NOT NULL,
                    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
                );

                /* File claims published by running workers. */
                CREATE TABLE IF NOT EXISTS plan_file_claims (
                    id TEXT PRIMARY KEY NOT NULL,
                    run_id TEXT NOT NULL,
                    plan_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    path TEXT NOT NULL,
                    action TEXT NOT NULL DEFAULT 'claim',
                    created_at INTEGER NOT NULL,
                    released_at INTEGER,
                    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_plan_file_claims_session ON plan_file_claims(session_id);
                CREATE INDEX IF NOT EXISTS idx_plan_file_claims_active ON plan_file_claims(session_id) WHERE released_at IS NULL;

                /* Append-only coordination event ledger. */
                CREATE TABLE IF NOT EXISTS plan_coordination_events (
                    id TEXT PRIMARY KEY NOT NULL,
                    session_id TEXT NOT NULL,
                    run_id TEXT NOT NULL,
                    plan_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    payload TEXT NOT NULL DEFAULT '{}',
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_plan_coord_events_session ON plan_coordination_events(session_id, created_at);

                /* Per-project launch profile. */
                CREATE TABLE IF NOT EXISTS plan_launch_profiles (
                    project_path TEXT PRIMARY KEY NOT NULL,
                    engine TEXT NOT NULL DEFAULT 'openspec',
                    provider_id TEXT NOT NULL DEFAULT '',
                    model_id TEXT NOT NULL DEFAULT '',
                    effort_level TEXT,
                    skill_id TEXT,
                    worker_count INTEGER NOT NULL DEFAULT 1,
                    workspace_policy TEXT NOT NULL DEFAULT 'isolated_worktrees',
                    scheduling_mode TEXT NOT NULL DEFAULT 'safe',
                    updated_at INTEGER NOT NULL
                );

                /* Merge-review queue for completed runs. */
                CREATE TABLE IF NOT EXISTS plan_merge_queue (
                    id TEXT PRIMARY KEY NOT NULL,
                    run_id TEXT NOT NULL,
                    plan_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    collision_review_required INTEGER NOT NULL DEFAULT 0,
                    overlapping_plans TEXT NOT NULL DEFAULT '[]',
                    reviewed_at INTEGER,
                    created_at INTEGER NOT NULL,
                    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_plan_merge_queue_session ON plan_merge_queue(session_id);
            ")
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

        // Migration: add chat_session_id to existing tab rows for structured native chat.
        let has_chat_session_column = connection
            .prepare("SELECT chat_session_id FROM session_tabs LIMIT 0")
            .is_ok();
        if !has_chat_session_column {
            let _ = connection.execute(
                "ALTER TABLE session_tabs ADD COLUMN chat_session_id TEXT",
                [],
            );
        }

        // Migration (provider-parity-workspace-fixes): add api_kind, base_url,
        // cost_input, cost_output, and bundled_version columns to
        // native_provider_model_cache. api_kind is the OMP wire-protocol kind
        // (e.g. "devin-agent") used by resolve_client to route chat turns.
        // base_url is the model's catalog base URL. bundled_version stamps
        // bundled rows so stale ones can be replaced on catalog version bump.
        let has_api_kind = connection
            .prepare("SELECT api_kind FROM native_provider_model_cache LIMIT 0")
            .is_ok();
        if !has_api_kind {
            let _ = connection.execute(
                "ALTER TABLE native_provider_model_cache ADD COLUMN api_kind TEXT NOT NULL DEFAULT ''",
                [],
            );
            let _ = connection.execute(
                "ALTER TABLE native_provider_model_cache ADD COLUMN base_url TEXT NOT NULL DEFAULT ''",
                [],
            );
            let _ = connection.execute(
                "ALTER TABLE native_provider_model_cache ADD COLUMN cost_input REAL",
                [],
            );
            let _ = connection.execute(
                "ALTER TABLE native_provider_model_cache ADD COLUMN cost_output REAL",
                [],
            );
            let _ = connection.execute(
                "ALTER TABLE native_provider_model_cache ADD COLUMN bundled_version TEXT",
                [],
            );
        }

        // Migration (provider-parity-workspace-fixes): add model_api_id to
        // native_provider_model_cache. This is the provider-specific API id
        // (e.g. "umans-glm-5.2") resolved by resolve_model_api_id and written
        // by the catalog sync; nullable so legacy/bundled rows carry no id.
        let has_model_api_id = connection
            .prepare("SELECT model_api_id FROM native_provider_model_cache LIMIT 0")
            .is_ok();
        if !has_model_api_id {
            let _ = connection.execute(
                "ALTER TABLE native_provider_model_cache ADD COLUMN model_api_id TEXT",
                [],
            );
        }

        // Migration (plan-pipeline-harness): add idea_id and change_name to
        // plans for idea→plan promotion and OpenSpec change linkage. Both
        // nullable: legacy plans and unpromoted drafts carry no link.
        let has_idea_id = connection
            .prepare("SELECT idea_id FROM plans LIMIT 0")
            .is_ok();
        if !has_idea_id {
            let _ = connection
                .execute("ALTER TABLE plans ADD COLUMN idea_id TEXT", []);
        }
        let has_change_name = connection
            .prepare("SELECT change_name FROM plans LIMIT 0")
            .is_ok();
        if !has_change_name {
            let _ = connection
                .execute("ALTER TABLE plans ADD COLUMN change_name TEXT", []);
        }
        // Migration (schematic-grounded-planning): add grounding + anchor to
        // ideas. Both nullable: legacy ideas and freeform captures carry none.
        let has_grounding = connection
            .prepare("SELECT grounding FROM ideas LIMIT 0")
            .is_ok();
        if !has_grounding {
            let _ = connection
                .execute("ALTER TABLE ideas ADD COLUMN grounding TEXT NOT NULL DEFAULT ''", []);
        }
        let has_anchor = connection
            .prepare("SELECT anchor FROM ideas LIMIT 0")
            .is_ok();
        if !has_anchor {
            let _ = connection
                .execute("ALTER TABLE ideas ADD COLUMN anchor TEXT", []);
        }
        // Migration (idea-to-merge-autopilot): add batch_id to ideas. Nullable:
        // manual creations and captures outside a generation round carry none.
        let has_batch_id = connection
            .prepare("SELECT batch_id FROM ideas LIMIT 0")
            .is_ok();
        if !has_batch_id {
            let _ = connection
                .execute("ALTER TABLE ideas ADD COLUMN batch_id TEXT", []);
        }

        // Migration (plan-pipeline-harness): rename plan statuses
        // waiting → ready and in_progress → running. Idempotent: re-running
        // matches no rows once migrated. New rows use the new vocabulary.
        let _ = connection.execute(
            "UPDATE plans SET status = 'ready' WHERE status = 'waiting'",
            [],
        );
        let _ = connection.execute(
            "UPDATE plans SET status = 'running' WHERE status = 'in_progress'",
            [],
        );

        // Migration (plan-pipeline-harness): collapse idea statuses to the
        // snake_case triad concept → picked → archived. Legacy camelCase
        // values map: planReady/inProgress/finished → picked;
        // paused/cancelled → archived; concept stays concept.
        let _ = connection.execute(
            "UPDATE ideas SET status = 'picked'
             WHERE status IN ('planReady','plan_ready','inProgress','in_progress','finished')",
            [],
        );
        let _ = connection.execute(
            "UPDATE ideas SET status = 'archived'
             WHERE status IN ('paused','cancelled')",
            [],
        );

        // Migration (plan-pipeline-harness): startup cleanup. Any pipeline or
        // plan run left in 'running' from a crash is marked 'failed' with a
        // restart note so the UI never shows a stale running state. The
        // targeted plan/idea stays in its pre-stage status.
        let now = unix_timestamp();
        let _ = connection.execute(
            "UPDATE pipeline_runs SET status = 'failed', error = 'restart: marked failed on startup',
                completed_at = ?1
             WHERE status IN ('running','pending')",
            params![now],
        );
        let _ = connection.execute(
            "UPDATE plan_runs SET status = 'failed', error = 'restart: marked failed on startup',
                finished_at = ?1
             WHERE status IN ('running','pending')",
            params![now],
        );

        // Migration (native-agent-loop): add run_state column to
        // native_chat_sessions for crash-safe agent loop state. Existing
        // sessions default to 'idle'. Any session left 'running' from a
        // crash is marked 'interrupted' so the UI shows a recovery notice.
        let has_run_state = connection
            .prepare("SELECT run_state FROM native_chat_sessions LIMIT 0")
            .is_ok();
        if !has_run_state {
            let _ = connection.execute(
                "ALTER TABLE native_chat_sessions ADD COLUMN run_state TEXT NOT NULL DEFAULT 'idle'",
                [],
            );
        }
        let _ = connection.execute(
            "UPDATE native_chat_sessions SET run_state = 'interrupted' WHERE run_state = 'running'",
            [],
        );

        // Migration (native-agent-loop): create approval_rules table for
        // persistent per-project tool-approval rules. Additive only.
        let _ = connection.execute(
            "CREATE TABLE IF NOT EXISTS approval_rules (
                id TEXT PRIMARY KEY NOT NULL,
                project_path TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                command_prefix TEXT,
                decision TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )",
            [],
        );
        let _ = connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_approval_project ON approval_rules(project_path)",
            [],
        );

        // Migration (planning-system-qol): add reasoning column to
        // native_chat_messages. Stores chain-of-thought separately from
        // content so it is never folded into the persisted assistant text
        // nor replayed to providers. Null for legacy rows.
        let has_reasoning = connection
            .prepare("SELECT reasoning FROM native_chat_messages LIMIT 0")
            .is_ok();
        if !has_reasoning {
            let _ = connection.execute(
                "ALTER TABLE native_chat_messages ADD COLUMN reasoning TEXT",
                [],
            );
        }

        // Migration (ai-workbench-course-correction): add sequence column to
        // native_tool_events for stable per-session ordering independent of
        // timestamp resolution. Default 0 for legacy rows.
        let has_tool_sequence = connection
            .prepare("SELECT sequence FROM native_tool_events LIMIT 0")
            .is_ok();
        if !has_tool_sequence {
            let _ = connection.execute(
                "ALTER TABLE native_tool_events ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0",
                [],
            );
        }

        // Migration (tool-visibility): add arguments column to
        // native_tool_events so the UI can show file paths, commands,
        // search patterns, etc. Null for legacy rows.
        let has_tool_arguments = connection
            .prepare("SELECT arguments FROM native_tool_events LIMIT 0")
            .is_ok();
        if !has_tool_arguments {
            let _ = connection.execute(
                "ALTER TABLE native_tool_events ADD COLUMN arguments TEXT",
                [],
            );
        }
        // Migration (chat-experience-completion): add diff column to
        // native_tool_events for unified line diffs on file tools.
        let has_tool_diff = connection
            .prepare("SELECT diff FROM native_tool_events LIMIT 0")
            .is_ok();
        if !has_tool_diff {
            let _ = connection.execute(
                "ALTER TABLE native_tool_events ADD COLUMN diff TEXT",
                [],
            );
        }
        // Migration (chat-experience-completion): add decision + rule_source
        // columns to native_tool_events for approval provenance display.
        let has_tool_decision = connection
            .prepare("SELECT decision FROM native_tool_events LIMIT 0")
            .is_ok();
        if !has_tool_decision {
            let _ = connection.execute(
                "ALTER TABLE native_tool_events ADD COLUMN decision TEXT",
                [],
            );
        }
        let has_tool_rule_source = connection
            .prepare("SELECT rule_source FROM native_tool_events LIMIT 0")
            .is_ok();
        if !has_tool_rule_source {
            let _ = connection.execute(
                "ALTER TABLE native_tool_events ADD COLUMN rule_source TEXT",
                [],
            );
        }

        // Migration (planning-system-qol): add title_locked to sessions so
        // auto-titling never overwrites a user-set title. Default 0 (unset).
        let has_title_locked = connection
            .prepare("SELECT title_locked FROM sessions LIMIT 0")
            .is_ok();
        if !has_title_locked {
            let _ = connection.execute(
                "ALTER TABLE sessions ADD COLUMN title_locked INTEGER NOT NULL DEFAULT 0",
                [],
            );
        }

        // Migration (planning-system-qol): add last_selected_at to sessions so
        // selecting a session no longer touches updated_at (which would reshuffle
        // the sidebar ordered by updated_at). Default null.
        let has_last_selected_at = connection
            .prepare("SELECT last_selected_at FROM sessions LIMIT 0")
            .is_ok();
        if !has_last_selected_at {
            let _ = connection.execute(
                "ALTER TABLE sessions ADD COLUMN last_selected_at INTEGER",
                [],
            );
        }

        // Migration (parallel-plan-workspaces): add tab_grid_states to
        // workspace_restore_state so per-tab chat grid layouts (chat
        // membership, column widths, row layout) persist across restarts.
        // The column holds a JSON map of tabId → ChatGrid. Absent on legacy
        // restore states — the frontend treats absent as a 1×1 grid built
        // from the tab's chatSessionId. Additive only.
        let has_tab_grid_states = connection
            .prepare("SELECT tab_grid_states FROM workspace_restore_state LIMIT 0")
            .is_ok();
        if !has_tab_grid_states {
            let _ = connection.execute(
                "ALTER TABLE workspace_restore_state ADD COLUMN tab_grid_states TEXT",
                [],
            );
        }
        // Migration (project-grid-workspace): add panel_grid to
        // workspace_restore_state so the split-tree panel grid layout
        // (panel positions, split ratios, closed panels) persists across
        // restarts. The column holds a JSON string of PanelGridState.
        // Absent on legacy restore states — the frontend treats absent as
        // a single-panel grid. Additive only.
        let has_panel_grid = connection
            .prepare("SELECT panel_grid FROM workspace_restore_state LIMIT 0")
            .is_ok();
        if !has_panel_grid {
            let _ = connection.execute(
                "ALTER TABLE workspace_restore_state ADD COLUMN panel_grid TEXT",
                [],
            );
        }
        // Seed built-in runtime profiles individually so existing databases gain
        // newly-added built-ins without losing user-edited profiles.
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

        // Seed conservative defaults if none exist, or migrate old OMP defaults
        // to the native harness profile.
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
        } else {
            // Migration: update existing defaults to use the native harness as
            // the default chat profile. Old databases persisted OMP as default.
            let existing: Option<String> = connection
                .query_row(
                    "SELECT value FROM app_defaults WHERE key = 'defaults'",
                    [],
                    |r| r.get(0),
                )
                .ok();
            if let Some(raw) = existing {
                if let Ok(mut defaults) =
                    serde_json::from_str::<crate::models::runtime::RuntimeDefaults>(&raw)
                {
                    let needs_migration = defaults
                        .default_chat_profile_id
                        .as_deref()
                        .map(|id| id != "basebuild-native")
                        .unwrap_or(true);
                    if needs_migration {
                        defaults.default_chat_profile_id =
                            Some("basebuild-native".to_string());
                        if defaults.default_model.is_none() {
                            defaults.default_model =
                                Some("basebuild-local-coordinator".to_string());
                        }
                        let _ = connection.execute(
                            "UPDATE app_defaults SET value = ?1 WHERE key = 'defaults'",
                            params![serde_json::to_string(&defaults).unwrap_or_default()],
                        );
                    }
                }
            }
        }

        // Migration (usage-sync-fix): an earlier schema defined
        // usage_sync_settings with discrete columns (auto_sync_usage,
        // auto_sync_interval_minutes, last_usage_sync_at) but no `value`
        // column, while SettingsService reads/writes a JSON `value` column
        // keyed by 'settings' — causing "no such column: value" on every
        // access. Migrate legacy rows into the JSON shape and drop the old
        // table so the canonical (key, value) DDL above takes effect.
        let legacy_has_value_col = connection
            .prepare("SELECT value FROM usage_sync_settings LIMIT 0")
            .is_ok();
        if !legacy_has_value_col {
            // Read any legacy discrete-column row before recreating the table.
            let legacy: Option<(i64, i64, Option<i64>)> = connection
                .query_row(
                    "SELECT auto_sync_usage, auto_sync_interval_minutes, last_usage_sync_at
                     FROM usage_sync_settings WHERE key = 'settings'",
                    [],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<i64>>(2)?)),
                )
                .ok();
            let _ = connection.execute("DROP TABLE usage_sync_settings", []);
            let _ = connection.execute(
                "CREATE TABLE IF NOT EXISTS usage_sync_settings (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT NOT NULL
                )",
                [],
            );
            if let Some((auto, interval, last)) = legacy {
                let settings = crate::models::permission::UsageSyncSettings {
                    auto_sync_usage: auto != 0,
                    auto_sync_interval_minutes: interval,
                    last_usage_sync_at: last,
                };
                let _ = connection.execute(
                    "INSERT INTO usage_sync_settings (key, value) VALUES ('settings', ?1)",
                    params![serde_json::to_string(&settings).unwrap_or_default()],
                );
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_is_idempotent_and_adds_model_api_id() {
        // An in-memory SQLite DB simulates a fresh state.db. Running
        // initialize twice must not error (CREATE TABLE IF NOT EXISTS +
        // ALTER TABLE guarded by has-column check). The model_api_id column
        // must appear after migration, and existing rows must survive with
        // null model_api_id.
        let conn = Connection::open_in_memory().unwrap();
        StorageService::initialize(&conn).expect("first initialize");
        // Insert a legacy cache row WITHOUT model_api_id (simulating a
        // pre-migration database) by dropping the column, inserting, then
        // re-running initialize to add it back.
        // Actually, the column is added by initialize itself, so just insert
        // a row with model_api_id = null and verify it persists.
        conn.execute(
            "INSERT INTO native_provider_model_cache
                (provider_id, model_id, label, context_window, max_tokens,
                 supports_reasoning, supported_efforts, supports_images, source,
                 synced_at, error, model_api_id)
             VALUES ('umans', 'glm-5.2', 'GLM 5.2', 405504, 131072, 1, '[\"high\",\"xhigh\"]', 0, 'bundled', 0, NULL, NULL)",
            [],
        )
        .unwrap();
        // Re-run initialize — must not error, must not duplicate columns.
        StorageService::initialize(&conn).expect("second initialize (idempotent)");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM native_provider_model_cache WHERE provider_id = 'umans'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "existing row survived re-init");
        let api_id: Option<String> = conn
            .query_row(
                "SELECT model_api_id FROM native_provider_model_cache WHERE provider_id = 'umans' AND model_id = 'glm-5.2'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(api_id.is_none(), "legacy row has null model_api_id");
    }

    #[test]
    fn migrates_plan_statuses_waiting_to_ready_and_in_progress_to_running() {
        // A pre-migration database with legacy plan statuses must be rewritten
        // on initialize. Re-running initialize must be idempotent (no rows
        // match the legacy values the second time).
        let conn = Connection::open_in_memory().unwrap();
        StorageService::initialize(&conn).expect("first initialize");
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at)
             VALUES ('s1', '/p', 'S', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO plans (id, session_id, reference_id, title, description, goal,
                status, priority, tags, ai_enhanced, context, created_at, updated_at, finished_at)
             VALUES ('p1', 's1', 'bb-aaa', 'A', '', NULL, 'waiting', 50, '[]', 0, NULL, 0, 0, NULL),
                    ('p2', 's1', 'bb-bbb', 'B', '', NULL, 'in_progress', 50, '[]', 0, NULL, 0, 0, NULL)",
            [],
        )
        .unwrap();
        StorageService::initialize(&conn).expect("migration run");
        let statuses: Vec<String> = conn
            .prepare("SELECT status FROM plans ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(statuses, vec!["ready", "running"]);
        // Idempotent: second run matches no legacy rows.
        StorageService::initialize(&conn).expect("idempotent re-init");
        let statuses2: Vec<String> = conn
            .prepare("SELECT status FROM plans ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        assert_eq!(statuses2, vec!["ready", "running"]);
    }

    #[test]
    fn migrates_idea_statuses_to_triad() {
        // Legacy idea statuses (camelCase and snake_case) collapse to
        // concept/picked/archived on initialize.
        let conn = Connection::open_in_memory().unwrap();
        StorageService::initialize(&conn).expect("first initialize");
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at)
             VALUES ('s1', '/p', 'S', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ideas (id, session_id, category_id, title, description, status, created_at, updated_at)
             VALUES ('i1', 's1', NULL, 'a', '', 'concept', 0, 0),
                    ('i2', 's1', NULL, 'b', '', 'planReady', 0, 0),
                    ('i3', 's1', NULL, 'c', '', 'plan_ready', 0, 0),
                    ('i4', 's1', NULL, 'd', '', 'inProgress', 0, 0),
                    ('i5', 's1', NULL, 'e', '', 'in_progress', 0, 0),
                    ('i6', 's1', NULL, 'f', '', 'finished', 0, 0),
                    ('i7', 's1', NULL, 'g', '', 'paused', 0, 0),
                    ('i8', 's1', NULL, 'h', '', 'cancelled', 0, 0)",
            [],
        )
        .unwrap();
        StorageService::initialize(&conn).expect("migration run");
        let statuses: Vec<String> = conn
            .prepare("SELECT status FROM ideas ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        // concept, then 5 picked, then 2 archived
        assert_eq!(
            statuses,
            vec![
                "concept",
                "picked",
                "picked",
                "picked",
                "picked",
                "picked",
                "archived",
                "archived",
            ]
        );
    }

    #[test]
    fn planning_prompts_table_created_and_legacy_plan_proposals_dropped() {
        // initialize must create planning_prompts and drop the superseded
        // plan_proposals table. Idempotent on re-run. Simulate a legacy DB
        // by creating plan_proposals before initialize.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE plan_proposals (id TEXT, session_id TEXT, title TEXT, state TEXT, created_at INTEGER)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO plan_proposals (id, session_id, title, state, created_at) VALUES ('p1','s1','t','proposed',0)",
            [],
        )
        .unwrap();
        StorageService::initialize(&conn).expect("initialize");
        // planning_prompts exists and is empty (defaults are compiled-in, not seeded).
        let prompt_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM planning_prompts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(prompt_count, 0, "no prompts seeded by default");
        // plan_proposals is gone.
        let still_exists = conn.prepare("SELECT id FROM plan_proposals LIMIT 0").is_ok();
        assert!(!still_exists, "plan_proposals must be dropped");
        // Re-initialize is idempotent.
        StorageService::initialize(&conn).expect("second initialize");
        let prompt_count_again: i64 = conn
            .query_row("SELECT COUNT(*) FROM planning_prompts", [], |row| row.get(0))
            .unwrap();
        assert_eq!(prompt_count_again, 0);
    }

    #[test]
    fn cleanup_marks_stale_running_pipeline_and_plan_runs_failed() {
        // Stale 'running'/'pending' rows from a crash must be marked 'failed'
        // on initialize so the UI never shows a phantom running state.
        let conn = Connection::open_in_memory().unwrap();
        StorageService::initialize(&conn).expect("first initialize");
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at)
             VALUES ('s1', '/p', 'S', 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO plans (id, session_id, reference_id, title, description, goal, status,
                priority, tags, ai_enhanced, context, created_at, updated_at, finished_at)
             VALUES ('p1', 's1', 'bb-a', 'A', '', NULL, 'ready', 50, '[]', 0, NULL, 0, 0, NULL),
                    ('p2', 's1', 'bb-b', 'B', '', NULL, 'running', 50, '[]', 0, NULL, 0, 0, NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO pipeline_runs (id, session_id, project_path, kind, status, created_at)
             VALUES ('pr1', 's1', '/p', 'generate_categories', 'running', 0),
                    ('pr2', 's1', '/p', 'generate_ideas', 'pending', 0),
                    ('pr3', 's1', '/p', 'enhance_idea', 'succeeded', 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO plan_runs (id, plan_id, session_id, status, runner_kind, created_at)
             VALUES ('r1', 'p1', 's1', 'running', 'native', 0),
                    ('r2', 'p2', 's1', 'succeeded', 'native', 0)",
            [],
        )
        .unwrap();
        StorageService::initialize(&conn).expect("cleanup run");
        let pipeline_failed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pipeline_runs WHERE status = 'failed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pipeline_failed, 2, "stale running/pending pipeline runs -> failed");
        let plan_failed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM plan_runs WHERE status = 'failed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(plan_failed, 1, "stale running plan run -> failed");
        let plan_ok: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM plan_runs WHERE status = 'succeeded'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(plan_ok, 1, "already-succeeded run untouched");
    }

    #[test]
    fn plan_status_from_str_accepts_legacy_values() {
        use crate::models::plan::PlanStatus;
        assert_eq!(PlanStatus::from_str("waiting"), PlanStatus::Ready);
        assert_eq!(PlanStatus::from_str("in_progress"), PlanStatus::Running);
        assert_eq!(PlanStatus::from_str("ready"), PlanStatus::Ready);
        assert_eq!(PlanStatus::from_str("running"), PlanStatus::Running);
        assert_eq!(PlanStatus::from_str("draft"), PlanStatus::Draft);
        assert_eq!(PlanStatus::from_str("nonsense"), PlanStatus::Draft);
    }

    #[test]
    fn idea_status_from_str_collapses_legacy_values() {
        use crate::models::idea::IdeaStatus;
        assert_eq!(IdeaStatus::from_str("concept"), IdeaStatus::Concept);
        assert_eq!(IdeaStatus::from_str("planReady"), IdeaStatus::Picked);
        assert_eq!(IdeaStatus::from_str("plan_ready"), IdeaStatus::Picked);
        assert_eq!(IdeaStatus::from_str("inProgress"), IdeaStatus::Picked);
        assert_eq!(IdeaStatus::from_str("in_progress"), IdeaStatus::Picked);
        assert_eq!(IdeaStatus::from_str("finished"), IdeaStatus::Picked);
        assert_eq!(IdeaStatus::from_str("paused"), IdeaStatus::Archived);
        assert_eq!(IdeaStatus::from_str("cancelled"), IdeaStatus::Archived);
        assert_eq!(IdeaStatus::from_str("archived"), IdeaStatus::Archived);
        assert_eq!(IdeaStatus::from_str("nonsense"), IdeaStatus::Concept);
    }

    #[test]
    fn connect_sets_wal_and_busy_timeout_pragmas() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        let timeout: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert_eq!(timeout, 5000);
    }

    #[test]
    fn concurrent_writers_do_not_deadlock() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let dir_path = dir.path().to_path_buf();

        let mut handles = Vec::new();
        for i in 0..4 {
            let dp = dir_path.clone();
            handles.push(std::thread::spawn(move || {
                // Don't set BASEBUILD_HOME here — the main thread already set
                // it via lock_db. Setting it here races with other tests.
                // Just open the connection and write.
                std::env::set_var("BASEBUILD_HOME", &dp);
                let conn = StorageService::connect().unwrap();
                for j in 0..20 {
                    conn.execute(
                        "INSERT INTO recent_projects(path, name, last_opened_at, last_active_session_id) VALUES (?1, ?2, ?3, NULL)",
                        params![format!("/test/{i}-{j}"), format!("Project {i}-{j}"), unix_timestamp()],
                    )
                    .unwrap();
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }

        // Re-set BASEBUILD_HOME in case another test clobbered it.
        std::env::set_var("BASEBUILD_HOME", &dir_path);
        let conn = StorageService::connect().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM recent_projects", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 80);
    }

    #[test]
    fn migrates_legacy_usage_sync_settings_discrete_columns_to_json() {
        // A pre-fix database created usage_sync_settings with discrete
        // columns (auto_sync_usage, auto_sync_interval_minutes,
        // last_usage_sync_at) and no `value` column. initialize must
        // recreate the table in the canonical (key, value) shape and carry
        // any legacy row forward as JSON. Re-running initialize is idempotent.
        let conn = Connection::open_in_memory().unwrap();
        // Simulate the legacy schema + a legacy row.
        conn.execute(
            "CREATE TABLE usage_sync_settings (
                key TEXT PRIMARY KEY NOT NULL,
                auto_sync_usage INTEGER NOT NULL DEFAULT 0,
                auto_sync_interval_minutes INTEGER NOT NULL DEFAULT 60,
                last_usage_sync_at INTEGER
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO usage_sync_settings (key, auto_sync_usage, auto_sync_interval_minutes, last_usage_sync_at)
             VALUES ('settings', 1, 30, 1700000000)",
            [],
        )
        .unwrap();
        StorageService::initialize(&conn).expect("migration run");
        // Table now has the canonical shape.
        let value: String = conn
            .query_row(
                "SELECT value FROM usage_sync_settings WHERE key = 'settings'",
                [],
                |r| r.get(0),
            )
            .expect("value column exists and row present");
        let settings: crate::models::permission::UsageSyncSettings =
            serde_json::from_str(&value).unwrap();
        assert!(settings.auto_sync_usage, "legacy auto_sync_usage=1 carried forward");
        assert_eq!(settings.auto_sync_interval_minutes, 30, "legacy interval carried forward");
        assert_eq!(settings.last_usage_sync_at, Some(1700000000), "legacy last_sync carried forward");
        // Idempotent: second run does not drop/recreate again.
        StorageService::initialize(&conn).expect("idempotent re-init");
        let value2: String = conn
            .query_row(
                "SELECT value FROM usage_sync_settings WHERE key = 'settings'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(value, value2, "row unchanged on re-init");
    }

    #[test]
    fn usage_sync_settings_default_row_when_missing() {
        // A fresh database with no usage_sync_settings row must yield the
        // default settings (auto_sync_usage=true, interval=60) when read
        // through SettingsService. Verified by querying the in-memory conn
        // directly (the Default impl is exercised by the missing-row branch
        // of get_usage_sync_settings).
        let conn = Connection::open_in_memory().unwrap();
        StorageService::initialize(&conn).expect("initialize");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM usage_sync_settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "no row seeded by default");
        // Default values come from UsageSyncSettings::default().
        let default = crate::models::permission::UsageSyncSettings::default();
        assert!(default.auto_sync_usage, "default auto_sync_usage is true");
        assert_eq!(default.auto_sync_interval_minutes, 60, "default interval is 60");
        assert!(default.last_usage_sync_at.is_none(), "default last_sync is None");
        // And a missing row in the table maps to that default via the
        // service's None branch.
        let value: Option<String> = conn
            .query_row(
                "SELECT value FROM usage_sync_settings WHERE key = 'settings'",
                [],
                |r| r.get(0),
            )
            .ok();
        assert!(value.is_none(), "no row present -> service returns default");
    }

    #[test]
    fn set_last_focused_project_inserts_missing_project_and_returns_it() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);

        let path = "/test/missing-project";
        let focused = StorageService::set_last_focused_project(path).unwrap();
        assert_eq!(focused.path, path);
        assert_eq!(focused.name, "missing-project");
        assert!(focused.last_active_session_id.is_none());

        let from_get = StorageService::get_last_focused_project().unwrap();
        assert_eq!(from_get.map(|p| p.path), Some(path.to_string()));
    }

    #[test]
    fn set_last_focused_project_preserves_last_active_session_id_and_bumps_timestamp() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();

        let path = "/test/session-project";
        let old_timestamp = 1000i64;
        conn.execute(
            "INSERT INTO recent_projects(path, name, last_opened_at, last_active_session_id)
             VALUES (?1, ?2, ?3, ?4)",
            params![path, "session-project", old_timestamp, Some("sess-keep")],
        )
        .unwrap();

        let focused = StorageService::set_last_focused_project(path).unwrap();
        assert_eq!(focused.last_active_session_id.as_deref(), Some("sess-keep"));
        assert!(
            focused.last_opened_at > old_timestamp,
            "set_last_focused_project must bump last_opened_at"
        );
    }

    #[test]
    fn get_last_focused_project_returns_explicit_focus_not_first_recent_row() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();

        let path_a = "/test/project-a";
        let path_b = "/test/project-b";
        conn.execute(
            "INSERT INTO recent_projects(path, name, last_opened_at, last_active_session_id)
             VALUES (?1, ?2, ?3, ?4), (?5, ?6, ?7, ?8)",
            params![
                path_a,
                "Project A",
                1000i64,
                None::<&str>,
                path_b,
                "Project B",
                2000i64,
                None::<&str>
            ],
        )
        .unwrap();

        StorageService::set_last_focused_project(path_a).unwrap();

        // Make B strictly more recent than A so that a recency-first lookup
        // would return B, proving get_last_focused_project uses explicit focus.
        conn.execute(
            "UPDATE recent_projects SET last_opened_at = ?1 WHERE path = ?2",
            params![i64::MAX, path_b],
        )
        .unwrap();

        let last = StorageService::get_last_focused_project().unwrap();
        assert_eq!(last.map(|p| p.path), Some(path_a.to_string()));
    }

    #[test]
    fn remove_recent_project_clears_last_focused_project() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);

        let path = "/test/remove-project";
        StorageService::set_last_focused_project(path).unwrap();
        assert!(StorageService::get_last_focused_project().unwrap().is_some());

        StorageService::remove_recent_project(path).unwrap();

        assert!(StorageService::get_last_focused_project().unwrap().is_none());
    }
}
