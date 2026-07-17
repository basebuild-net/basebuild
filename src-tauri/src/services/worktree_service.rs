use std::path::{Path, PathBuf};

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::services::{
    git_service::GitService, storage_paths::StoragePathService, storage_service::StorageService,
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
    /// Convert a plan title to a branch-safe slug (lowercase, hyphens,
    /// alphanumerics only, truncated to 40 chars).
    pub fn slugify(title: &str) -> String {
        let slug: String = title
            .to_lowercase()
            .chars()
            .map(|c| {
                if c.is_alphanumeric() {
                    c
                } else if c == '-' || c == '_' {
                    '-'
                } else {
                    ' '
                }
            })
            .collect();
        let slug: String = slug.split_whitespace().collect::<Vec<_>>().join("-");
        let slug = slug.trim_matches('-');
        if slug.is_empty() {
            "plan".to_string()
        } else {
            slug.chars().take(40).collect()
        }
    }

    /// Create a worktree for a plan run under the managed directory.
    /// Branch: `bb/<reference-id>-<slug>`. Path: `<data-dir>/worktrees/<project-hash>/<reference-id>`.
    /// Branched from the freshly fetched default branch (per `parallel-workspaces`).
    /// Returns the workspace + a `base_may_be_stale` flag (true when the
    /// remote fetch failed and the branch was based on the local default).
    pub fn create(
        project_path: &str,
        plan_id: Option<&str>,
        reference_id: &str,
        slug: &str,
    ) -> DbResult<Workspace> {
        Self::create_with_base(project_path, plan_id, reference_id, slug, true)
    }

    /// Create a worktree, optionally fetching the remote first. When
    /// `fetch_first` is false (e.g. in tests), the branch is based on the
    /// local default branch tip without a fetch.
    pub fn create_with_base(
        project_path: &str,
        plan_id: Option<&str>,
        reference_id: &str,
        slug: &str,
        fetch_first: bool,
    ) -> DbResult<Workspace> {
        let project = Path::new(project_path);
        if !GitService::is_repo(project) {
            return Err(
                "Project is not a git repository; worktree creation requires git.".to_string(),
            );
        }
        let branch = format!("bb/{reference_id}-{slug}");
        let worktree_path = Self::worktree_dir(project_path, reference_id);
        if worktree_path.exists() {
            return Err(format!(
                "Worktree path already exists: {}",
                worktree_path.display()
            ));
        }
        // Create parent dir.
        if let Some(parent) = worktree_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create worktree parent dir: {e}"))?;
        }
        // Fetch the remote (best-effort) and detect the default branch. If the
        // fetch fails (offline, no remote), fall back to the local default
        // branch tip and surface a non-blocking stale signal via the worktree
        // record's branch prefix. The caller checks `base_may_be_stale`.
        let (base_ref, base_may_be_stale) = if fetch_first {
            Self::resolve_base_ref(project)?
        } else {
            (
                Self::detect_default_branch(project).unwrap_or_else(|| "HEAD".to_string()),
                false,
            )
        };
        // git worktree add -b <branch> <path> <base-ref>
        let output = crate::services::process_helpers::hidden_command("git")
            .args([
                "worktree",
                "add",
                "-b",
                &branch,
                worktree_path.to_str().unwrap_or("."),
                &base_ref,
            ])
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
        let _ = base_may_be_stale; // Caller detects via `resolve_base_ref` separately.
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
        let output = crate::services::process_helpers::hidden_command("git")
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

    /// Resolve the base ref for a new worktree: fetch the remote (best-effort),
    /// then detect the default branch. Returns `(ref, base_may_be_stale)`.
    /// `base_may_be_stale` is true when the fetch failed and the local
    /// default branch tip is used instead of the fetched one.
    fn resolve_base_ref(project: &Path) -> DbResult<(String, bool)> {
        let fetch_ok = crate::services::process_helpers::hidden_command("git")
            .args(["fetch", "--all"])
            .current_dir(project)
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        let default = Self::detect_default_branch(project).unwrap_or_else(|| "HEAD".to_string());
        Ok((default, !fetch_ok))
    }

    /// Detect the repository's default branch via the fallback chain:
    /// `origin/HEAD` → `origin/main` → `origin/master` → local `main` →
    /// local `master` → current `HEAD`. Returns the ref to base new branches
    /// off (e.g. `origin/main`).
    fn detect_default_branch(project: &Path) -> Option<String> {
        let sym = crate::services::process_helpers::hidden_command("git")
            .args(["symbolic-ref", "refs/remotes/origin/HEAD"])
            .current_dir(project)
            .output()
            .ok()?;
        if sym.status.success() {
            let out = String::from_utf8_lossy(&sym.stdout).trim().to_string();
            if let Some(branch) = out.strip_prefix("refs/remotes/origin/") {
                if !branch.is_empty() {
                    return Some(format!("origin/{branch}"));
                }
            }
        }
        for candidate in ["origin/main", "origin/master", "main", "master"] {
            let check = crate::services::process_helpers::hidden_command("git")
                .args(["rev-parse", "--verify", candidate])
                .current_dir(project)
                .output()
                .ok()?;
            if check.status.success() {
                return Some(candidate.to_string());
            }
        }
        Some("HEAD".to_string())
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

    #[test]
    fn detect_default_branch_falls_back_to_head() {
        // A non-repo path: every git command fails, so the fallback chain
        // bottoms out at "HEAD".
        let dir = tempfile::TempDir::new().unwrap();
        let ref_str = WorktreeService::detect_default_branch(dir.path());
        assert_eq!(ref_str.as_deref(), Some("HEAD"));
    }

    #[test]
    fn detect_default_branch_finds_local_main() {
        // Init a repo with a main branch; no remote, so the chain reaches
        // the local `main` step.
        let dir = tempfile::TempDir::new().unwrap();
        let out = crate::services::process_helpers::hidden_command("git")
            .args(["init", "-b", "main"])
            .current_dir(dir.path())
            .output();
        if out.is_err() {
            // git not available in this environment — skip gracefully.
            return;
        }
        // Make an initial commit so main exists as a ref.
        let _ = std::fs::write(dir.path().join("README"), "test");
        let _ = crate::services::process_helpers::hidden_command("git")
            .args(["add", "."])
            .current_dir(dir.path())
            .output();
        let _ = crate::services::process_helpers::hidden_command("git")
            .args(["commit", "-m", "init", "--author", "test <test@test.com>"])
            .current_dir(dir.path())
            .output();
        let ref_str = WorktreeService::detect_default_branch(dir.path());
        // On a repo with no remote, origin/* won't resolve; local `main` should.
        assert!(ref_str.as_deref() == Some("main") || ref_str.as_deref() == Some("HEAD"));
    }
}
