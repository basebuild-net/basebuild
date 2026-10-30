//! Per-session todo checklist maintained by the `todo_write` tool. Each call
//! replaces the whole list, so storage is one JSON row per session.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::models::native_chat::NativeTodoItem;
use crate::services::storage_service::StorageService;

pub const MAX_TODO_ITEMS: usize = 50;
pub const MAX_TODO_CONTENT_CHARS: usize = 300;
const STATUSES: [&str; 3] = ["pending", "in_progress", "completed"];

pub struct TodoService;

impl TodoService {
    /// Validate `todo_write` arguments. One bad item rejects the whole list so
    /// the model retries with a complete, consistent checklist.
    pub fn parse_arguments(args: &Value) -> Result<Vec<NativeTodoItem>, String> {
        let todos = args
            .get("todos")
            .and_then(Value::as_array)
            .ok_or_else(|| "Missing required parameter: todos (array)".to_string())?;
        if todos.len() > MAX_TODO_ITEMS {
            return Err(format!(
                "todos has {} items; the limit is {MAX_TODO_ITEMS}",
                todos.len()
            ));
        }
        let mut items = Vec::with_capacity(todos.len());
        let mut in_progress = 0usize;
        for (index, raw) in todos.iter().enumerate() {
            let content = raw
                .get("content")
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or("");
            if content.is_empty() {
                return Err(format!("todos[{index}].content must be a non-empty string"));
            }
            if content.chars().count() > MAX_TODO_CONTENT_CHARS {
                return Err(format!(
                    "todos[{index}].content exceeds {MAX_TODO_CONTENT_CHARS} characters"
                ));
            }
            let status = raw.get("status").and_then(Value::as_str).unwrap_or("");
            if !STATUSES.contains(&status) {
                return Err(format!(
                    "todos[{index}].status must be one of pending, in_progress, completed"
                ));
            }
            if status == "in_progress" {
                in_progress += 1;
            }
            items.push(NativeTodoItem {
                content: content.to_string(),
                status: status.to_string(),
            });
        }
        if in_progress > 1 {
            return Err("At most one todo can be in_progress at a time".to_string());
        }
        Ok(items)
    }

    /// Replace the session's checklist. An empty list clears it.
    pub fn save(
        connection: &Connection,
        session_id: &str,
        items: &[NativeTodoItem],
        updated_at: i64,
    ) -> Result<(), String> {
        let items_json = serde_json::to_string(items)
            .map_err(|error| format!("Failed to encode todos: {error}"))?;
        connection
            .execute(
                "INSERT INTO native_chat_todos (session_id, items_json, updated_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(session_id) DO UPDATE SET
                     items_json = excluded.items_json,
                     updated_at = excluded.updated_at",
                params![session_id, items_json, updated_at],
            )
            .map_err(|error| format!("Failed to save todos: {error}"))?;
        Ok(())
    }

    pub fn load(connection: &Connection, session_id: &str) -> Result<Vec<NativeTodoItem>, String> {
        let stored: Option<String> = connection
            .query_row(
                "SELECT items_json FROM native_chat_todos WHERE session_id = ?1",
                params![session_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Failed to load todos: {error}"))?;
        match stored {
            Some(json) => serde_json::from_str(&json)
                .map_err(|error| format!("Stored todos are unreadable: {error}")),
            None => Ok(Vec::new()),
        }
    }

    /// Persist a checklist for a session from the agent loop.
    pub fn replace(session_id: &str, items: &[NativeTodoItem]) -> Result<(), String> {
        let connection = StorageService::connect()?;
        Self::save(&connection, session_id, items, unix_seconds())
    }

    /// Read the current checklist for a session.
    pub fn list(session_id: &str) -> Result<Vec<NativeTodoItem>, String> {
        let connection = StorageService::connect()?;
        Self::load(&connection, session_id)
    }
}

fn unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn item(content: &str, status: &str) -> NativeTodoItem {
        NativeTodoItem {
            content: content.to_string(),
            status: status.to_string(),
        }
    }

    #[test]
    fn parse_accepts_a_valid_checklist() {
        let items = TodoService::parse_arguments(&json!({
            "todos": [
                {"content": "Read the parser", "status": "completed"},
                {"content": "Fix the bug", "status": "in_progress"},
                {"content": "Add a test", "status": "pending"}
            ]
        }))
        .unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[1], item("Fix the bug", "in_progress"));
    }

    #[test]
    fn parse_accepts_an_empty_list_to_clear_the_checklist() {
        assert!(TodoService::parse_arguments(&json!({"todos": []}))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn parse_rejects_bad_arguments() {
        assert!(TodoService::parse_arguments(&json!({})).is_err());
        assert!(TodoService::parse_arguments(&json!({"todos": [
            {"content": "  ", "status": "pending"}
        ]}))
        .is_err());
        assert!(TodoService::parse_arguments(&json!({"todos": [
            {"content": "x", "status": "done"}
        ]}))
        .is_err());
        assert!(TodoService::parse_arguments(&json!({"todos": [
            {"content": "a", "status": "in_progress"},
            {"content": "b", "status": "in_progress"}
        ]}))
        .is_err());
        let too_long = "x".repeat(MAX_TODO_CONTENT_CHARS + 1);
        assert!(TodoService::parse_arguments(&json!({"todos": [
            {"content": too_long, "status": "pending"}
        ]}))
        .is_err());
        let too_many: Vec<Value> = (0..=MAX_TODO_ITEMS)
            .map(|i| json!({"content": format!("step {i}"), "status": "pending"}))
            .collect();
        assert!(TodoService::parse_arguments(&json!({ "todos": too_many })).is_err());
    }

    #[test]
    fn save_and_load_round_trip_and_replace_the_previous_list() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let connection = StorageService::connect().unwrap();
        // The checklist store is exercised without creating chat sessions.
        connection.execute("PRAGMA foreign_keys = OFF", []).unwrap();

        assert!(TodoService::load(&connection, "nchat_a").unwrap().is_empty());

        TodoService::save(
            &connection,
            "nchat_a",
            &[item("first", "pending"), item("second", "in_progress")],
            10,
        )
        .unwrap();
        assert_eq!(
            TodoService::load(&connection, "nchat_a").unwrap(),
            vec![item("first", "pending"), item("second", "in_progress")]
        );

        TodoService::save(&connection, "nchat_a", &[item("only", "completed")], 20).unwrap();
        assert_eq!(
            TodoService::load(&connection, "nchat_a").unwrap(),
            vec![item("only", "completed")]
        );

        // Checklists are scoped per session.
        assert!(TodoService::load(&connection, "nchat_b").unwrap().is_empty());
    }
}
