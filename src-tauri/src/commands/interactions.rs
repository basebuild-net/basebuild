use tauri::{AppHandle, Manager};

use crate::{
    models::interaction::{PendingInteraction, ResolveInteractionRequest},
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
pub fn native_interaction_list_pending(session_id: String) -> Result<Vec<PendingInteraction>, String> {
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

    // OMP RPC bridge: if there's an active OMP RPC session for this chat
    // session, forward the answer over stdin so OMP can continue its turn.
    // The question id is the OMP frame id (set in handle_user_input).
    if let Some(registry) = app.try_state::<crate::services::omp_rpc_session_service::OmpRpcSessionRegistry>() {
        if registry.get(&interaction.session_id).is_some() {
            for answer in &request.answers {
                let frame_id = &answer.question_id;
                let answer_text = answer.text.clone()
                    .filter(|t| !t.is_empty())
                    .unwrap_or_else(|| answer.selected.join(", "));
                let _ = crate::services::omp_rpc_session_service::resolve_user_input(
                    &app, &interaction.session_id, frame_id, &answer_text,
                );
            }
        }
    }

    emit_changed(&app, &interaction.session_id);
    Ok(interaction)
}
#[tauri::command]
pub fn native_interaction_cancel(app: AppHandle, id: String) -> Result<(), String> {
    let interaction = InteractionService::get(&id)?;
    InteractionService::cancel(&id)?;
    // Unblock the parked agent loop iteration with a cancelled resolution.
    let _ = crate::services::agent_loop_service::cancel_interaction(&id);

    // OMP RPC bridge: notify OMP that the user cancelled the question.
    if let Some(inter) = &interaction {
        if let Some(registry) = app.try_state::<crate::services::omp_rpc_session_service::OmpRpcSessionRegistry>() {
            if registry.get(&inter.session_id).is_some() {
                for q in &inter.questions {
                    let _ = crate::services::omp_rpc_session_service::resolve_user_input(
                        &app, &inter.session_id, &q.id, "[cancelled]",
                    );
                }
            }
        }
    }

    if let Some(i) = interaction {
        emit_changed(&app, &i.session_id);
    }
    Ok(())
}
