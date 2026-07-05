//! Planning prompt storage: editable overrides for the system prompts used
//! by chat, idea generation, plan generation, and category generation.
//!
//! Each prompt has a compiled default. A user override is persisted as a row
//! in `planning_prompts`. Absence of a row means "use the compiled default".
//! `reset` deletes the row. `list` returns the effective value (override or
//! default) plus the default and a modified flag for the UI.

use crate::{
    models::planning_prompt::{PlanningPromptEntry, CATEGORY_GENERATION, CHAT_SYSTEM, IDEA_GENERATION, PLAN_GENERATION},
    services::storage_service::StorageService,
};
use rusqlite::{params, OptionalExtension};

type DbResult<T> = Result<T, String>;

#[derive(Debug, Default)]
pub struct PlanningPromptService;

/// Compiled-in defaults. These are the source of truth for "reset to default"
/// and for the initial value shown in Settings → Planning.
fn default_for(key: &str) -> Option<&'static str> {
    match key {
        CHAT_SYSTEM => Some(
            "You are the Basebuild native chat harness, an assistant embedded in a local desktop \
             IDE.\nActive project path: {project_path}\nBe concise and practical. Do not modify \
             files, run commands, or commit unless the user explicitly asks.\n\nProject schematic:\n{schematic}",
        ),
        IDEA_GENERATION => Some(
            "Based on the conversation below and the project context, propose 3-6 concrete, \
             actionable ideas for this project.\nRespond with ONLY a JSON array of objects, each \
             with \"title\" (max 8 words) and \"description\" (1-2 sentences). No prose, no code \
             fences.\n\nConversation:\n{conversation}",
        ),
        PLAN_GENERATION => Some(
            "You are a planning assistant. Given the project context and a goal, propose \
             OpenSpec-backed plans. For each plan, call the propose_ideas tool with a title, \
             description, and goal. Do not emit plans as prose — use the tool.",
        ),
        CATEGORY_GENERATION => Some(
            "Given the project schematic, propose 4-6 idea categories that would help direct \
             idea generation (e.g. SEO, Optimization, Design, New Features). Respond with ONLY a \
             JSON array of objects with \"name\" and \"description\".",
        ),
        _ => None,
    }
}

/// All known prompt keys.
pub const ALL_KEYS: &[&str] = &[CHAT_SYSTEM, IDEA_GENERATION, PLAN_GENERATION, CATEGORY_GENERATION];

impl PlanningPromptService {
    /// Get the effective prompt for a key: the saved override if present,
    /// otherwise the compiled default. Returns an error for unknown keys.
    pub fn get(key: &str) -> DbResult<String> {
        let default = default_for(key)
            .ok_or_else(|| format!("Unknown planning prompt key: {key}"))?;
        let conn = StorageService::connect()?;
        let override_value: Option<String> = conn
            .query_row(
                "SELECT value FROM planning_prompts WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(override_value.unwrap_or_else(|| default.to_string()))
    }

    /// Save an override for a key. An empty value is treated as "use default"
    /// (the override row is deleted).
    pub fn set(key: &str, value: &str) -> DbResult<()> {
        if !ALL_KEYS.contains(&key) {
            return Err(format!("Unknown planning prompt key: {key}"));
        }
        let conn = StorageService::connect()?;
        let trimmed = value.trim();
        if trimmed.is_empty() {
            // Empty override = reset to default.
            conn.execute("DELETE FROM planning_prompts WHERE key = ?1", params![key])
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        let now = now_seconds();
        conn.execute(
            "INSERT INTO planning_prompts (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Reset a key to its compiled default (delete the override row).
    pub fn reset(key: &str) -> DbResult<()> {
        if !ALL_KEYS.contains(&key) {
            return Err(format!("Unknown planning prompt key: {key}"));
        }
        let conn = StorageService::connect()?;
        conn.execute("DELETE FROM planning_prompts WHERE key = ?1", params![key])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// List all planning prompts with their effective value, default, and
    /// modified flag.
    pub fn list() -> DbResult<Vec<PlanningPromptEntry>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare("SELECT key, value FROM planning_prompts")
            .map_err(|e| e.to_string())?;
        let overrides: std::collections::HashMap<String, String> = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let mut entries = Vec::with_capacity(ALL_KEYS.len());
        for key in ALL_KEYS {
            let default = default_for(key).unwrap_or("");
            let (value, is_modified) = match overrides.get(*key) {
                Some(v) => (v.clone(), true),
                None => (default.to_string(), false),
            };
            entries.push(PlanningPromptEntry {
                key: key.to_string(),
                value,
                default: default.to_string(),
                is_modified,
            });
        }
        Ok(entries)
    }
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_returns_default_when_no_override() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let _ = StorageService::connect().unwrap();
        let value = PlanningPromptService::get(CHAT_SYSTEM).unwrap();
        assert!(!value.is_empty());
    }

    #[test]
    fn set_and_reset_round_trip() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let _ = StorageService::connect().unwrap();
        // Set an override.
        PlanningPromptService::set(IDEA_GENERATION, "Custom idea prompt").unwrap();
        let value = PlanningPromptService::get(IDEA_GENERATION).unwrap();
        assert_eq!(value, "Custom idea prompt");
        // List shows it as modified.
        let entries = PlanningPromptService::list().unwrap();
        let idea_entry = entries.iter().find(|e| e.key == IDEA_GENERATION).unwrap();
        assert!(idea_entry.is_modified);
        assert_eq!(idea_entry.value, "Custom idea prompt");
        // Reset to default.
        PlanningPromptService::reset(IDEA_GENERATION).unwrap();
        let value = PlanningPromptService::get(IDEA_GENERATION).unwrap();
        assert!(value.contains("propose 3-6"));
        // List shows it as not modified.
        let entries = PlanningPromptService::list().unwrap();
        let idea_entry = entries.iter().find(|e| e.key == IDEA_GENERATION).unwrap();
        assert!(!idea_entry.is_modified);
    }

    #[test]
    fn empty_set_is_treated_as_reset() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let _ = StorageService::connect().unwrap();
        PlanningPromptService::set(PLAN_GENERATION, "Custom").unwrap();
        assert!(PlanningPromptService::get(PLAN_GENERATION).unwrap().contains("Custom"));
        PlanningPromptService::set(PLAN_GENERATION, "   ").unwrap();
        assert!(!PlanningPromptService::get(PLAN_GENERATION).unwrap().contains("Custom"));
    }

    #[test]
    fn unknown_key_errors() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let _ = StorageService::connect().unwrap();
        assert!(PlanningPromptService::get("nonsense").is_err());
        assert!(PlanningPromptService::set("nonsense", "x").is_err());
        assert!(PlanningPromptService::reset("nonsense").is_err());
    }
}
