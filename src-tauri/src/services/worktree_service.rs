use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{
    services::{git_service::GitService, storage_paths::StoragePathService, storage_service::StorageService},
};

type DbResult<T> = Result<T, String>;

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

/// A managed git worktree for parallel plan runs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub project_path: String,
    pub plan_id: Option<String>,
    pub branch: String,
    pub path: String,
    pub created_at: i64,
    pub pruned_at: Option<i64>,
}

#[derive(Debug, Default)]
pub struct WorktreeService;

impl WorktreeService {
    /// Create a worktree for a plan run under the managed directory.
    /// Branch: `bb/<reference-id>-<slug>`. Path: `<data-dir>/worktrees/<project-hash>/<reference-id>`.
    pub fn create(project_path: &str, plan_id: Option<&str>, reference_id: &str, slug: &str) -> DbResult<Workspace> {
        let project = Path::new(project_path);
        if !GitService::is_repo(project) {
            return Err("Project is not a git repository; worktree creation requires git.".to_string());
        }
        let branch = format!("bb/{reference_id}-{slug}");
        let worktree_path = Self::worktree_dir(project_path, reference_id);
        if worktree_path.exists() {
            return Err(format!("Worktree path already exists: {}", worktree_path.display()));
        }
        // Create parent dir.
        if let Some(parent) = worktree_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create worktree parent dir: {e}"))?;
        }
        // git worktree add -b <branch> <path>
        let output = std::process::Command::new("git")
            .args(["worktree", "add", "-b", &branch, worktree_path.to_str().unwrap_or("."), "HEAD"])
            .current_dir(project)
            .output()
            .map_err(|e| format!("Failed to run git worktree add: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            // Clean up the dir if git failed.
            let _ = std::fs::remove_dir(&worktree_path);
            return Err(format!("git worktree add failed: {stderr}"));
        }
        // Record in DB.
        let id = gen_id();
        let created = now();
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO workspaces (id, project_path, plan_id, branch, path, created_at, pruned_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL)",
            params![id, project_path, plan_id, branch, worktree_path.to_string_lossy(), created],
        )
        .map_err(|e| format!("Failed to record worktree: {e}"))?;
        Ok(Workspace {
            id,
            project_path: project_path.to_string(),
            plan_id: plan_id.map(str::to_string),
            branch,
            path: worktree_path.to_string_lossy().to_string(),
            created_at: created,
            pruned_at: None,
        })
    }

    /// List all worktrees for a project.
    pub fn list(project_path: &str) -> DbResult<Vec<Workspace>> {
        let conn = StorageService::connect()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, project_path, plan_id, branch, path, created_at, pruned_at
                 FROM workspaces WHERE project_path = ?1 AND pruned_at IS NULL ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![project_path], |row| {
                Ok(Workspace {
                    id: row.get(0)?,
                    project_path: row.get(1)?,
                    plan_id: row.get(2)?,
                    branch: row.get(3)?,
                    path: row.get(4)?,
                    created_at: row.get(5)?,
                    pruned_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    /// Remove a worktree via `git worktree remove`. If `force` is false and
    /// there are uncommitted changes, the removal is rejected.
    pub fn remove(id: &str, force: bool) -> DbResult<()> {
        let conn = StorageService::connect()?;
        let workspace: Workspace = conn
            .query_row(
                "SELECT id, project_path, plan_id, branch, path, created_at, pruned_at FROM workspaces WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Workspace {
                        id: row.get(0)?,
                        project_path: row.get(1)?,
                        plan_id: row.get(2)?,
                        branch: row.get(3)?,
                        path: row.get(4)?,
                        created_at: row.get(5)?,
                        pruned_at: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Workspace not found".to_string())?;
        let project = Path::new(&workspace.project_path);
        let mut args = vec!["worktree", "remove"];
        if force {
            args.push("--force");
        }
        args.push(&workspace.path);
        let output = std::process::Command::new("git")
            .args(&args)
            .current_dir(project)
            .output()
            .map_err(|e| format!("Failed to run git worktree remove: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!("git worktree remove failed: {stderr}"));
        }
        // Mark as pruned in DB.
        conn.execute(
            "UPDATE workspaces SET pruned_at = ?1 WHERE id = ?2",
            params![now(), id],
        )
        .map_err(|e| format!("Failed to mark worktree pruned: {e}"))?;
        Ok(())
    }

    /// Check if a project is a git repo (worktree support requires git).
    pub fn is_supported(project_path: &str) -> bool {
        GitService::is_repo(Path::new(project_path))
    }

    /// Compute the managed worktree directory for a project + reference.
    fn worktree_dir(project_path: &str, reference_id: &str) -> PathBuf {
        let hash = Self::project_hash(project_path);
        StoragePathService::global_basebuild_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("basebuild-worktrees"))
            .join("worktrees")
            .join(hash)
            .join(reference_id)
    }

    /// Simple FNV-1a hash of the project path for directory naming.
    fn project_hash(project_path: &str) -> String {
        let mut hash: u64 = 0xcbf29ce484222325;
        for byte in project_path.as_bytes() {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
        format!("{hash:016x}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_hash_is_deterministic() {
        let h1 = WorktreeService::project_hash("/test/path");
        let h2 = WorktreeService::project_hash("/test/path");
        assert_eq!(h1, h2);
        assert_ne!(h1, WorktreeService::project_hash("/other/path"));
    }

    #[test]
    fn worktree_dir_is_under_data_dir() {
        let dir = WorktreeService::worktree_dir("/test", "bb-abc123");
        assert!(dir.to_string_lossy().contains("worktrees"));
        assert!(dir.to_string_lossy().contains("bb-abc123"));
    }

    #[test]
    fn list_empty_for_new_project() {
        let dir = tempfile::TempDir::new().unwrap();
        let _g = crate::test_util::test::lock_db(&dir);
        let workspaces = WorktreeService::list("/no/workspaces").unwrap();
        assert!(workspaces.is_empty());
    }
}
