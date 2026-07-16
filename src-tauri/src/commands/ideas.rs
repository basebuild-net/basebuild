use crate::{
    models::{
        idea::{Idea, IdeaCategory, IdeaStatus},
        plan::{NewPlan, Plan, PlanStatus},
    },
    services::{plan_service::PlanService, session_service::SessionService},
};

use tauri::AppHandle;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteIdeasInput {
    pub session_id: String,
    pub idea_ids: Vec<String>,
}

#[tauri::command]
pub fn create_category(
    app: AppHandle,
    session_id: String,
    name: String,
    description: String,
) -> Result<IdeaCategory, String> {
    let cat = SessionService::create_category(&session_id, &name, &description)?;
    let project_path = SessionService::get(&session_id)
        .ok()
        .flatten()
        .map(|s| s.project_path)
        .unwrap_or_default();
    crate::services::planning_events::emit(
        &app,
        crate::models::planning_event::PlanningEventKind::CategoryCreated,
        &cat.id,
        &project_path,
        Some(session_id),
        &cat.name,
        None,
    );
    Ok(cat)
}

#[tauri::command]
pub fn list_categories(session_id: String) -> Result<Vec<IdeaCategory>, String> {
    SessionService::list_categories(&session_id)
}

#[tauri::command]
pub fn list_project_categories(project_path: String) -> Result<Vec<IdeaCategory>, String> {
    SessionService::list_categories_for_project(&project_path)
}

#[tauri::command]
pub fn delete_category(id: String) -> Result<(), String> {
    SessionService::delete_category(&id)
}

#[tauri::command]
pub fn create_idea(
    app: AppHandle,
    session_id: String,
    title: String,
    description: String,
    category_id: Option<String>,
    grounding: Option<String>,
    anchor: Option<String>,
) -> Result<Idea, String> {
    let idea = SessionService::create_idea(
        &session_id,
        &title,
        &description,
        category_id.as_deref(),
        grounding.as_deref().unwrap_or(""),
        anchor.as_deref(),
        None,
        None,
    )?;
    let project_path = SessionService::get(&session_id)
        .ok()
        .flatten()
        .map(|s| s.project_path)
        .unwrap_or_default();
    crate::services::planning_events::emit(
        &app,
        crate::models::planning_event::PlanningEventKind::IdeaCaptured,
        &idea.id,
        &project_path,
        Some(session_id),
        &idea.title,
        None,
    );
    Ok(idea)
}

#[tauri::command]
pub fn list_ideas(session_id: String) -> Result<Vec<Idea>, String> {
    SessionService::list_ideas(&session_id)
}

#[tauri::command]
pub fn list_project_ideas(project_path: String) -> Result<Vec<Idea>, String> {
    SessionService::list_ideas_for_project(&project_path)
}

#[tauri::command]
pub fn update_idea(
    app: AppHandle,
    id: String,
    title: String,
    description: String,
    category_id: Option<String>,
) -> Result<Idea, String> {
    let idea = SessionService::update_idea(&id, &title, &description, category_id.as_deref())?;
    let project_path = SessionService::get(&idea.session_id)
        .ok()
        .flatten()
        .map(|session| session.project_path)
        .unwrap_or_default();
    crate::services::planning_events::emit(
        &app,
        crate::models::planning_event::PlanningEventKind::IdeaUpdated,
        &idea.id,
        &project_path,
        Some(idea.session_id.clone()),
        &idea.title,
        None,
    );
    Ok(idea)
}

#[tauri::command]
pub fn update_idea_status(app: AppHandle, id: String, status: String) -> Result<(), String> {
    let new_status = IdeaStatus::from_str(&status);
    SessionService::update_idea_status(&id, new_status)?;
    if let Some(idea) = SessionService::get_idea(&id)? {
        let project_path = SessionService::get(&idea.session_id)
            .ok()
            .flatten()
            .map(|s| s.project_path)
            .unwrap_or_default();
        crate::services::planning_events::emit(
            &app,
            crate::models::planning_event::PlanningEventKind::IdeaStatusChanged,
            &idea.id,
            &project_path,
            Some(idea.session_id.clone()),
            &idea.title,
            Some(new_status.as_str().to_string()),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn delete_idea(id: String) -> Result<(), String> {
    SessionService::delete_idea(&id)
}

#[tauri::command]
pub fn reject_idea(app: AppHandle, id: String) -> Result<(), String> {
    SessionService::reject_idea(&id)?;
    if let Some(idea) = SessionService::get_idea(&id)? {
        let project_path = SessionService::get(&idea.session_id)
            .ok()
            .flatten()
            .map(|s| s.project_path)
            .unwrap_or_default();
        crate::services::planning_events::emit(
            &app,
            crate::models::planning_event::PlanningEventKind::IdeaStatusChanged,
            &idea.id,
            &project_path,
            Some(idea.session_id.clone()),
            &idea.title,
            Some("rejected".to_string()),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn ensure_default_categories(session_id: String) -> Result<(), String> {
    SessionService::ensure_default_categories(&session_id)
}

#[tauri::command]
pub fn promote_ideas(app: AppHandle, input: PromoteIdeasInput) -> Result<Vec<Plan>, String> {
    let ideas = SessionService::list_ideas(&input.session_id)?;
    let project_path = SessionService::get(&input.session_id)
        .ok()
        .flatten()
        .map(|s| s.project_path)
        .unwrap_or_default();
    let mut plans = Vec::new();
    for idea_id in &input.idea_ids {
        let idea = ideas
            .iter()
            .find(|i| &i.id == idea_id)
            .ok_or_else(|| format!("Idea '{}' not found", idea_id))?;
        let plan = PlanService::create(
            &input.session_id,
            &NewPlan {
                title: idea.title.clone(),
                description: idea.description.clone(),
                goal: None,
                status: PlanStatus::Draft,
                priority: Some(50),
                tags: vec![],
                idea_id: Some(idea.id.clone()),
            },
        )?;
        SessionService::update_idea_status(&idea.id, IdeaStatus::Picked)?;
        // Emit plan_created for the new draft plan.
        crate::services::planning_events::emit(
            &app,
            crate::models::planning_event::PlanningEventKind::PlanCreated,
            &plan.id,
            &project_path,
            Some(input.session_id.clone()),
            &plan.title,
            None,
        );
        // Emit idea_status_changed for the picked idea.
        crate::services::planning_events::emit(
            &app,
            crate::models::planning_event::PlanningEventKind::IdeaStatusChanged,
            &idea.id,
            &project_path,
            Some(input.session_id.clone()),
            &idea.title,
            Some("picked".to_string()),
        );
        plans.push(plan);
    }
    Ok(plans)
}
