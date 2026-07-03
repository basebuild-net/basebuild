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

    pub fn list_sessions(project_path: &str) -> DbResult<Vec<Session>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, project_path, title, created_at, updated_at FROM sessions WHERE project_path = ?1 ORDER BY updated_at DESC",
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
        conn.execute(
            "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now(), id],
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

    pub fn create_idea(
        session_id: &str,
        title: &str,
        description: &str,
        category_id: Option<&str>,
    ) -> DbResult<Idea> {
        let idea = Idea {
            id: gen_id(),
            session_id: session_id.to_string(),
            category_id: category_id.map(str::to_string),
            title: title.to_string(),
            description: description.to_string(),
            status: IdeaStatus::Concept,
            created_at: now(),
            updated_at: now(),
        };
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO ideas (id, session_id, category_id, title, description, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![idea.id, idea.session_id, idea.category_id, idea.title, idea.description, idea.status.as_str(), idea.created_at, idea.updated_at],
        ).map_err(|e| e.to_string())?;
        Self::touch_session(session_id)?;
        Ok(idea)
    }

    pub fn list_ideas(session_id: &str) -> DbResult<Vec<Idea>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn.prepare(
            "SELECT id, session_id, category_id, title, description, status, created_at, updated_at FROM ideas WHERE session_id = ?1 ORDER BY created_at ASC",
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
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
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

    pub fn delete_idea(id: &str) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM ideas WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
