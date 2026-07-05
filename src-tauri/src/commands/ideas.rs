use crate::{
    models::{idea::{Idea, IdeaCategory, IdeaStatus}, plan::{NewPlan, Plan, PlanStatus}},
    services::{plan_service::PlanService, session_service::SessionService},
};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromoteIdeasInput {
    pub session_id: String,
    pub idea_ids: Vec<String>,
}

#[tauri::command]
pub fn create_category(
    session_id: String,
    name: String,
    description: String,
) -> Result<IdeaCategory, String> {
    SessionService::create_category(&session_id, &name, &description)
}

#[tauri::command]
pub fn list_categories(session_id: String) -> Result<Vec<IdeaCategory>, String> {
    SessionService::list_categories(&session_id)
}

#[tauri::command]
pub fn delete_category(id: String) -> Result<(), String> {
    SessionService::delete_category(&id)
}

#[tauri::command]
pub fn create_idea(
    session_id: String,
    title: String,
    description: String,
    category_id: Option<String>,
) -> Result<Idea, String> {
    SessionService::create_idea(&session_id, &title, &description, category_id.as_deref())
}

#[tauri::command]
pub fn list_ideas(session_id: String) -> Result<Vec<Idea>, String> {
    SessionService::list_ideas(&session_id)
}

#[tauri::command]
pub fn update_idea_status(id: String, status: String) -> Result<(), String> {
    SessionService::update_idea_status(&id, IdeaStatus::from_str(&status))
}

#[tauri::command]
pub fn delete_idea(id: String) -> Result<(), String> {
    SessionService::delete_idea(&id)
}

#[tauri::command]
pub fn reject_idea(id: String) -> Result<(), String> {
    SessionService::reject_idea(&id)
}

#[tauri::command]
pub fn ensure_default_categories(session_id: String) -> Result<(), String> {
    SessionService::ensure_default_categories(&session_id)
}


/// Promote one or more ideas into draft plans. Each idea gets a linked draft
/// plan carrying its title/description; the idea moves to `picked`.
#[tauri::command]
pub fn promote_ideas(input: PromoteIdeasInput) -> Result<Vec<Plan>, String> {
    let ideas = SessionService::list_ideas(&input.session_id)?;
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
        plans.push(plan);
    }
    Ok(plans)
}
