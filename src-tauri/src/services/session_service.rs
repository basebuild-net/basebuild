use rusqlite::params;

use crate::{
    models::{
        idea::{Idea, IdeaCategory, IdeaStatus},
        session::{Session, SessionTab, TabKind},
    },
    services::storage_service::StorageService,
};

fn gen_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{ts:x}")
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

type DbResult<T> = Result<T, String>;

#[derive(Debug, Default)]
pub struct SessionService;

impl SessionService {
    // ─── Sessions ───

    pub fn create_session(project_path: &str, title: &str) -> DbResult<Session> {
        let session = Session {
            id: gen_id(),
            project_path: project_path.to_string(),
            title: title.to_string(),
            created_at: now(),
            updated_at: now(),
        };
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![session.id, session.project_path, session.title, session.created_at, session.updated_at],
        ).map_err(|e| e.to_string())?;
        Ok(session)
    }

    pub fn get(id: &str) -> DbResult<Option<Session>> {
        let conn = StorageService::connect()?;
        let row = conn
            .query_row(
                "SELECT id, project_path, title, created_at, updated_at FROM sessions WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Session {
                        id: row.get(0)?,
                        project_path: row.get(1)?,
                        title: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                    })
                },
            )
            .ok();
        Ok(row)
    }

    pub fn list_sessions(project_path: &str) -> DbResult<Vec<Session>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn.prepare(
            // Stable ordering by created_at DESC: selection must not reshuffle
            // the list (the old updated_at DESC ordering bumped selection).
            "SELECT id, project_path, title, created_at, updated_at FROM sessions WHERE project_path = ?1 ORDER BY created_at DESC",
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_path], |row| {
                Ok(Session {
                    id: row.get(0)?,
                    project_path: row.get(1)?,
                    title: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn rename_session(id: &str, title: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        // Manual rename sets title_locked so auto-titling never overwrites it.
        conn.execute(
            "UPDATE sessions SET title = ?1, title_locked = 1, updated_at = ?2 WHERE id = ?3",
            params![title, now(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Auto-title a session from its first meaningful activity (first user
    /// message or generate-plans goal). No-ops when the session is title_locked
    /// or already has a non-default title. Returns true if the title changed.
    pub fn auto_title(id: &str, suggested_title: &str) -> DbResult<bool> {
        if suggested_title.trim().is_empty() {
            return Ok(false);
        }
        let conn = StorageService::connect()?;
        let row: Option<(String, i64)> = conn
            .query_row(
                "SELECT title, title_locked FROM sessions WHERE id = ?1",
                params![id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
            )
            .ok();
        let Some((current_title, locked)) = row else {
            return Ok(false);
        };
        // Never overwrite a manual title.
        if locked != 0 {
            return Ok(false);
        }
        // Only auto-title sessions still on the default "Session <ts>" title.
        if !current_title.starts_with("Session ") {
            return Ok(false);
        }
        // Truncate to a short phrase (max ~60 chars on a word boundary).
        let truncated = truncate_title(suggested_title, 60);
        conn.execute(
            "UPDATE sessions SET title = ?1 WHERE id = ?2",
            params![truncated, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// Record that a session was selected, using last_selected_at (not
    /// updated_at) so the sidebar ordering stays stable.
    pub fn set_last_selected(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE sessions SET last_selected_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_session(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "DELETE FROM session_tabs WHERE session_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM idea_categories WHERE session_id = ?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM ideas WHERE session_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn touch_session(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─── Tabs ───

    pub fn create_tab(
        session_id: &str,
        kind: TabKind,
        title: &str,
        terminal_id: Option<u64>,
        file_path: Option<&str>,
        chat_session_id: Option<&str>,
    ) -> DbResult<SessionTab> {
        let tab = SessionTab {
            id: gen_id(),
            session_id: session_id.to_string(),
            kind: kind.clone(),
            title: title.to_string(),
            terminal_id,
            file_path: file_path.map(|s| s.to_string()),
            chat_session_id: chat_session_id.map(str::to_string),
            created_at: now(),
        };
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO session_tabs (id, session_id, kind, title, terminal_id, file_path, chat_session_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![tab.id, tab.session_id, kind.as_str(), tab.title, tab.terminal_id, tab.file_path, tab.chat_session_id, tab.created_at],
        ).map_err(|e| e.to_string())?;
        Self::touch_session(session_id)?;
        Ok(tab)
    }

    pub fn list_tabs(session_id: &str) -> DbResult<Vec<SessionTab>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, kind, title, terminal_id, file_path, chat_session_id, created_at FROM session_tabs WHERE session_id = ?1 ORDER BY created_at ASC",
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                let kind_str: String = row.get(2)?;
                Ok(SessionTab {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    kind: TabKind::from_str(&kind_str),
                    title: row.get(3)?,
                    terminal_id: row.get(4)?,
                    file_path: row.get(5)?,
                    chat_session_id: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn delete_tab(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let session_id: String = conn
            .query_row(
                "SELECT session_id FROM session_tabs WHERE id = ?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap_or_default();
        conn.execute("DELETE FROM session_tabs WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        if !session_id.is_empty() {
            Self::touch_session(&session_id)?;
        }
        Ok(())
    }

    pub fn update_tab_terminal(id: &str, terminal_id: Option<u64>) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE session_tabs SET terminal_id = ?1 WHERE id = ?2",
            params![terminal_id, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_tab_file_path(id: &str, file_path: Option<&str>) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE session_tabs SET file_path = ?1 WHERE id = ?2",
            params![file_path, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_tab_chat_session(id: &str, chat_session_id: Option<&str>) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE session_tabs SET chat_session_id = ?1 WHERE id = ?2",
            params![chat_session_id, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_tab_title(id: &str, title: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE session_tabs SET title = ?1 WHERE id = ?2",
            params![title, id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    // ─── Ideas ───

    pub fn create_category(
        session_id: &str,
        name: &str,
        description: &str,
    ) -> DbResult<IdeaCategory> {
        let cat = IdeaCategory {
            id: gen_id(),
            session_id: session_id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            created_at: now(),
        };
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO idea_categories (id, session_id, name, description, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![cat.id, cat.session_id, cat.name, cat.description, cat.created_at],
        ).map_err(|e| e.to_string())?;
        Ok(cat)
    }

    pub fn list_categories(session_id: &str) -> DbResult<Vec<IdeaCategory>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, name, description, created_at FROM idea_categories WHERE session_id = ?1 ORDER BY created_at ASC",
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(IdeaCategory {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    name: row.get(2)?,
                    description: row.get(3)?,
                    created_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn delete_category(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM idea_categories WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// No-op retained for API compatibility. Default category seeding was
    /// removed (schematic-grounded-planning): categories are project-derived
    /// via "Generate categories from project" or manual add. Existing seeded
    /// categories in old sessions are preserved as user data.
    pub fn ensure_default_categories(_session_id: &str) -> DbResult<()> {
        Ok(())
    }
    pub fn create_idea(
        session_id: &str,
        title: &str,
        description: &str,
        category_id: Option<&str>,
        grounding: &str,
        anchor: Option<&str>,
        batch_id: Option<&str>,
    ) -> DbResult<Idea> {
        let idea = Idea {
            id: gen_id(),
            session_id: session_id.to_string(),
            category_id: category_id.map(str::to_string),
            title: title.to_string(),
            description: description.to_string(),
            status: IdeaStatus::Concept,
            grounding: grounding.to_string(),
            anchor: anchor.map(str::to_string),
            batch_id: batch_id.map(str::to_string),
            created_at: now(),
            updated_at: now(),
        };
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO ideas (id, session_id, category_id, title, description, status, grounding, anchor, batch_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![idea.id, idea.session_id, idea.category_id, idea.title, idea.description, idea.status.as_str(), idea.grounding, idea.anchor, idea.batch_id, idea.created_at, idea.updated_at],
        ).map_err(|e| e.to_string())?;
        Self::touch_session(session_id)?;
        Ok(idea)
    }

    pub fn list_ideas(session_id: &str) -> DbResult<Vec<Idea>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, category_id, title, description, status, grounding, anchor, batch_id, created_at, updated_at FROM ideas WHERE session_id = ?1 ORDER BY created_at ASC",
        ).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                let status_str: String = row.get(5)?;
                Ok(Idea {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    category_id: row.get(2)?,
                    title: row.get(3)?,
                    description: row.get(4)?,
                    status: IdeaStatus::from_str(&status_str),
                    grounding: row.get(6)?,
                    anchor: row.get(7)?,
                    batch_id: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
    pub fn get_idea(id: &str) -> DbResult<Option<Idea>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, category_id, title, description, status, grounding, anchor, batch_id, created_at, updated_at
                 FROM ideas WHERE id = ?1 LIMIT 1",
            )
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map(params![id], |row| {
                let status_str: String = row.get(5)?;
                Ok(Idea {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    category_id: row.get(2)?,
                    title: row.get(3)?,
                    description: row.get(4)?,
                    status: IdeaStatus::from_str(&status_str),
                    grounding: row.get(6)?,
                    anchor: row.get(7)?,
                    batch_id: row.get(8)?,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.next().transpose().map_err(|e| e.to_string())
    }

    pub fn update_idea_status(id: &str, status: IdeaStatus) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "UPDATE ideas SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status.as_str(), now(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Reject an idea: move it to `rejected`. Only `concept` ideas are
    /// rejectable — `picked` ideas already own a plan and cannot be rejected.
    /// Returns an error if the idea is not in `concept` state.
    pub fn reject_idea(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let current_status: String = conn
            .query_row("SELECT status FROM ideas WHERE id = ?1", params![id], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        let status = IdeaStatus::from_str(&current_status);
        if status != IdeaStatus::Concept {
            return Err(format!("Cannot reject idea in '{current_status}' state; only concept ideas can be rejected."));
        }
        conn.execute(
            "UPDATE ideas SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![IdeaStatus::Rejected.as_str(), now(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_idea(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM ideas WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Truncate a title to max_chars, breaking on a word boundary and adding an
/// ellipsis when truncated. Used for auto-titling sessions from first message.
pub(crate) fn truncate_title(s: &str, max_chars: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let truncated: String = s.chars().take(max_chars).collect();
    // Try to break on a word boundary.
    if let Some(last_space) = truncated.rfind(' ') {
        let word_truncated: String = truncated.chars().take(last_space).collect();
        if !word_truncated.is_empty() {
            return format!("{word_truncated}…");
        }
    }
    format!("{truncated}…")
}
