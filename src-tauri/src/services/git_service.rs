use std::path::Path;

use crate::models::git::{
    BranchInfo, BranchInfo2, FileChangeType, FileEntry, GitCommit, GitStatus,
};
use crate::services::process_helpers::hidden_command;

#[derive(Debug, Default)]
pub struct GitService;

impl GitService {
    pub fn status(path: impl AsRef<Path>) -> Result<GitStatus, String> {
        let output = run_git(
            path.as_ref(),
            &["status", "--porcelain=v2", "-z", "--branch"],
        )?;
        Ok(parse_porcelain_v2(&output))
    }

    pub fn diff(path: impl AsRef<Path>, staged: bool, file: &str) -> Result<String, String> {
        let mut args = vec!["diff"];
        if staged {
            args.push("--cached");
        }
        args.push("--");
        args.push(file);
        run_git(path.as_ref(), &args)
    }

    pub fn add(path: impl AsRef<Path>, file: &str) -> Result<(), String> {
        run_git(path.as_ref(), &["add", "--", file])?;
        Ok(())
    }

    pub fn reset(path: impl AsRef<Path>, file: &str) -> Result<(), String> {
        run_git(path.as_ref(), &["reset", "HEAD", "--", file])?;
        Ok(())
    }

    pub fn discard(path: impl AsRef<Path>, file: &str) -> Result<(), String> {
        run_git(path.as_ref(), &["checkout", "--", file])?;
        Ok(())
    }

    pub fn stage_all(path: impl AsRef<Path>) -> Result<(), String> {
        run_git(path.as_ref(), &["add", "--all"])?;
        Ok(())
    }

    /// Stage all changes and commit with the given message. Returns the
    /// commit SHA on success. Used by the auto-commit finish policy.
    pub fn commit_all(path: impl AsRef<Path>, message: &str) -> Result<String, String> {
        let p = path.as_ref();
        run_git(p, &["add", "--all"])?;
        // Check if there's anything to commit.
        let status = run_git(p, &["status", "--porcelain"])?;
        if status.trim().is_empty() {
            return Ok(String::new()); // Nothing to commit — empty tree.
        }
        run_git(p, &["commit", "-m", message])?;
        let sha = run_git(p, &["rev-parse", "HEAD"])?;
        Ok(sha.trim().to_string())
    }

    pub fn unstage_all(path: impl AsRef<Path>) -> Result<(), String> {
        run_git(path.as_ref(), &["reset", "HEAD"])?;
        Ok(())
    }

    pub fn pull(path: impl AsRef<Path>) -> Result<String, String> {
        run_git(path.as_ref(), &["pull"])
    }

    pub fn push(path: impl AsRef<Path>) -> Result<String, String> {
        run_git(path.as_ref(), &["push"])
    }

    pub fn fetch(path: impl AsRef<Path>) -> Result<String, String> {
        run_git(path.as_ref(), &["fetch"])
    }

    pub fn branch_list(path: impl AsRef<Path>) -> Result<Vec<BranchInfo2>, String> {
        let output = run_git(
            path.as_ref(),
            &[
                "branch",
                "--list",
                "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(objectname:short)",
            ],
        )?;
        Ok(output
            .split('\n')
            .filter(|l| !l.is_empty())
            .map(|line| {
                let parts: Vec<&str> = line.split('\0').collect();
                let is_current = parts.first().map(|h| *h == "*").unwrap_or(false);
                BranchInfo2 {
                    name: parts.get(1).unwrap_or(&"").to_string(),
                    upstream: parts
                        .get(2)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string()),
                    is_current,
                }
            })
            .collect())
    }

    pub fn branch_create(path: impl AsRef<Path>, name: &str) -> Result<(), String> {
        run_git(path.as_ref(), &["checkout", "-b", name])?;
        Ok(())
    }

    pub fn branch_switch(path: impl AsRef<Path>, name: &str) -> Result<(), String> {
        run_git(path.as_ref(), &["checkout", name])?;
        Ok(())
    }

    pub fn commit(path: impl AsRef<Path>, message: &str) -> Result<String, String> {
        run_git(path.as_ref(), &["commit", "-m", message])
    }
    pub fn log(path: impl AsRef<Path>, limit: usize) -> Result<Vec<GitCommit>, String> {
        // Pre-check: if HEAD is unborn (no commits yet), `git log` fails.
        // Return an empty history instead of an error.
        let has_head = crate::services::process_helpers::hidden_command("git")
            .args(["rev-parse", "--verify", "--quiet", "HEAD"])
            .current_dir(path.as_ref())
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !has_head {
            return Ok(Vec::new());
        }

        // %H=full hash %h=short %s=subject %an=author %ad=date
        // %P=parent hashes (space-separated) %d=ref names (decorate)
        let format = "%H%x1f%h%x1f%s%x1f%an%x1f%ad%x1f%P%x1f%d";
        let output = run_git(
            path.as_ref(),
            &[
                "log",
                &format!("--pretty=format:{format}"),
                "--date=short",
                "--decorate=full",
                &format!("-{limit}"),
            ],
        )?;

        Ok(output
            .split('\n')
            .filter(|line| !line.is_empty())
            .map(|line| {
                let parts: Vec<&str> = line.split('\x1f').collect();
                let parents_str = parts.get(5).unwrap_or(&"");
                let parents: Vec<String> = if parents_str.is_empty() {
                    Vec::new()
                } else {
                    parents_str.split_whitespace().map(String::from).collect()
                };
                let refs_str = parts.get(6).unwrap_or(&"");
                let refs: Vec<String> = parse_decorate_refs(refs_str);
                GitCommit {
                    hash: parts.get(0).unwrap_or(&"").to_string(),
                    short_hash: parts.get(1).unwrap_or(&"").to_string(),
                    message: parts.get(2).unwrap_or(&"").to_string(),
                    author: parts.get(3).unwrap_or(&"").to_string(),
                    date: parts.get(4).unwrap_or(&"").to_string(),
                    parents,
                    refs,
                }
            })
            .collect())
    }

    /// Check if a path is inside a git repository.
    pub fn is_repo(path: impl AsRef<Path>) -> bool {
        let output = crate::services::process_helpers::hidden_command("git")
            .args(["rev-parse", "--is-inside-work-tree"])
            .current_dir(path.as_ref())
            .output();
        match output {
            Ok(out) => out.status.success(),
            Err(_) => false,
        }
    }

    /// Current branch name (e.g. `main`), or `None` for a non-repo or
    /// detached HEAD. Used by the chat header display.
    pub fn current_branch(path: impl AsRef<Path>) -> Option<String> {
        let out = run_git(path.as_ref(), &["rev-parse", "--abbrev-ref", "HEAD"]).ok()?;
        let name = out.trim();
        if name.is_empty() || name == "HEAD" { None } else { Some(name.to_string()) }
    }

    /// Origin remote URL (e.g. `https://github.com/org/repo.git` or
    /// `git@github.com:org/repo.git`), or `None` for a non-repo or no remote.
    pub fn remote_url(path: impl AsRef<Path>) -> Option<String> {
        let out = run_git(path.as_ref(), &["remote", "get-url", "origin"]).ok()?;
        let url = out.trim();
        if url.is_empty() { None } else { Some(url.to_string()) }
    }

    /// Detect the repository's default branch (`origin/HEAD` → `main` →
    /// `master` → current). Used by the worktree service + PR service.
    pub fn default_branch(path: impl AsRef<Path>) -> Option<String> {
        let project = path.as_ref();
        let sym = crate::services::process_helpers::hidden_command("git")
            .args(["symbolic-ref", "refs/remotes/origin/HEAD"])
            .current_dir(project)
            .output()
            .ok()?;
        if sym.status.success() {
            let out = String::from_utf8_lossy(&sym.stdout).trim().to_string();
            if let Some(branch) = out.strip_prefix("refs/remotes/origin/") {
                if !branch.is_empty() {
                    return Some(branch.to_string());
                }
            }
        }
        for candidate in ["main", "master"] {
            let check = crate::services::process_helpers::hidden_command("git")
                .args(["rev-parse", "--verify", candidate])
                .current_dir(project)
                .output()
                .ok()?;
            if check.status.success() {
                return Some(candidate.to_string());
            }
        }
        Self::current_branch(project)
    }
}

/// Parse git's `%d` decorate output: ` (HEAD -> main, origin/main, tag: v1.0)`
/// Returns cleaned ref names like `HEAD -> main`, `origin/main`, `tag: v1.0`.
fn parse_decorate_refs(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    // Strip surrounding parentheses
    let inner = trimmed
        .strip_prefix('(')
        .and_then(|s| s.strip_suffix(')'))
        .unwrap_or(trimmed);
    inner
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

fn run_git(path: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = hidden_command("git");
    cmd.args(args).current_dir(path);
    crate::services::process_helpers::run_with_timeout(cmd, crate::services::process_helpers::GIT_TIMEOUT, "git")
        .map_err(|e| {
            // The timeout helper returns a generic error; classify git-specific
            // failures with the stderr output for actionable messages.
            if e.contains("git failed") {
                e
            } else {
                format!("Git command failed: {e}")
            }
        })
}

fn parse_porcelain_v2(output: &str) -> GitStatus {
    let mut status = GitStatus {
        branch: BranchInfo {
            branch: "unknown".to_string(),
            ahead: 0,
            behind: 0,
            upstream: None,
        },
        staged: Vec::new(),
        unstaged: Vec::new(),
        untracked: Vec::new(),
        unborn: false,
    };

    for line in output.split('\0').map(str::trim) {
        if line.is_empty() {
            continue;
        }
        if line.starts_with("# branch.oid ") {
            // `(initial)` indicates an unborn HEAD (no commits yet).
            let oid = line.strip_prefix("# branch.oid ").unwrap_or("").trim();
            if oid == "(initial)" {
                status.unborn = true;
            }
        } else if line.starts_with("# branch.head ") {
            status.branch.branch = line
                .strip_prefix("# branch.head ")
                .unwrap_or("")
                .to_string();
        } else if line.starts_with("# branch.upstream ") {
            status.branch.upstream = Some(
                line.strip_prefix("# branch.upstream ")
                    .unwrap_or("")
                    .to_string(),
            );
        } else if line.starts_with("# branch.ab +") {
            let rest = line.strip_prefix("# branch.ab +").unwrap_or("");
            let parts: Vec<&str> = rest.split(' ').collect();
            if parts.len() == 2 {
                let ahead: i32 = parts[0].parse().unwrap_or(0);
                let behind: i32 = parts[1].parse().unwrap_or(0);
                status.branch.ahead = ahead.max(0);
                status.branch.behind = behind.abs().max(0);
            }
        } else if line.starts_with("1 ") || line.starts_with("2 ") {
            // 1 XY SUB HM WI WT | 2 XY SUB HM QE QI EF ER ET EW RC WT SR
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let xy = parts[1];
                let x = xy.chars().next();
                let y = xy.chars().nth(1);
                let path = parts.last().unwrap_or(&"").to_string();
                let entry = FileEntry {
                    path: path.into(),
                    index_status: x,
                    worktree_status: y,
                    change_type: change_type_for(x.unwrap_or('.')),
                    staged: x.map(|c| c != '.' && c != '?').unwrap_or(false),
                };
                if entry.staged {
                    status.staged.push(entry);
                } else if y == Some('M') || y == Some('D') {
                    status.unstaged.push(entry.clone());
                }
            }
        } else if line.starts_with("? ") {
            let path = line.strip_prefix("? ").unwrap_or("").to_string();
            status.untracked.push(FileEntry {
                path: path.into(),
                index_status: Some('?'),
                worktree_status: Some('?'),
                change_type: FileChangeType::Untracked,
                staged: false,
            });
        } else if line.starts_with("u ") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let xy = parts[1];
                let x = xy.chars().next();
                let y = xy.chars().nth(1);
                let path = parts.last().unwrap_or(&"").to_string();
                status.unstaged.push(FileEntry {
                    path: path.into(),
                    index_status: x,
                    worktree_status: y,
                    change_type: FileChangeType::Unmerged,
                    staged: false,
                });
            }
        }
    }

    status
}

fn change_type_for(status: char) -> FileChangeType {
    match status {
        'A' => FileChangeType::Added,
        'M' => FileChangeType::Modified,
        'D' => FileChangeType::Deleted,
        'R' => FileChangeType::Renamed,
        '?' => FileChangeType::Untracked,
        'U' => FileChangeType::Unmerged,
        _ => FileChangeType::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_porcelain_v2_detects_unborn_head() {
        // `git status --porcelain=v2` on a fresh `git init` repo outputs
        // `# branch.oid (initial)` to indicate an unborn HEAD.
        let output = "# branch.oid (initial)\0# branch.head main\0# branch.upstream \0? file1.txt\0? file2.txt\0";
        let status = parse_porcelain_v2(output);
        assert!(status.unborn, "unborn should be true for (initial) oid");
        assert_eq!(status.branch.branch, "main");
        assert_eq!(status.untracked.len(), 2);
        assert!(status.staged.is_empty());
        assert!(status.unstaged.is_empty());
    }

    #[test]
    fn parse_porcelain_v2_normal_repo_not_unborn() {
        // A normal repo with commits has a real OID, not "(initial)".
        let output = "# branch.oid abc123def456\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0";
        let status = parse_porcelain_v2(output);
        assert!(!status.unborn, "unborn should be false for a real OID");
        assert_eq!(status.branch.branch, "main");
    }
}
