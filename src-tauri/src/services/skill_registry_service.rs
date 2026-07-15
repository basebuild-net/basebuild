//! Shared skill registry: resolves one skill set from bundled + user roots
//! with user-wins precedence on name collision. Both runtimes (native harness
//! planning/schematic turns and app-launched OMP sessions) consume the same
//! resolved set. Skill content is instructions (prompt context), never code.
//!
//! Roots:
//! - Bundled: `skill_dir()` (ships with the app; see `commands::skills::skill_dir`).
//! - User: `~/.basebuild/skills/` (created on first resolve if absent).
//!
//! Resolution: scan both directories for `SKILL.md` files; on name collision
//! the user version wins and the entry is marked `override`. The listing
//! refreshes on every call (no cache) so user-directory changes appear without
//! restart, per the `shared-skill-registry` spec.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::{commands::skills::skill_dir, services::storage_paths::StoragePathService};

/// Source of a resolved skill.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillSource {
    Bundled,
    User,
    Override,
}

/// Runtimes that consume a skill.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SkillRuntime {
    Native,
    Omp,
    Both,
}

/// A resolved skill entry.
#[derive(Debug, Clone, Serialize)]
pub struct ResolvedSkill {
    pub name: String,
    pub description: String,
    pub source: SkillSource,
    pub runtime: SkillRuntime,
    pub path: String,
}

pub struct SkillRegistryService;

impl SkillRegistryService {
    /// The user skills directory: `~/.basebuild/skills/`.
    fn user_skill_dir() -> Result<std::path::PathBuf, String> {
        let dir = StoragePathService::global_basebuild_dir()?.join("skills");
        if !dir.exists() {
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("Failed to create user skills directory: {e}"))?;
        }
        Ok(dir)
    }

    /// Resolve all skills from bundled + user roots, user-wins on collision.
    /// Returns entries sorted by name for deterministic Settings listing.
    pub fn list() -> Result<Vec<ResolvedSkill>, String> {
        let mut map: BTreeMap<String, ResolvedSkill> = BTreeMap::new();

        // Bundled skills first (lower precedence).
        let bundled = skill_dir();
        if bundled.exists() {
            Self::scan_dir(&bundled, SkillSource::Bundled, &mut map);
        }

        // User skills override bundled on name collision.
        if let Ok(user_dir) = Self::user_skill_dir() {
            if user_dir.exists() {
                Self::scan_dir(&user_dir, SkillSource::User, &mut map);
            }
        }

        Ok(map.into_values().collect())
    }

    /// Read a resolved skill's content by name (user version wins if present).
    pub fn read_content(skill_name: &str) -> Option<String> {
        if !crate::commands::skills::is_valid_skill_name(skill_name) {
            return None;
        }
        // Check user first (wins on collision).
        if let Ok(user_dir) = Self::user_skill_dir() {
            let user_file = user_dir.join(skill_name).join("SKILL.md");
            if let Ok(content) = std::fs::read_to_string(&user_file) {
                return Some(content);
            }
        }
        // Fall back to bundled.
        let bundled_file = skill_dir().join(skill_name).join("SKILL.md");
        std::fs::read_to_string(&bundled_file).ok()
    }

    /// Scan a directory for skill subdirectories containing `SKILL.md`.
    /// On collision, the incoming source wins (caller invokes user after
    /// bundled so user takes precedence). Marks collisions as `Override`.
    fn scan_dir(
        dir: &std::path::Path,
        source: SkillSource,
        map: &mut BTreeMap<String, ResolvedSkill>,
    ) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let skill_file = path.join("SKILL.md");
            if !skill_file.exists() {
                continue;
            }
            let name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) => n.to_string(),
                None => continue,
            };
            let content = match std::fs::read_to_string(&skill_file) {
                Ok(c) => c,
                Err(_) => continue,
            };
            let (parsed_name, description) = parse_frontmatter(&content, &name);
            // Determine final source: if entry already exists (bundled) and
            // we're adding user, mark as Override. If entry exists and we're
            // adding bundled, skip (user already wins).
            let final_source = if let Some(existing) = map.get(&name) {
                match (existing.source, source) {
                    (SkillSource::Bundled, SkillSource::User) => SkillSource::Override,
                    _ => continue, // user already present; bundled loses
                }
            } else {
                source
            };
            map.insert(
                name.clone(),
                ResolvedSkill {
                    name: parsed_name,
                    description,
                    source: final_source,
                    runtime: SkillRuntime::Both,
                    path: path.to_string_lossy().to_string(),
                },
            );
        }
    }

    /// Provision app-launched OMP sessions to discover the same skills.
    /// Returns the user skills directory path (to pass as `--skills-dir` or
    /// equivalent OMP flag) plus the bundled directory, so OMP can discover
    /// both. The exact OMP mechanism is documented in the protocol spike
    /// (task 9.1 / agent-runtime.md).
    pub fn provision_dirs() -> Result<Vec<String>, String> {
        let mut dirs = Vec::new();
        let bundled = skill_dir();
        if bundled.exists() {
            dirs.push(bundled.to_string_lossy().to_string());
        }
        if let Ok(user_dir) = Self::user_skill_dir() {
            if user_dir.exists() {
                dirs.push(user_dir.to_string_lossy().to_string());
            }
        }
        Ok(dirs)
    }
}

/// Parse minimal YAML-like frontmatter (`name`, `description`) from SKILL.md.
fn parse_frontmatter(content: &str, fallback_name: &str) -> (String, String) {
    let mut name = fallback_name.to_string();
    let mut description = String::new();
    if content.starts_with("---") {
        if let Some(end) = content[3..].find("---") {
            let front = &content[3..end + 3];
            for line in front.lines() {
                if let Some((k, v)) = line.split_once(':') {
                    match k.trim() {
                        "name" => name = v.trim().to_string(),
                        "description" => description = v.trim().to_string(),
                        _ => {}
                    }
                }
            }
        }
    }
    (name, description)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_frontmatter_extracts_name_and_description() {
        let content = "---\nname: My Skill\ndescription: A test skill\n---\n# Body";
        let (name, desc) = parse_frontmatter(content, "fallback");
        assert_eq!(name, "My Skill");
        assert_eq!(desc, "A test skill");
    }

    #[test]
    fn parse_frontmatter_falls_back_on_no_frontmatter() {
        let content = "# Just a body";
        let (name, desc) = parse_frontmatter(content, "fallback");
        assert_eq!(name, "fallback");
        assert_eq!(desc, "");
    }

    #[test]
    fn parse_frontmatter_handles_partial_frontmatter() {
        let content = "---\nname: Only Name\n---\nBody";
        let (name, desc) = parse_frontmatter(content, "fallback");
        assert_eq!(name, "Only Name");
        assert_eq!(desc, "");
    }
}
