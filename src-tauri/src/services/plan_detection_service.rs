//! Provider plan detection + declaration.
//!
//! Detection is native-first: the app decodes its own stored provider
//! credentials (OAuth JWTs) to read the subscription plan directly, with no
//! network call and no dependency on external tooling. ChatGPT/Codex tokens
//! carry `chatgpt_plan_type` in the `https://api.openai.com/auth` claim, so the
//! plan is provable from the credential the user already granted us.
//!
//! OMP (`omp usage --json`) is a *fallback and enrichment* layer, not the
//! mechanism: when a provider's credential is opaque (Anthropic's
//! `sk-ant-oat01` tokens) or absent, we consult OMP's cached usage metadata.
//! Providers still without a documented signal are flagged `needs_declaration`
//! so the user declares their exact plan — a 100%-confidence attribution rather
//! than a volume-guessed false positive.
//!
//! `list_plans()` / `declare()` bridge to basebuild.net so a declared plan syncs
//! as an authoritative attribution.

use std::collections::BTreeMap;

use base64::Engine;
use serde_json::{json, Value};

use crate::models::plan_detection::{DetectedProviderPlan, ProviderPlanOption};
use crate::services::auth_service::AuthService;
use crate::services::native_chat_service::{omp_agent_dir, NativeChatService};
use crate::services::omp_service::OmpService;
use crate::services::sync_service::call_mcp_tool;
use rusqlite::{Connection, OpenFlags};

pub struct PlanDetectionService;

impl PlanDetectionService {
    /// Detect per-provider plans, native-first. Priority:
    /// 1. Native JWT claim from the app's own stored credential (source `native`).
    /// 2. OMP usage metadata `planType` (source `omp`).
    /// 3. Connected provider with no signal → `needs_declaration`.
    /// Never fabricates a plan.
    pub fn detect() -> Result<Vec<DetectedProviderPlan>, String> {
        let credentials = NativeChatService::list_credentials().unwrap_or_default();
        let mut by_provider: BTreeMap<String, DetectedProviderPlan> = BTreeMap::new();

        // 1. Native detection — decode our own credential JWTs. No network.
        for cred in &credentials {
            if let Some(plan_type) = native_plan_type(&cred.api_key) {
                by_provider.insert(
                    cred.provider_id.clone(),
                    DetectedProviderPlan {
                        provider: cred.provider_id.clone(),
                        omp_provider: cred.label.clone(),
                        account_email: jwt_email(&cred.api_key),
                        confidence: "documented".to_string(),
                        source: "native".to_string(),
                        needs_declaration: false,
                        detected_plan_type: Some(plan_type),
                        note: None,
                    },
                );
            }
        }

        // 2. OMP fallback — fills providers native detection couldn't resolve.
        if let Ok(usage) = OmpService::run_json(&["usage", "--json"]) {
            if usage.success {
                if let Some(json) = usage.json {
                    for report in Self::parse_omp_reports(&json) {
                        by_provider.entry(report.provider.clone()).or_insert(report);
                    }
                }
            }
        }

        // 2b. Volume inference — when a provider publishes no plan API, a lower
        // plan's hard rate cap gives a lower bound: if the observed peak hourly
        // request rate exceeds that cap, the user cannot be on the lower plan.
        // Surfaced as `inferred` for the user to confirm — never auto-declared,
        // never a false positive (peak ≤ cap stays undecided).
        for baseline in VOLUME_BASELINES {
            let documented = by_provider
                .get(baseline.website_provider)
                .map(|e| !e.needs_declaration)
                .unwrap_or(false);
            if documented {
                continue;
            }
            if let Some(peak) = peak_hourly_requests(baseline.stats_provider) {
                if let Some(entry) = infer_from_volume(baseline, peak) {
                    by_provider.insert(baseline.website_provider.to_string(), entry);
                }
            }
        }

        // 3. Connected providers with no signal → needs_declaration.
        for cred in &credentials {
            by_provider
                .entry(cred.provider_id.clone())
                .or_insert_with(|| DetectedProviderPlan {
                    provider: cred.provider_id.clone(),
                    omp_provider: cred.label.clone(),
                    account_email: None,
                    confidence: "unknown".to_string(),
                    source: "none".to_string(),
                    needs_declaration: true,
                    detected_plan_type: None,
                    note: None,
                });
        }

        Ok(by_provider.into_values().collect())
    }

    /// Pure parse of an `omp usage --json` payload into per-provider detections.
    /// Only a provider-API `metadata.planType` counts as documented.
    pub fn parse_omp_reports(json: &Value) -> Vec<DetectedProviderPlan> {
        let Some(reports) = json.get("reports").and_then(Value::as_array) else {
            return Vec::new();
        };
        let mut by_provider: BTreeMap<String, DetectedProviderPlan> = BTreeMap::new();
        for report in reports {
            let omp_provider = report
                .get("provider")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if omp_provider.is_empty() {
                continue;
            }
            let provider = map_omp_provider(&omp_provider);
            let metadata = report.get("metadata");
            let account_email = metadata
                .and_then(|m| m.get("email"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let detected_plan_type = metadata
                .and_then(|m| m.get("planType"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let documented = detected_plan_type.is_some();
            let entry = DetectedProviderPlan {
                provider: provider.clone(),
                omp_provider,
                account_email,
                confidence: if documented { "documented" } else { "unknown" }.to_string(),
                source: if documented { "omp" } else { "none" }.to_string(),
                needs_declaration: !documented,
                detected_plan_type,
                note: None,
            };
            match by_provider.get(&provider) {
                Some(existing) if !existing.needs_declaration => {}
                _ => {
                    by_provider.insert(provider, entry);
                }
            }
        }
        by_provider.into_values().collect()
    }

    /// Fetch the basebuild.net plan catalog for the declaration UI. When
    /// `provider` is Some, only that provider's plans are returned.
    pub fn list_plans(provider: Option<&str>) -> Result<Vec<ProviderPlanOption>, String> {
        let token = AuthService::get_access_token()?
            .ok_or("Not signed in. Open Settings > Account to sign in.")?;
        let args = match provider {
            Some(p) => json!({ "provider": p }),
            None => json!({}),
        };
        let result = call_mcp_tool(&token, "list_plans", args)?;
        Ok(Self::parse_plan_options(&result))
    }

    /// Pure parse of a `list_plans` MCP result into plan options.
    pub fn parse_plan_options(result: &Value) -> Vec<ProviderPlanOption> {
        result
            .get("plans")
            .and_then(Value::as_array)
            .map(|plans| {
                plans
                    .iter()
                    .filter_map(|p| {
                        let id = p.get("id").and_then(Value::as_str)?.to_string();
                        let provider = p.get("provider").and_then(Value::as_str)?.to_string();
                        let name = p.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                        Some(ProviderPlanOption {
                            id,
                            provider,
                            name: name.clone(),
                            tier: p.get("tier").and_then(Value::as_str).map(str::to_string),
                            price: p.get("price").and_then(Value::as_f64),
                            period: p.get("period").and_then(Value::as_str).map(str::to_string),
                            label: p
                                .get("label")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                                .unwrap_or(name),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Declare per-provider plans to basebuild.net (100%-confidence attribution).
    /// `plans` maps a provider slug to a catalog plan id; an empty id clears it.
    pub fn declare(plans: BTreeMap<String, String>) -> Result<String, String> {
        if plans.is_empty() {
            return Err("No plans to declare.".to_string());
        }
        let token = AuthService::get_access_token()?
            .ok_or("Not signed in. Open Settings > Account to sign in.")?;
        let plan_map: serde_json::Map<String, Value> = plans
            .into_iter()
            .map(|(provider, plan_id)| {
                let value = if plan_id.is_empty() { Value::Null } else { Value::String(plan_id) };
                (provider, value)
            })
            .collect();
        let result = call_mcp_tool(&token, "declare_usage_profile", json!({ "plans": plan_map }))?;
        Ok(result
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Plans declared.")
            .to_string())
    }
}

/// Map an OMP provider id to a basebuild.net provider slug for plan attribution.
fn map_omp_provider(omp_id: &str) -> String {
    match omp_id {
        "openai-codex" => "openai".to_string(),
        "google-gemini-cli" => "google".to_string(),
        other => other.to_string(),
    }
}

/// A provider's lower-plan hard rate cap, for volume-based plan inference.
struct VolumeBaseline {
    /// basebuild.net provider slug (for the DetectedProviderPlan + declare).
    website_provider: &'static str,
    /// Provider id as stored in OMP's `stats.db` messages table.
    stats_provider: &'static str,
    /// The lower plan's hard requests-per-hour cap.
    lower_plan_hourly_cap: u64,
    lower_plan_name: &'static str,
    upper_plan_name: &'static str,
}

/// Known lower-plan rate caps. Umans Code Pro caps at 500 req/hr; sustaining a
/// peak above it means the account must be on Code Max (the higher plan).
const VOLUME_BASELINES: &[VolumeBaseline] = &[VolumeBaseline {
    website_provider: "umans-ai",
    stats_provider: "umans",
    lower_plan_hourly_cap: 500,
    lower_plan_name: "Code Pro",
    upper_plan_name: "Code Max",
}];

/// Peak requests in any single clock-hour for a provider, read from OMP's
/// `stats.db` messages table (read-only). None when the db or provider is
/// absent. This is the signal for volume-based plan inference.
fn peak_hourly_requests(stats_provider: &str) -> Option<u64> {
    let path = omp_agent_dir().parent()?.join("stats.db");
    if !path.exists() {
        return None;
    }
    let conn = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    let peak: Option<i64> = conn
        .query_row(
            "SELECT MAX(cnt) FROM (
               SELECT COUNT(*) AS cnt FROM messages
               WHERE provider = ?1
               GROUP BY CAST(timestamp / 3600000 AS INTEGER)
             )",
            [stats_provider],
            |r| r.get(0),
        )
        .ok()?;
    peak.map(|p| p.max(0) as u64)
}

/// Build a volume-inferred plan when the observed peak exceeds the baseline's
/// lower-plan cap. Returns None when peak ≤ cap (undecided — no false positive).
/// Pure: the inference rule, isolated for testing.
fn infer_from_volume(baseline: &VolumeBaseline, peak: u64) -> Option<DetectedProviderPlan> {
    if peak <= baseline.lower_plan_hourly_cap {
        return None;
    }
    Some(DetectedProviderPlan {
        provider: baseline.website_provider.to_string(),
        omp_provider: baseline.stats_provider.to_string(),
        account_email: None,
        detected_plan_type: Some(baseline.upper_plan_name.to_string()),
        confidence: "inferred".to_string(),
        source: "volume".to_string(),
        needs_declaration: true,
        note: Some(format!(
            "Peak {peak} req/hr exceeds {}'s {} req/hr cap → likely {}. Confirm your plan.",
            baseline.lower_plan_name, baseline.lower_plan_hourly_cap, baseline.upper_plan_name,
        )),
    })
}

/// Decode a JWT payload (base64url, unverified — we only read our own claims).
/// Returns the parsed claims object, or None when the token isn't a JWT.
fn decode_jwt_claims(token: &str) -> Option<Value> {
    let mut parts = token.split('.');
    let (_header, payload) = (parts.next()?, parts.next()?);
    if parts.next().is_none() {
        return None; // not a three-part JWT
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .ok()?;
    serde_json::from_slice::<Value>(&bytes).ok()
}

/// Extract a subscription plan type from a credential token's JWT claims.
/// Recognizes ChatGPT's `chatgpt_plan_type` (nested under the OpenAI auth
/// claim). Returns None for opaque tokens or tokens without a known plan claim.
fn native_plan_type(token: &str) -> Option<String> {
    let claims = decode_jwt_claims(token)?;
    // ChatGPT/Codex: nested under the OpenAI auth namespace claim.
    if let Some(pt) = claims
        .get("https://api.openai.com/auth")
        .and_then(|a| a.get("chatgpt_plan_type"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        return Some(pt.to_string());
    }
    // Some tokens surface the claim at the top level.
    claims
        .get("chatgpt_plan_type")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Extract the account email from a credential token's JWT claims, when present.
fn jwt_email(token: &str) -> Option<String> {
    let claims = decode_jwt_claims(token)?;
    claims
        .get("https://api.openai.com/profile")
        .and_then(|p| p.get("email"))
        .and_then(Value::as_str)
        .or_else(|| claims.get("email").and_then(Value::as_str))
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a fake unsigned JWT with the given payload object.
    fn make_jwt(payload: Value) -> String {
        let header = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b"{\"alg\":\"none\"}");
        let body = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&payload).unwrap());
        format!("{header}.{body}.sig")
    }

    #[test]
    fn native_plan_type_reads_chatgpt_nested_claim() {
        let tok = make_jwt(json!({
            "https://api.openai.com/auth": { "chatgpt_plan_type": "plus" }
        }));
        assert_eq!(native_plan_type(&tok).as_deref(), Some("plus"));
    }

    #[test]
    fn native_plan_type_reads_top_level_claim() {
        let tok = make_jwt(json!({ "chatgpt_plan_type": "pro" }));
        assert_eq!(native_plan_type(&tok).as_deref(), Some("pro"));
    }

    #[test]
    fn native_plan_type_none_for_opaque_token() {
        assert_eq!(native_plan_type("sk-ant-oat01-abc"), None);
        assert_eq!(native_plan_type("ya29.a0-opaque"), None);
    }

    #[test]
    fn jwt_email_reads_profile_claim() {
        let tok = make_jwt(json!({
            "https://api.openai.com/profile": { "email": "a@b.com" }
        }));
        assert_eq!(jwt_email(&tok).as_deref(), Some("a@b.com"));
    }

    #[test]
    fn parse_omp_reports_flags_undocumented() {
        let json = json!({
            "reports": [{ "provider": "anthropic", "metadata": { "email": "a@b.com" } }]
        });
        let out = PlanDetectionService::parse_omp_reports(&json);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].provider, "anthropic");
        assert!(out[0].needs_declaration);
        assert_eq!(out[0].source, "none");
    }

    #[test]
    fn parse_omp_reports_documents_plan_type() {
        let json = json!({
            "reports": [{ "provider": "openai-codex", "metadata": { "planType": "plus" } }]
        });
        let out = PlanDetectionService::parse_omp_reports(&json);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].provider, "openai");
        assert_eq!(out[0].detected_plan_type.as_deref(), Some("plus"));
        assert_eq!(out[0].source, "omp");
    }

    #[test]
    fn parse_plan_options_maps_catalog() {
        let result = json!({
            "plans": [
                { "id": "p1", "provider": "anthropic", "name": "Pro", "tier": "pro", "price": 20, "period": "month", "label": "Pro $20/month" }
            ]
        });
        let opts = PlanDetectionService::parse_plan_options(&result);
        assert_eq!(opts.len(), 1);
        assert_eq!(opts[0].id, "p1");
        assert_eq!(opts[0].label, "Pro $20/month");
    }

    #[test]
    fn volume_inference_fires_above_cap() {
        let baseline = &VOLUME_BASELINES[0];
        let out = infer_from_volume(baseline, baseline.lower_plan_hourly_cap + 1).unwrap();
        assert_eq!(out.provider, "umans-ai");
        assert_eq!(out.confidence, "inferred");
        assert_eq!(out.source, "volume");
        assert_eq!(out.detected_plan_type.as_deref(), Some("Code Max"));
        assert!(out.needs_declaration);
        assert!(out.note.is_some());
    }

    #[test]
    fn volume_inference_none_at_or_below_cap() {
        let baseline = &VOLUME_BASELINES[0];
        assert!(infer_from_volume(baseline, baseline.lower_plan_hourly_cap).is_none());
        assert!(infer_from_volume(baseline, 0).is_none());
    }

    #[test]
    fn umans_baseline_is_configured() {
        let b = VOLUME_BASELINES.iter().find(|b| b.website_provider == "umans-ai").unwrap();
        assert_eq!(b.stats_provider, "umans");
        assert_eq!(b.lower_plan_hourly_cap, 500);
    }
}
