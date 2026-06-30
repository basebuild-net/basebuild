use serde_json::{json, Value};
use tauri::AppHandle;

use crate::{
    models::omp::{OmpCommandResult, OmpStatus},
    services::omp_service::OmpService,
};

#[tauri::command]
pub fn omp_status() -> OmpStatus {
    OmpService::status()
}

#[tauri::command]
pub fn omp_config_list() -> Result<OmpCommandResult, String> {
    OmpService::run_json(&["config", "list", "--json"])
}

#[tauri::command]
pub fn omp_stats() -> Result<Value, String> {
    let result = OmpService::run_json(&["stats", "--json"])?;
    if !result.success {
        return Err(result.stderr);
    }
    result.json.ok_or_else(|| "Failed to parse stats JSON".to_string())
}

#[tauri::command]
pub fn omp_usage() -> Result<Value, String> {
    let result = OmpService::run_json(&["usage", "--json"])?;
    if !result.success {
        return Err(result.stderr);
    }
    result.json.ok_or_else(|| "Failed to parse usage JSON".to_string())
}

#[tauri::command]
pub fn omp_debug_context() -> Result<Value, String> {
    let stats = OmpService::run_json(&["stats", "--json"]);
    let usage = OmpService::run_json(&["usage", "--json"]);
    let config = OmpService::run_json(&["config", "list", "--json"]);

    Ok(json!({
        "stats": stats.ok().and_then(|r| r.json).unwrap_or(Value::Null),
        "usage": usage.ok().and_then(|r| r.json).unwrap_or(Value::Null),
        "config": config.ok().and_then(|r| r.json).unwrap_or(Value::Null),
    }))
}

#[tauri::command]
pub fn omp_stream_command(app: AppHandle, args: Vec<String>) -> Result<u64, String> {
    OmpService::stream_command(app, args)
}
