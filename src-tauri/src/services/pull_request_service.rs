use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::services::{git_service::GitService, process_helpers::hidden_command};

type DbResult<T> = Result<T, String>;

/// Pull-request recommendation + creation (`plan-final-touches`).
///
/// Uses the `gh` CLI when it is installed and authenticated; otherwise pushes
/// the run's branch and opens the GitHub compare / new-pull-request URL in
/// the system browser. No token is stored — `gh`'s own auth is used, or the
/// browser handles auth. Always confirm-gated by the caller.

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrRecommendation {
    pub branch: String,
    pub ahead: u32,
    pub behind: u32,
    pub changed_files: u32,
    pub gh_available: bool,
    pub gh_authed: bool,
    /// The URL that would be opened (compare URL or the PR created by gh).
    pub compare_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCreateResult {
    pub success: bool,
    pub url: Option<String>,
    pub error: Option<String>,
    pub method: String,
}

#[derive(Debug, Default)]
pub struct PullRequestService;

impl PullRequestService {
    /// Detect whether `gh` is installed and authenticated.
    pub fn gh_status() -> (bool, bool) {
        let available = which::which("gh").is_ok();
        if !available {
            return (false, false);
        }
        // `gh auth status` exits 0 when authed.
        let authed = hidden_command("gh")
            .args(["auth", "status"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        (true, authed)
    }

    /// Build a PR recommendation for a finished worktree run: branch,
    /// ahead/behind, changed-file count, gh availability, and the compare URL.
    pub fn recommend(project_path: &str, branch: &str) -> DbResult<PrRecommendation> {
        let project = Path::new(project_path);
        if !GitService::is_repo(project) {
            return Err("Project is not a git repository.".to_string());
        }
        let (ahead, behind) = Self::ahead_behind(project, branch)?;
        let changed_files = Self::changed_file_count(project, branch)?;
        let default_branch = GitService::default_branch(project).unwrap_or_else(|| "main".to_string());
        let (gh_available, gh_authed) = Self::gh_status();
        let compare_url = Self::compare_url(project, branch, &default_branch)?;
        Ok(PrRecommendation {
            branch: branch.to_string(),
            ahead,
            behind,
            changed_files,
            gh_available,
            gh_authed,
            compare_url,
        })
    }

    /// Create a pull request: push the branch, then `gh pr create` if
    /// available+authed, else open the compare URL in the browser. The caller
    /// MUST confirm before calling this — it performs remote writes (push).
    pub fn create_pr(project_path: &str, branch: &str, title: &str, body: &str) -> DbResult<PrCreateResult> {
        let project = Path::new(project_path);
        // Push the branch first (remote write — confirm-gated by caller).
        let push = hidden_command("git")
            .args(["push", "-u", "origin", branch])
            .current_dir(project)
            .output()
            .map_err(|e| format!("Failed to push branch: {e}"))?;
        if !push.status.success() {
            let stderr = String::from_utf8_lossy(&push.stderr).to_string();
            return Ok(PrCreateResult {
                success: false,
                url: None,
                error: Some(format!("git push failed: {stderr}")),
                method: "push".to_string(),
            });
        }
        let (gh_available, gh_authed) = Self::gh_status();
        if gh_available && gh_authed {
            // gh pr create --title <title> --body <body> --base <default>
            let default_branch = GitService::default_branch(project).unwrap_or_else(|| "main".to_string());
            let gh = hidden_command("gh")
                .args(["pr", "create", "--title", title, "--body", body, "--base", &default_branch, "--head", branch])
                .current_dir(project)
                .output()
                .map_err(|e| format!("Failed to run gh pr create: {e}"))?;
            if gh.status.success() {
                let url = String::from_utf8_lossy(&gh.stdout).trim().to_string();
                Ok(PrCreateResult {
                    success: true,
                    url: Some(url),
                    error: None,
                    method: "gh".to_string(),
                })
            } else {
                let stderr = String::from_utf8_lossy(&gh.stderr).to_string();
                Ok(PrCreateResult {
                    success: false,
                    url: None,
                    error: Some(format!("gh pr create failed: {stderr}")),
                    method: "gh".to_string(),
                })
            }
        } else {
            // Browser fallback: open the compare URL.
            let default_branch = GitService::default_branch(project).unwrap_or_else(|| "main".to_string());
            let compare_url = Self::compare_url(project, branch, &default_branch)?;
            // Open in the system browser (best-effort).
            if let Some(ref url) = compare_url {
                let _ = open_url(url);
            }
            Ok(PrCreateResult {
                success: true,
                url: compare_url,
                error: None,
                method: "browser".to_string(),
            })
        }
    }

    /// Compute ahead/behind counts for `branch` vs the default branch.
    fn ahead_behind(project: &Path, branch: &str) -> DbResult<(u32, u32)> {
        let default = GitService::default_branch(project).unwrap_or_else(|| "main".to_string());
        let out = hidden_command("git")
            .args(["rev-list", "--left-right", "--count", &default, branch])
            .current_dir(project)
            .output()
            .map_err(|e| format!("Failed to compute ahead/behind: {e}"))?;
        if !out.status.success() {
            return Ok((0, 0));
        }
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let parts: Vec<&str> = text.split_whitespace().collect();
        if parts.len() == 2 {
            let behind: u32 = parts[0].parse().unwrap_or(0);
            let ahead: u32 = parts[1].parse().unwrap_or(0);
            Ok((ahead, behind))
        } else {
            Ok((0, 0))
        }
    }

    /// Count files changed on `branch` vs the default branch.
    fn changed_file_count(project: &Path, branch: &str) -> DbResult<u32> {
        let default = GitService::default_branch(project).unwrap_or_else(|| "main".to_string());
        let out = hidden_command("git")
            .args(["diff", "--name-only", &default, branch])
            .current_dir(project)
            .output()
            .map_err(|e| format!("Failed to count changed files: {e}"))?;
        if !out.status.success() {
            return Ok(0);
        }
        let text = String::from_utf8_lossy(&out.stdout);
        Ok(text.lines().filter(|l| !l.trim().is_empty()).count() as u32)
    }

    /// Construct the GitHub compare URL for `branch` → `default_branch`.
    /// Returns `None` if no GitHub remote is found.
    fn compare_url(project: &Path, branch: &str, default_branch: &str) -> DbResult<Option<String>> {
        let remote = hidden_command("git")
            .args(["remote", "get-url", "origin"])
            .current_dir(project)
            .output()
            .map_err(|e| format!("Failed to get remote URL: {e}"))?;
        if !remote.status.success() {
            return Ok(None);
        }
        let url = String::from_utf8_lossy(&remote.stdout).trim().to_string();
        let repo = parse_github_repo(&url)?;
        Ok(Some(format!(
            "https://github.com/{repo}/compare/{default_branch}...{branch}?expand=1"
        )))
    }
}

/// Open a URL in the system browser (cross-platform best-effort).
fn open_url(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd").args(["/C", "start", url]).spawn()?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(url).spawn()?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(url).spawn()?;
    }
    Ok(())
}

/// Parse a GitHub repo path from a remote URL. Accepts HTTPS and SSH forms:
/// `https://github.com/owner/repo(.git)` → `owner/repo`
/// `git@github.com:owner/repo(.git)` → `owner/repo`
fn parse_github_repo(url: &str) -> DbResult<String> {
    let trimmed = url.trim().strip_suffix(".git").unwrap_or(url.trim());
    if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
        return Ok(rest.to_string());
    }
    if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        return Ok(rest.to_string());
    }
    // Generic fallback: take the last two path segments.
    let parts: Vec<&str> = trimmed.split(['/', ':']).collect();
    if parts.len() >= 2 {
        return Ok(format!("{}/{}", parts[parts.len() - 2], parts[parts.len() - 1]));
    }
    Err(format!("Could not parse GitHub repo from remote URL: {url}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_https_github_url() {
        assert_eq!(parse_github_repo("https://github.com/owner/repo.git").unwrap(), "owner/repo");
        assert_eq!(parse_github_repo("https://github.com/owner/repo").unwrap(), "owner/repo");
    }

    #[test]
    fn parse_ssh_github_url() {
        assert_eq!(parse_github_repo("git@github.com:owner/repo.git").unwrap(), "owner/repo");
        assert_eq!(parse_github_repo("git@github.com:owner/repo").unwrap(), "owner/repo");
    }

    #[test]
    fn parse_url_strips_git_suffix() {
        assert_eq!(parse_github_repo("https://github.com/basebuild-net/app.git").unwrap(), "basebuild-net/app");
    }
}
