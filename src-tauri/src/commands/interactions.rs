use tauri::AppHandle;

use crate::{
    models::interaction::{PendingInteraction, QuestionAnswer, ResolveInteractionRequest},
    services::interaction_service::InteractionService,
};

use tauri::Emitter;

fn emit_changed(app: &AppHandle, session_id: &str) {
    let _ = app.emit(
        "native-chat://interactive-request",
        serde_json::json!({ "sessionId": session_id }),
    );
}

#[tauri::command]
pub fn native_interaction_list_pending(
    session_id: String,
) -> Result<Vec<PendingInteraction>, String> {
    InteractionService::list_pending(&session_id)
}

#[tauri::command]
pub fn native_interaction_list_all(session_id: String) -> Result<Vec<PendingInteraction>, String> {
    InteractionService::list_all(&session_id)
}

#[tauri::command]
pub fn native_interaction_resolve(
    app: AppHandle,
    id: String,
    request: ResolveInteractionRequest,
) -> Result<PendingInteraction, String> {
    let interaction = InteractionService::resolve(&id, &request)?;
    // Unblock the parked agent loop iteration (native chat path).
    let _ = crate::services::agent_loop_service::resolve_interaction(&id, request.answers.clone());

    emit_changed(&app, &interaction.session_id);
    Ok(interaction)
}
#[tauri::command]
pub fn native_interaction_save_draft(
    app: AppHandle,
    id: String,
    answers: Vec<QuestionAnswer>,
    current_page: usize,
) -> Result<PendingInteraction, String> {
    let interaction = InteractionService::save_draft(&id, &answers, current_page)?;
    emit_changed(&app, &interaction.session_id);
    Ok(interaction)
}

#[tauri::command]
pub fn native_interaction_cancel(app: AppHandle, id: String) -> Result<(), String> {
    let interaction = InteractionService::get(&id)?;
    InteractionService::cancel(&id)?;
    // Unblock the parked agent loop iteration with a cancelled resolution.
    let _ = crate::services::agent_loop_service::cancel_interaction(&id);

    if let Some(i) = interaction {
        emit_changed(&app, &i.session_id);
    }
    Ok(())
}
