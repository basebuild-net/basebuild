use std::path::Path;

use crate::models::config_pack::{ConfigPack, PackManifest, PackSource};
use crate::services::storage_paths::StoragePathService;

#[derive(Debug, Default)]
pub struct ConfigPackService;

impl ConfigPackService {
    pub fn discover(project_path: Option<&str>) -> Vec<ConfigPack> {
        let mut packs = Vec::new();

        // Built-in / global user packs in ~/.basebuild/packs
        if let Ok(global_packs) = StoragePathService::global_config_packs_dir() {
            Self::collect_from_dir(&global_packs, PackSource::User, &mut packs);
            // Ensure the official idea pack exists at the global level
            let _ = Self::ensure_official_idea_pack(&global_packs);
        }

        // Project-specific packs
        if let Some(path) = project_path {
            let project_packs = Path::new(path).join(".basebuild").join("packs");
            Self::collect_from_dir(&project_packs, PackSource::Project, &mut packs);
        }

        packs
    }

    pub fn create_user_pack(name: &str) -> Result<ConfigPack, String> {
        let id = name.to_lowercase().replace(' ', "-");
        let global_packs = StoragePathService::global_config_packs_dir()
            .map_err(|error| format!("Failed to resolve global packs directory: {error}"))?;
        let pack_dir = global_packs.join(&id);
        Self::write_pack(
            &pack_dir,
            &PackManifest {
                id: id.clone(),
                name: name.to_string(),
                version: "0.1.0".to_string(),
                description: format!("User-created {name} pack."),
                author: None,
                source: PackSource::User,
                prompts: vec!["prompt.md".to_string()],
            },
            "prompts",
            "prompt.md",
            "# Custom prompt\n",
        )?;

        let manifest = Self::read_manifest(&pack_dir)
            .ok_or_else(|| format!("Failed to read created pack manifest at {}", pack_dir.display()))?;
        Ok(ConfigPack {
            manifest,
            path: pack_dir,
        })
    }

    pub fn ensure_official_idea_pack(packs_dir: &Path) -> Result<ConfigPack, String> {
        let pack_dir = packs_dir.join("official.idea-generation");
        Self::write_pack(
            &pack_dir,
            &PackManifest {
                id: "official.idea-generation".to_string(),
                name: "Official Idea Generation".to_string(),
                version: "1.0.0".to_string(),
                description: "Basebuild's built-in idea generation pack.".to_string(),
                author: Some("Basebuild".to_string()),
                source: PackSource::BuiltIn,
                prompts: vec!["ideas.md".to_string()],
            },
            "prompts",
            "ideas.md",
            "# Idea generation\n\nGenerate concrete, actionable next tasks from a high-level goal.\n\n## Input\n- Goal: the user's short description\n\n## Output format\n1. Category name\n2. Three to five specific suggestions\n3. For each chosen suggestion, produce an OpenSpec-ready task list\n",
        )?;

        let manifest = Self::read_manifest(&pack_dir)
            .ok_or_else(|| format!("Failed to read official pack manifest at {}", pack_dir.display()))?;
        Ok(ConfigPack {
            manifest,
            path: pack_dir,
        })
    }

    fn collect_from_dir(dir: &Path, source: PackSource, out: &mut Vec<ConfigPack>) {
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if let Some(mut manifest) = Self::read_manifest(&path) {
                manifest.source = source.clone();
                out.push(ConfigPack { manifest, path });
            }
        }
    }

    fn read_manifest(dir: &Path) -> Option<PackManifest> {
        let content = std::fs::read_to_string(dir.join("pack.toml")).ok()?;
        toml::from_str(&content).ok()
    }

    fn write_pack(
        dir: &Path,
        manifest: &PackManifest,
        prompts_dir: &str,
        prompt_file: &str,
        prompt: &str,
    ) -> Result<(), String> {
        if dir.join("pack.toml").exists() {
            return Ok(());
        }
        if dir.join("pack.toml").exists() {
            return Ok(());
        }
        std::fs::create_dir_all(dir)
            .map_err(|error| format!("Failed to create pack directory: {error}"))?;
        let manifest_text = toml::to_string_pretty(manifest)
            .map_err(|error| format!("Failed to serialize manifest: {error}"))?;
        std::fs::write(dir.join("pack.toml"), manifest_text)
            .map_err(|error| format!("Failed to write pack.toml: {error}"))?;
        let prompts_dir = dir.join(prompts_dir);
        std::fs::create_dir_all(&prompts_dir)
            .map_err(|error| format!("Failed to create prompts directory: {error}"))?;
        std::fs::write(prompts_dir.join(prompt_file), prompt)
            .map_err(|error| format!("Failed to write prompt: {error}"))?;
        Ok(())
    }
}
