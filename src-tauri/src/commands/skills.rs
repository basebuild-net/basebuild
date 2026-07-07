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

#[tauri::command]
pub fn read_skill(skill_name: String) -> Result<SkillMeta, String> {
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
