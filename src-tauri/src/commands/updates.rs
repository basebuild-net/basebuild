use crate::services::update_service::UpdateService;

#[tauri::command]
pub fn check_app_update(url: String, current_version: String) -> Result<crate::models::release::ReleaseManifest, String> {
    let result = UpdateService::check(&url, &current_version)?;
    if result.needs_update {
        Ok(result.manifest)
    } else {
        Ok(crate::models::release::ReleaseManifest {
            version: current_version,
            notes: "You are on the latest version.".to_string(),
            pub_date: String::new(),
            platforms: crate::models::release::ReleasePlatforms { windows_x86_64: None },
        })
    }
}
