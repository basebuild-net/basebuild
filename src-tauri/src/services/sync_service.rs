use serde_json::{json, Value};

use crate::services::auth_service::AuthService;
use crate::services::omp_service::OmpService;

const MCP_URL: &str = "https://basebuild.app/api/mcp";

/// Sync raw OMP usage to basebuild.net using the stored native token.
/// Collects `omp stats --json` and `omp usage --json`, then sends them
/// as a `sync_raw_usage` JSON-RPC call to the hosted MCP endpoint.
///
/// Returns a human-readable result message.
pub fn sync_raw_usage_native() -> Result<String, String> {
    // 1. Get the stored native token
    let token = AuthService::get_access_token()?
        .ok_or("Not signed in. Open Settings > Account to sign in.")?;

    // 2. Collect OMP stats and usage
    let stats = OmpService::run_json(&["stats", "--json"])
        .map_err(|e| format!("Failed to run `omp stats --json`: {e}"))?;
    let stats_json = if stats.success {
        stats.json.clone().unwrap_or(Value::Null)
    } else {
        return Err(format!("`omp stats --json` failed: {}", stats.stderr));
    };

    let usage = OmpService::run_json(&["usage", "--json"])
        .map_err(|e| format!("Failed to run `omp usage --json`: {e}"))?;
    let usage_json = if usage.success {
        usage.json.clone().unwrap_or(Value::Null)
    } else {
        return Err(format!("`omp usage --json` failed: {}", usage.stderr));
    };

    // 3. Build the JSON-RPC request
    let rpc_body = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": "sync_raw_usage",
            "arguments": {
                "stats": stats_json,
                "usage": usage_json,
            }
        }
    });

    // 4. Send to MCP endpoint
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(MCP_URL)
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .json(&rpc_body)
        .send()
        .map_err(|e| format!("Failed to connect to basebuild.net: {e}"))?;

    let status = resp.status();
    let text = resp.text().unwrap_or_default();

    if status == reqwest::StatusCode::UNAUTHORIZED {
        // Token may be revoked or expired — clear it
        let _ = AuthService::clear_auth();
        return Err("Token expired or revoked. Please sign in again.".into());
    }

    if !status.is_success() {
        return Err(format!("MCP sync failed ({status}): {text}"));
    }

    // Parse the JSON-RPC response
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse MCP response: {e}"))?;

    if let Some(error) = parsed.get("error") {
        let message = error.get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown MCP error");
        return Err(format!("MCP error: {message}"));
    }

    // Extract result text
    let result = parsed.get("result")
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("text"))
        .and_then(|v| v.as_str())
        .unwrap_or("Usage synced successfully.");

    Ok(result.to_string())
}
