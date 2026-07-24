//! Planning prompt storage: editable overrides for the system prompts used
//! by chat, idea generation, plan generation, and category generation.
//!
//! Each prompt has a compiled default. A user override is persisted as a row
//! in `planning_prompts`. Absence of a row means "use the compiled default".
//! `reset` deletes the row. `list` returns the effective value (override or
//! default) plus the default and a modified flag for the UI.
use crate::{
    models::planning_prompt::{
        PlanningPromptEntry, CATEGORY_GENERATION, CHAT_SYSTEM, IDEA_GENERATION, PLAN_GENERATION,
    },
    services::{skill_registry_service::SkillRegistryService, storage_service::StorageService},
};

use rusqlite::{params, OptionalExtension};
use std::sync::LazyLock;

type DbResult<T> = Result<T, String>;

#[derive(Debug, Default)]
pub struct PlanningPromptService;

/// Cached bundled skill content. Read once at first access; the skill files
/// ship with the app and do not change at runtime. Updates take effect on
/// restart (app updates replace the binary + bundled skills atomically).
/// Resolved skill content (bundled + user, user-wins). Read once at first
/// access via the skill registry; user-directory changes take effect on
/// restart. The registry resolves both bundled and user `skills/` roots.
static PLANNING_SKILL: LazyLock<Option<String>> =
    LazyLock::new(|| SkillRegistryService::read_content("basebuild-planning"));

/// Compiled-in fallbacks used when the skill file is unavailable (e.g. running
/// from a dev build before skills are copied). The skill file is the source of
/// truth; these exist only so generation never blocks on a missing file.
fn compiled_fallback(key: &str) -> Option<&'static str> {
    match key {
        CHAT_SYSTEM => Some(
            "You are the Basebuild native chat harness, an assistant embedded in a local desktop \
             IDE.\nActive project path: {project_path}\nBe concise and practical. Do not modify \
             files, run commands, or commit unless the user explicitly asks.\n\n\
             Skills: Basebuild ships reusable knowledge modules called skills. Use the list_skills \
             tool to discover available skills, then read_skill to read a skill's full instructions \
             before applying its guidance to the user's project. Skills cover coding standards, \
             planning workflows, framework patterns, and more — always check for a relevant skill \
             before answering domain-specific questions.\n\nProject schematic:\n{schematic}",
        ),
        IDEA_GENERATION => Some(
            "Based on the conversation below and the project context, propose 3-6 concrete, \
             actionable ideas for this project. Each idea must cite grounding (real files or \
             observed gaps). Respond with ONLY a JSON array of objects with \"title\", \
             \"description\", and \"grounding\". No prose, no code fences.\n\nConversation:\n{conversation}",
        ),
        PLAN_GENERATION => Some(
            "You are a planning assistant. Given the project context and a goal, propose \
             OpenSpec-backed plans. For each plan, call the propose_ideas tool with a title, \
             description, and goal. Do not emit plans as prose — use the tool.",
        ),
        CATEGORY_GENERATION => Some(
            "Given the project schematic, propose 4-6 idea categories that would help direct \
             idea generation for THIS project's domain. Respond with ONLY a JSON array of \
             objects with \"name\" and \"description\".",
        ),
        _ => None,
    }
}

/// The effective default for a prompt key. For planning kinds, derives from
/// the bundled skill content; for `chat_system`, uses the compiled fallback.
/// Returns `None` for unknown keys.
fn default_for(key: &str) -> Option<String> {
    match key {
        CHAT_SYSTEM => compiled_fallback(key).map(str::to_string),
        IDEA_GENERATION | PLAN_GENERATION | CATEGORY_GENERATION => {
            // Skill is the source of truth; fall back to compiled string if
            // the skill file is unavailable (dev without skills copied, etc.).
            PLANNING_SKILL
                .as_ref()
                .map(|s| s.as_str())
                .or_else(|| compiled_fallback(key))
                .map(|s| s.to_string())
        }
        _ => None,
    }
}

/// All known prompt keys.
pub const ALL_KEYS: &[&str] = &[
    CHAT_SYSTEM,
    IDEA_GENERATION,
    PLAN_GENERATION,
    CATEGORY_GENERATION,
];

impl PlanningPromptService {
    /// Get the effective prompt for a key: the saved override if present,
    /// otherwise the compiled default. Returns an error for unknown keys.
    pub fn get(key: &str) -> DbResult<String> {
        let default =
            default_for(key).ok_or_else(|| format!("Unknown planning prompt key: {key}"))?;
        let conn = StorageService::connect()?;
        let override_value: Option<String> = conn
            .query_row(
                "SELECT value FROM planning_prompts WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(override_value.unwrap_or(default))
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
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        let mut entries = Vec::with_capacity(ALL_KEYS.len());
        for key in ALL_KEYS {
            let default = default_for(key).unwrap_or_default();
            let (value, is_modified) = match overrides.get(*key) {
                Some(v) => (v.clone(), true),
                None => (default.clone(), false),
            };
            entries.push(PlanningPromptEntry {
                key: key.to_string(),
                value,
                default,
                is_modified,
            });
        }
        Ok(entries)
    }

    /// Assemble a decision digest for injection into generation prompts.
    /// Includes bounded recent picked/rejected ideas and plans finished
    /// since the schematic's mtime. Returns `None` when there's nothing to
    /// digest (no recent decisions).
    pub fn decision_digest(session_id: &str, project_path: &str) -> Option<String> {
        let conn = StorageService::connect().ok()?;
        // Recent picked/rejected ideas (last 10).
        let mut stmt_ideas = conn
            .prepare(
                "SELECT title, status FROM ideas
                 WHERE session_id = ?1 AND status IN ('picked', 'rejected')
                 ORDER BY updated_at DESC LIMIT 10",
            )
            .ok()?;
        let ideas: Vec<(String, String)> = stmt_ideas
            .query_map(params![session_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .ok()?
            .filter_map(|r| r.ok())
            .collect();
        // Plans finished since schematic mtime.
        let schematic_mtime = std::fs::metadata(
            std::path::Path::new(project_path).join(".basebuild/project-schematic.md"),
        )
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
        let mut stmt_plans = conn
            .prepare(
                "SELECT title, reference_id FROM plans
                 WHERE session_id = ?1 AND status = 'finished' AND finished_at > ?2
                 ORDER BY finished_at DESC LIMIT 10",
            )
            .ok()?;
        let finished_plans: Vec<(String, String)> = stmt_plans
            .query_map(params![session_id, schematic_mtime], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .ok()?
            .filter_map(|r| r.ok())
            .collect();
        if ideas.is_empty() && finished_plans.is_empty() {
            return None;
        }
        let mut parts = Vec::new();
        parts.push("## Recent decisions".to_string());
        if !ideas.is_empty() {
            parts.push("Picked/rejected ideas (most recent first):".to_string());
            for (title, status) in &ideas {
                parts.push(format!("- [{status}] {title}"));
            }
        }
        if !finished_plans.is_empty() {
            parts.push("\nPlans finished since last schematic update:".to_string());
            for (title, ref_id) in &finished_plans {
                parts.push(format!("- {title} ({ref_id})"));
            }
        }
        Some(parts.join("\n"))
    }

    /// Return structured grounding metadata for idea/category generation.
    /// This is the same data as `decision_digest` but in structured form,
    /// suitable for returning to the frontend.
    pub fn grounding_metadata(
        session_id: &str,
        project_path: &str,
    ) -> crate::models::native_chat::GroundingMetadata {
        let conn = match StorageService::connect() {
            Ok(c) => c,
            Err(_) => {
                return crate::models::native_chat::GroundingMetadata {
                    schematic_sections: vec![],
                    finished_plans: vec![],
                    finished_plan_count: 0,
                    picked_count: 0,
                    rejected_count: 0,
                    digest_empty: true,
                };
            }
        };
        // Count picked/rejected ideas.
        let picked_count: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM ideas WHERE session_id = ?1 AND status = 'picked'",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        let rejected_count: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM ideas WHERE session_id = ?1 AND status = 'rejected'",
                params![session_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        // Schematic sections (headings from the schematic file).
        let schematic_sections = std::fs::read_to_string(
            std::path::Path::new(project_path).join(".basebuild/project-schematic.md"),
        )
        .ok()
        .map(|content| {
            content
                .lines()
                .filter(|l| l.starts_with("## ") || l.starts_with("# "))
                .map(|l| l.trim_start_matches('#').trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
        // Plans finished since schematic mtime.
        let schematic_mtime = std::fs::metadata(
            std::path::Path::new(project_path).join(".basebuild/project-schematic.md"),
        )
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
        let finished_plans: Vec<String> = match conn.prepare(
            "SELECT reference_id FROM plans
                 WHERE session_id = ?1 AND status = 'finished' AND finished_at > ?2
                 ORDER BY finished_at DESC LIMIT 10",
        ) {
            Ok(mut stmt) => stmt
                .query_map(params![session_id, schematic_mtime], |row| row.get(0))
                .ok()
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
                .unwrap_or_default(),
            Err(_) => vec![],
        };
        let finished_plan_count = finished_plans.len();
        let digest_empty = picked_count == 0 && rejected_count == 0 && finished_plan_count == 0;
        crate::models::native_chat::GroundingMetadata {
            schematic_sections,
            finished_plans,
            finished_plan_count,
            picked_count,
            rejected_count,
            digest_empty,
        }
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
        // After reset, the effective value is the skill-derived default (or
        // the compiled fallback when the skill file is absent). Either way it
        // must be non-empty and contain the word "idea".
        let value = PlanningPromptService::get(IDEA_GENERATION).unwrap();
        assert!(!value.is_empty());
        assert!(value.to_lowercase().contains("idea"));
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
        assert!(PlanningPromptService::get(PLAN_GENERATION)
            .unwrap()
            .contains("Custom"));
        PlanningPromptService::set(PLAN_GENERATION, "   ").unwrap();
        assert!(!PlanningPromptService::get(PLAN_GENERATION)
            .unwrap()
            .contains("Custom"));
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

    #[test]
    fn grounding_metadata_digest_empty_when_no_data() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let _ = StorageService::connect().unwrap();
        let meta =
            PlanningPromptService::grounding_metadata("test-session-empty", "/nonexistent/path");
        assert!(
            meta.digest_empty,
            "digest should be empty when no ideas or plans"
        );
        assert_eq!(meta.picked_count, 0);
        assert_eq!(meta.rejected_count, 0);
        assert_eq!(meta.finished_plan_count, 0);
        assert!(meta.schematic_sections.is_empty());
        assert!(meta.finished_plans.is_empty());
    }

    #[test]
    fn grounding_metadata_counts_picked_and_rejected() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        // Insert a session to satisfy foreign key constraints.
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at) VALUES ('test-session-gm', '/tmp', 'test', 0, 0)",
            [],
        ).unwrap();
        // Insert ideas with different statuses.
        conn.execute(
            "INSERT INTO ideas (id, session_id, title, description, status, created_at, updated_at) VALUES
             ('i1', 'test-session-gm', 'Idea A', 'desc', 'picked', 0, 0),
             ('i2', 'test-session-gm', 'Idea B', 'desc', 'picked', 0, 0),
             ('i3', 'test-session-gm', 'Idea C', 'desc', 'rejected', 0, 0)",
            [],
        ).unwrap();
        let meta =
            PlanningPromptService::grounding_metadata("test-session-gm", "/nonexistent/path");
        assert_eq!(meta.picked_count, 2);
        assert_eq!(meta.rejected_count, 1);
        assert!(
            !meta.digest_empty,
            "digest should not be empty with picked/rejected ideas"
        );
    }

    #[test]
    fn grounding_metadata_schematic_sections_parsed() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let _ = StorageService::connect().unwrap();
        // Write a schematic file in the temp dir.
        let schematic_path = dir.path().join(".basebuild/project-schematic.md");
        std::fs::create_dir_all(schematic_path.parent().unwrap()).unwrap();
        std::fs::write(
            &schematic_path,
            "# Project Schematic\n\n## Goals\n- Build the thing\n\n## Vision\nBe the best\n",
        )
        .unwrap();
        let meta = PlanningPromptService::grounding_metadata(
            "test-session-ss",
            dir.path().to_str().unwrap(),
        );
        assert!(meta
            .schematic_sections
            .contains(&"Project Schematic".to_string()));
        assert!(meta.schematic_sections.contains(&"Goals".to_string()));
        assert!(meta.schematic_sections.contains(&"Vision".to_string()));
    }

    #[test]
    fn decision_digest_returns_none_when_empty() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let _ = StorageService::connect().unwrap();
        let digest =
            PlanningPromptService::decision_digest("test-session-none", "/nonexistent/path");
        assert!(digest.is_none(), "digest should be None when no data");
    }

    #[test]
    fn decision_digest_returns_some_when_ideas_exist() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let conn = StorageService::connect().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, project_path, title, created_at, updated_at) VALUES ('test-session-d', '/tmp', 'test', 0, 0)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO ideas (id, session_id, title, description, status, created_at, updated_at) VALUES
             ('i1', 'test-session-d', 'Idea A', 'desc', 'picked', 0, 0)",
            [],
        ).unwrap();
        let digest = PlanningPromptService::decision_digest("test-session-d", "/nonexistent/path");
        assert!(digest.is_some());
        let text = digest.unwrap();
        assert!(text.contains("Recent decisions"));
        assert!(text.contains("Idea A"));
        assert!(text.contains("[picked]"));
    }
}
