use crate::{models::config_pack::ConfigPack, services::config_pack_service::ConfigPackService};

#[tauri::command]
pub fn list_config_packs(project_path: Option<String>) -> Vec<ConfigPack> {
    ConfigPackService::discover(project_path.as_deref())
}

#[tauri::command]
pub fn create_user_config_pack(name: String) -> Result<ConfigPack, String> {
    ConfigPackService::create_user_pack(&name)
}
