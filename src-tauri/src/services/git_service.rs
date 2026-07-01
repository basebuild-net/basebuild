use std::path::Path;
use std::process::Command;

use crate::models::git::{BranchInfo, BranchInfo2, FileChangeType, FileEntry, GitCommit, GitStatus};

#[derive(Debug, Default)]
pub struct GitService;

impl GitService {
    pub fn status(path: impl AsRef<Path>) -> Result<GitStatus, String> {
        let output = run_git(path.as_ref(), &["status", "--porcelain=v2", "-z", "--branch"])?;
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
        let output = run_git(path.as_ref(), &["branch", "--list", "--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(objectname:short)"])?;
        Ok(output
            .split('\n')
            .filter(|l| !l.is_empty())
            .map(|line| {
                let parts: Vec<&str> = line.split('\0').collect();
                let is_current = parts.first().map(|h| *h == "*").unwrap_or(false);
                BranchInfo2 {
                    name: parts.get(1).unwrap_or(&"").to_string(),
                    upstream: parts.get(2).filter(|s| !s.is_empty()).map(|s| s.to_string()),
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
        // %H=full hash %h=short %s=subject %an=author %ad=date
        // %P=parent hashes (space-separated) %d=ref names (decorate)
        let format = "%H%x1f%h%x1f%s%x1f%an%x1f%ad%x1f%P%x1f%d";
        let output = run_git(path.as_ref(), &[
            "log",
            &format!("--pretty=format:{format}"),
            "--date=short",
            "--decorate=full",
            &format!("-{limit}"),
        ])?;

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
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .map_err(|error| format!("Failed to run git: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!("Git command failed: {stderr}"));
    }

    Ok(stdout)
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
    };

    for line in output.split('\0').map(str::trim) {
        if line.is_empty() {
            continue;
        }

        if line.starts_with("# branch.head ") {
            status.branch.branch = line.strip_prefix("# branch.head ").unwrap_or("").to_string();
        } else if line.starts_with("# branch.upstream ") {
            status.branch.upstream = Some(line.strip_prefix("# branch.upstream ").unwrap_or("").to_string());
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
