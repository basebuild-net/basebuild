use tauri::{AppHandle, Emitter};

use crate::{
    models::notification::{Notification, NotificationSettings},
    services::notification_service::NotificationService,
};

/// Emit a `notifications://changed` event so the frontend refreshes the
/// unread count + center after any mutation. Keep the payload minimal.
fn emit_changed(app: &AppHandle) {
    let _ = app.emit("notifications://changed", ());
}

#[tauri::command]
pub fn notification_list(
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<Notification>, String> {
    NotificationService::list(limit.unwrap_or(100), offset.unwrap_or(0))
}

#[tauri::command]
pub fn notification_unread_count() -> Result<i64, String> {
    NotificationService::unread_count()
}

#[tauri::command]
pub fn notification_mark_read(app: AppHandle, id: String) -> Result<(), String> {
    NotificationService::mark_read(&id)?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn notification_mark_all_read(app: AppHandle) -> Result<(), String> {
    NotificationService::mark_all_read()?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn notification_delete(app: AppHandle, id: String) -> Result<(), String> {
    NotificationService::delete(&id)?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub fn notification_get_settings() -> Result<NotificationSettings, String> {
    NotificationService::get_settings()
}

#[tauri::command]
pub fn notification_set_settings(
    app: AppHandle,
    settings: NotificationSettings,
) -> Result<(), String> {
    NotificationService::set_settings(&settings)?;
    emit_changed(&app);
    Ok(())
}
