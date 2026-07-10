use std::path::PathBuf;

#[derive(serde::Serialize)]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
    pub content: String,
}

pub fn skill_dir() -> PathBuf {
    // In dev, executable is src-tauri/target/debug/basebuild-app.exe, skills is at repo root.
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(PathBuf::from))
        .map(|dir| {
            // dev: src-tauri/target/.../ -> repo root
            let candidate = dir.join("../../../skills");
            if candidate.exists() {
                return candidate;
            }
            // production bundle: resources/skills next to executable
            dir.join("../resources/skills")
        })
        .unwrap_or_else(|| PathBuf::from("skills"))
}

/// Validate a skill name as a single, plain directory component.
///
/// Skill names come from the webview (untrusted). Joining them into a path
/// unvalidated allows traversal (`..`) and, because `PathBuf::join` replaces
/// the base when given an absolute path, arbitrary-root reads. Names are
/// kebab/snake-case directory names: allow only alphanumerics, `-`, `_`, and
/// non-leading `.`.
pub fn is_valid_skill_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

#[tauri::command]
pub fn read_skill(skill_name: String) -> Result<SkillMeta, String> {
    if !is_valid_skill_name(&skill_name) {
        return Err(format!("Invalid skill name: {skill_name}"));
    }
    let file = skill_dir().join(&skill_name).join("SKILL.md");
    let content = std::fs::read_to_string(&file)
        .map_err(|e| format!("Failed to read skill {skill_name}: {e}"))?;

    // Parse minimal frontmatter: name, description
    let mut name = skill_name.clone();
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

    Ok(SkillMeta {
        name,
        description,
        content,
    })
}

/// Read a bundled skill's SKILL.md content by skill name. Used by services
/// that derive defaults from skill files (e.g. planning prompt defaults).
pub fn read_skill_content(skill_name: &str) -> Option<String> {
    if !is_valid_skill_name(skill_name) {
        return None;
    }
    let file = skill_dir().join(skill_name).join("SKILL.md");
    std::fs::read_to_string(&file).ok()
}

#[tauri::command]
pub fn list_resolved_skills() -> Result<Vec<crate::services::skill_registry_service::ResolvedSkill>, String> {
    crate::services::skill_registry_service::SkillRegistryService::list()
}

#[tauri::command]
pub fn read_resolved_skill(skill_name: String) -> Result<String, String> {
    crate::services::skill_registry_service::SkillRegistryService::read_content(&skill_name)
        .ok_or_else(|| format!("Skill not found: {skill_name}"))
}

#[tauri::command]
pub fn provision_skill_dirs() -> Result<Vec<String>, String> {
    crate::services::skill_registry_service::SkillRegistryService::provision_dirs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_skill_names_accepted() {
        assert!(is_valid_skill_name("openspec"));
        assert!(is_valid_skill_name("chat-command-palette"));
        assert!(is_valid_skill_name("skill_v2.1"));
    }

    #[test]
    fn traversal_and_absolute_names_rejected() {
        assert!(!is_valid_skill_name(""));
        assert!(!is_valid_skill_name(".."));
        assert!(!is_valid_skill_name("."));
        assert!(!is_valid_skill_name("../secrets"));
        assert!(!is_valid_skill_name("..\\secrets"));
        assert!(!is_valid_skill_name("a/b"));
        assert!(!is_valid_skill_name("a\\b"));
        assert!(!is_valid_skill_name("C:\\evil"));
        assert!(!is_valid_skill_name("/etc"));
        assert!(!is_valid_skill_name(".hidden"));
    }

    #[test]
    fn read_skill_rejects_traversal_name() {
        let err = read_skill("../../outside".to_string()).err().expect("traversal name must be rejected");
        assert!(err.contains("Invalid skill name"));
        assert!(read_skill_content("../../outside").is_none());
    }
}
