use crate::services::command_discovery_service::{
    self, expand_template, parse_arguments, ExpandedCommand, SlashCommand,
};

#[tauri::command]
pub fn list_slash_commands(project_path: String) -> Result<Vec<SlashCommand>, String> {
    Ok(command_discovery_service::discover_commands(&project_path))
}

#[tauri::command]
pub fn expand_slash_command(
    body: String,
    args: String,
) -> Result<ExpandedCommand, String> {
    let parsed_args = parse_arguments(&args);
    let prompt = expand_template(&body, &parsed_args);
    Ok(ExpandedCommand {
        prompt: Some(prompt),
        builtin_action: None,
        arguments: parsed_args,
    })
}
