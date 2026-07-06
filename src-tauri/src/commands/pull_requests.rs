use crate::services::pull_request_service::{PrCreateResult, PrRecommendation, PullRequestService};

#[tauri::command]
pub fn pr_recommend(project_path: String, branch: String) -> Result<PrRecommendation, String> {
    PullRequestService::recommend(&project_path, &branch)
}

#[tauri::command]
pub fn pr_create(
    project_path: String,
    branch: String,
    title: String,
    body: String,
) -> Result<PrCreateResult, String> {
    PullRequestService::create_pr(&project_path, &branch, &title, &body)
}

#[tauri::command]
pub fn pr_gh_status() -> Result<(bool, bool), String> {
    Ok(PullRequestService::gh_status())
}
