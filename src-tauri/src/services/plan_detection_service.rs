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

use std::collections::{BTreeMap, BTreeSet};

use base64::Engine;
use serde_json::{json, Value};

use crate::models::plan_detection::{DetectedProviderPlan, ProviderPlanOption, UsageLimit};
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

        // 2a. Catalog-driven volume estimation (predictive) — for any provider
        // whose catalog plans document per-window request caps, estimate the
        // plan from observed session/weekly/monthly request volume. Best-effort:
        // needs the catalog (list_plans) + local stats.db. Lower-bound rule: if
        // observed exceeds a plan's cap the user can't be on it → step up.
        if let Ok(catalog) = Self::list_plans(None) {
            let mut plans_by_provider: BTreeMap<String, Vec<ProviderPlanOption>> = BTreeMap::new();
            for opt in catalog {
                plans_by_provider
                    .entry(opt.provider.clone())
                    .or_default()
                    .push(opt);
            }
            for (provider, plans) in &plans_by_provider {
                let documented = by_provider
                    .get(provider)
                    .map(|e| !e.needs_declaration)
                    .unwrap_or(false);
                if documented {
                    continue;
                }
                let stats_provider = website_to_stats_provider(provider);
                let observed = observed_usage(&stats_provider);
                if let Some(entry) =
                    infer_plan_from_caps(provider, &stats_provider, plans, &observed)
                {
                    by_provider.insert(provider.clone(), entry);
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
                        let name = p
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let usage_limits = parse_usage_limits(p);
                        Some(ProviderPlanOption {
                            id,
                            provider,
                            name: name.clone(),
                            tier: p.get("tier").and_then(Value::as_str).map(str::to_string),
                            price: p.get("price").and_then(Value::as_f64),
                            period: p.get("period").and_then(Value::as_str).map(str::to_string),
                            unmetered: p.get("unmetered").and_then(Value::as_bool).unwrap_or(false),
                            usage_limits,
                            usage_limit_confidence: p
                                .get("usageLimitConfidence")
                                .and_then(Value::as_str)
                                .map(str::to_string),
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
                let value = if plan_id.is_empty() {
                    Value::Null
                } else {
                    Value::String(plan_id)
                };
                (provider, value)
            })
            .collect();
        let result = call_mcp_tool(
            &token,
            "declare_usage_profile",
            json!({ "plans": plan_map }),
        )?;
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

/// Parse `usageLimits` from a `list_plans` plan JSON object. Falls back to
/// backfilling from the legacy flat cap fields when `usageLimits` is absent.
fn parse_usage_limits(p: &Value) -> Vec<UsageLimit> {
    // Primary: parse the modular `usageLimits` array from the catalog.
    if let Some(arr) = p.get("usageLimits").and_then(Value::as_array) {
        let limits: Vec<UsageLimit> = arr
            .iter()
            .filter_map(|l| {
                Some(UsageLimit {
                    window_seconds: l.get("windowSeconds").and_then(Value::as_i64),
                    request_cap: l.get("requestCap").and_then(Value::as_i64),
                    input_token_cap: l.get("inputTokenCap").and_then(Value::as_i64),
                    output_token_cap: l.get("outputTokenCap").and_then(Value::as_i64),
                    confidence: l
                        .get("confidence")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                })
            })
            .collect();
        if !limits.is_empty() {
            return limits;
        }
    }
    // Backfill: derive from legacy flat cap fields.
    let mut limits = Vec::new();
    let conf = p
        .get("usageLimitConfidence")
        .and_then(Value::as_str)
        .map(str::to_string);
    if let Some(c) = p.get("sessionRequestCap").and_then(Value::as_i64) {
        limits.push(UsageLimit {
            window_seconds: Some(18_000),
            request_cap: Some(c),
            input_token_cap: None,
            output_token_cap: None,
            confidence: conf.clone(),
        });
    }
    if let Some(c) = p.get("dailyRequestCap").and_then(Value::as_i64) {
        limits.push(UsageLimit {
            window_seconds: Some(86_400),
            request_cap: Some(c),
            input_token_cap: None,
            output_token_cap: None,
            confidence: conf.clone(),
        });
    }
    if let Some(c) = p.get("weeklyRequestCap").and_then(Value::as_i64) {
        limits.push(UsageLimit {
            window_seconds: Some(604_800),
            request_cap: Some(c),
            input_token_cap: None,
            output_token_cap: None,
            confidence: conf.clone(),
        });
    }
    if let Some(c) = p.get("monthlyRequestCap").and_then(Value::as_i64) {
        limits.push(UsageLimit {
            window_seconds: Some(2_592_000),
            request_cap: Some(c),
            input_token_cap: None,
            output_token_cap: None,
            confidence: conf.clone(),
        });
    }
    if let Some(c) = p.get("requestLimit").and_then(Value::as_i64) {
        let window_secs = parse_window_string(p.get("requestLimitWindow").and_then(Value::as_str));
        limits.push(UsageLimit {
            window_seconds: window_secs,
            request_cap: Some(c),
            input_token_cap: None,
            output_token_cap: None,
            confidence: conf,
        });
    }
    limits
}

/// Parse a window string ("5h", "3h", "1h", "day", "week", "month") into seconds.
fn parse_window_string(s: Option<&str>) -> Option<i64> {
    let s = s?.trim();
    if let Ok(h) = s.trim_end_matches(['h', 'H']).parse::<i64>() {
        return Some(h * 3600);
    }
    if let Ok(m) = s.trim_end_matches(['m', 'M']).parse::<i64>() {
        return Some(m * 60);
    }
    match s.to_lowercase().as_str() {
        "day" | "daily" => Some(86_400),
        "week" | "weekly" => Some(604_800),
        "month" | "monthly" => Some(2_592_000),
        _ => None,
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
/// Window lengths (ms) for volume estimation.
const WINDOW_HOUR_MS: i64 = 3_600_000;
const WINDOW_5H_MS: i64 = 18_000_000;
const WINDOW_WEEK_MS: i64 = 604_800_000;
const WINDOW_MONTH_MS: i64 = 2_592_000_000; // 30 days

/// Observed peak request counts per fixed window for a provider. Fixed buckets
/// are a conservative proxy for a rolling peak (bucket peak ≤ rolling peak), so
/// a "observed > cap" ruling is always sound (never a false positive).
#[derive(Debug, Clone, Default)]
struct ObservedUsage {
    peak_hour: u64,
    peak_session_5h: u64,
    peak_week: u64,
    peak_month: u64,
}

/// Open OMP's `stats.db` (read-only), sibling of the agent dir.
fn open_stats_db() -> Option<Connection> {
    let path = omp_agent_dir().parent()?.join("stats.db");
    if !path.exists() {
        return None;
    }
    Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()
}

/// Peak request count in any fixed `window_ms` bucket for a provider, from
/// OMP's stats.db messages table. None when the db/provider is absent.
fn peak_requests_in_window(conn: &Connection, stats_provider: &str, window_ms: i64) -> Option<u64> {
    let peak: Option<i64> = conn
        .query_row(
            "SELECT MAX(cnt) FROM (
               SELECT COUNT(*) AS cnt FROM messages
               WHERE provider = ?1
               GROUP BY CAST(timestamp / ?2 AS INTEGER)
             )",
            rusqlite::params![stats_provider, window_ms],
            |r| r.get(0),
        )
        .ok()?;
    peak.map(|p| p.max(0) as u64)
}

/// Peak metrics in a single fixed time bucket of `window_ms` milliseconds.
/// Fixed buckets are a conservative proxy for a rolling peak (bucket peak ≤
/// rolling peak), so "observed exceeds cap" is always sound (never a false positive).
#[derive(Debug, Clone, Default)]
struct WindowMetrics {
    requests: u64,
    input_tokens: u64,
    output_tokens: u64,
    total_tokens: u64,
}

/// Peak request count AND token volume in any fixed `window_ms` bucket for a
/// provider, from OMP's stats.db messages table. Returns zeros when the query
/// fails (missing columns, no data). This is the signal for modular cap-based
/// inference — compares against both request and token caps.
fn peak_metrics_in_window(
    conn: &Connection,
    stats_provider: &str,
    window_ms: i64,
) -> WindowMetrics {
    let row: rusqlite::Result<(i64, i64, i64, i64)> = conn.query_row(
        r#"SELECT MAX(req), MAX(inp), MAX(outp), MAX(total) FROM (
           SELECT COUNT(*) AS req,
                  SUM("input_tokens") AS inp,
                  SUM("output_tokens") AS outp,
                  SUM("input_tokens" + "output_tokens" + "cache_read_tokens") AS total
           FROM messages
           WHERE provider = ?1
           GROUP BY CAST(timestamp / ?2 AS INTEGER)
         )"#,
        rusqlite::params![stats_provider, window_ms],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    );
    match row {
        Ok((req, inp, outp, total)) => WindowMetrics {
            requests: req.max(0) as u64,
            input_tokens: inp.max(0) as u64,
            output_tokens: outp.max(0) as u64,
            total_tokens: total.max(0) as u64,
        },
        Err(_) => WindowMetrics::default(),
    }
}

/// Compute a provider's observed peak request volume across legacy fixed windows.
fn observed_usage(stats_provider: &str) -> ObservedUsage {
    let Some(conn) = open_stats_db() else {
        return ObservedUsage::default();
    };
    ObservedUsage {
        peak_hour: peak_requests_in_window(&conn, stats_provider, WINDOW_HOUR_MS).unwrap_or(0),
        peak_session_5h: peak_requests_in_window(&conn, stats_provider, WINDOW_5H_MS).unwrap_or(0),
        peak_week: peak_requests_in_window(&conn, stats_provider, WINDOW_WEEK_MS).unwrap_or(0),
        peak_month: peak_requests_in_window(&conn, stats_provider, WINDOW_MONTH_MS).unwrap_or(0),
    }
}

/// Umans-baseline compatibility: peak requests in any single clock-hour.
fn peak_hourly_requests(stats_provider: &str) -> Option<u64> {
    let conn = open_stats_db()?;
    peak_requests_in_window(&conn, stats_provider, WINDOW_HOUR_MS)
}

/// Map a basebuild.net provider slug to the id used in OMP's stats.db messages.
fn website_to_stats_provider(website: &str) -> String {
    match website {
        "openai" => "openai-codex".to_string(),
        "google" => "google-gemini-cli".to_string(),
        "umans-ai" => "umans".to_string(),
        other => other.to_string(),
    }
}

/// Estimate a plan from observed usage volume vs the catalog's modular per-window
/// caps. For each plan, for each `UsageLimit` with a defined `window_seconds`:
/// compute the observed peak (requests + tokens) in that exact window, and rule
/// out the plan if any cap is exceeded. Pick the cheapest surviving plan. Returns
/// None when the evidence doesn't rule out the cheapest plan (ambiguous — no
/// guess) or no plan declares a usable cap. Predictive: `confidence = "inferred"`.
fn infer_plan_from_caps(
    provider: &str,
    stats_provider: &str,
    plans: &[ProviderPlanOption],
    _observed: &ObservedUsage,
) -> Option<DetectedProviderPlan> {
    // Collect all unique window lengths (in ms) from the plans' usage_limits.
    let mut window_ms_set: BTreeSet<i64> = BTreeSet::new();
    for p in plans {
        for l in &p.usage_limits {
            if let Some(secs) = l.window_seconds {
                window_ms_set.insert(secs * 1000);
            }
        }
    }
    // Compute observed peak metrics per window (single stats.db connection).
    let conn = open_stats_db();
    let metrics_by_window: BTreeMap<i64, WindowMetrics> = match &conn {
        Some(c) => window_ms_set
            .iter()
            .map(|&wms| (wms, peak_metrics_in_window(c, stats_provider, wms)))
            .collect(),
        None => BTreeMap::new(),
    };
    infer_from_modular_caps(provider, stats_provider, plans, &metrics_by_window)
}

/// Pure inference rule: given plans + observed peak metrics per window (ms),
/// rule out any plan whose cap is exceeded and pick the cheapest survivor.
/// No db access — testable in isolation. Returns None when ambiguous (cheapest
/// not ruled out) or no plan has usable caps. Predictive: `confidence = "inferred"`.
fn infer_from_modular_caps(
    provider: &str,
    stats_provider: &str,
    plans: &[ProviderPlanOption],
    metrics_by_window: &BTreeMap<i64, WindowMetrics>,
) -> Option<DetectedProviderPlan> {
    let mut priced: Vec<&ProviderPlanOption> = plans.iter().filter(|p| p.price.is_some()).collect();
    if priced.len() < 2 {
        return None;
    }
    let has_caps = priced.iter().any(|p| {
        p.usage_limits.iter().any(|l| {
            l.window_seconds.is_some()
                && (l.request_cap.is_some()
                    || l.input_token_cap.is_some()
                    || l.output_token_cap.is_some())
        })
    });
    if !has_caps {
        return None;
    }
    priced.sort_by(|a, b| {
        a.price
            .unwrap_or(f64::MAX)
            .partial_cmp(&b.price.unwrap_or(f64::MAX))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let ruled_out = |p: &ProviderPlanOption| -> Option<String> {
        if p.unmetered {
            return None;
        }
        for l in &p.usage_limits {
            let Some(secs) = l.window_seconds else {
                continue;
            };
            let wms = secs * 1000;
            let Some(m) = metrics_by_window.get(&wms) else {
                continue;
            };
            if let Some(cap) = l.request_cap {
                if m.requests > cap as u64 {
                    return Some(format!("{}s request cap", secs));
                }
            }
            if let Some(cap) = l.input_token_cap {
                if m.input_tokens > cap as u64 {
                    return Some(format!("{}s input token cap", secs));
                }
            }
            if let Some(cap) = l.output_token_cap {
                if m.output_tokens > cap as u64 {
                    return Some(format!("{}s output token cap", secs));
                }
            }
        }
        None
    };
    let cheapest = priced[0];
    let cheapest_exceeded = ruled_out(cheapest)?; // None ⇒ ambiguous ⇒ no guess
    let inferred = priced
        .iter()
        .find(|p| ruled_out(p).is_none())
        .copied()
        .unwrap_or_else(|| *priced.last().unwrap());
    let conf = inferred
        .usage_limit_confidence
        .clone()
        .unwrap_or_else(|| "inferred".to_string());
    let note = format!(
        "Observed usage exceeds {}'s {} → likely {}. Estimate from volume; confirm your plan.",
        cheapest.name, cheapest_exceeded, inferred.name,
    );
    Some(DetectedProviderPlan {
        provider: provider.to_string(),
        omp_provider: stats_provider.to_string(),
        account_email: None,
        detected_plan_type: Some(inferred.name.clone()),
        confidence: if conf == "documented" {
            "inferred".to_string()
        } else {
            conf
        },
        source: "volume".to_string(),
        needs_declaration: true,
        note: Some(note),
    })
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
        let b = VOLUME_BASELINES
            .iter()
            .find(|b| b.website_provider == "umans-ai")
            .unwrap();
        assert_eq!(b.stats_provider, "umans");
        assert_eq!(b.lower_plan_hourly_cap, 500);
    }

    fn plan(
        name: &str,
        price: f64,
        session_cap: Option<i64>,
        unmetered: bool,
    ) -> ProviderPlanOption {
        let usage_limits = session_cap
            .map(|c| {
                vec![UsageLimit {
                    window_seconds: Some(18_000),
                    request_cap: Some(c),
                    input_token_cap: None,
                    output_token_cap: None,
                    confidence: None,
                }]
            })
            .unwrap_or_default();
        ProviderPlanOption {
            id: name.to_string(),
            provider: "acme".to_string(),
            name: name.to_string(),
            tier: Some("pro".to_string()),
            price: Some(price),
            period: Some("month".to_string()),
            unmetered,
            usage_limits,
            usage_limit_confidence: None,
            label: name.to_string(),
        }
    }

    fn metrics_5h(requests: u64) -> BTreeMap<i64, WindowMetrics> {
        let mut m = BTreeMap::new();
        m.insert(
            18_000_000,
            WindowMetrics {
                requests,
                ..Default::default()
            },
        );
        m
    }

    #[test]
    fn caps_inference_steps_up_when_cheapest_exceeded() {
        let plans = vec![
            plan("Lite", 10.0, Some(100), false),
            plan("Max", 40.0, None, true),
        ];
        let metrics = metrics_5h(150);
        let out = infer_from_modular_caps("acme", "acme", &plans, &metrics).unwrap();
        assert_eq!(out.detected_plan_type.as_deref(), Some("Max"));
        assert_eq!(out.confidence, "inferred");
        assert_eq!(out.source, "volume");
        assert!(out.needs_declaration);
    }

    #[test]
    fn caps_inference_none_when_cheapest_fits() {
        let plans = vec![
            plan("Lite", 10.0, Some(100), false),
            plan("Max", 40.0, None, true),
        ];
        let metrics = metrics_5h(50);
        assert!(infer_from_modular_caps("acme", "acme", &plans, &metrics).is_none());
    }

    #[test]
    fn caps_inference_none_without_caps() {
        let plans = vec![
            plan("Lite", 10.0, None, false),
            plan("Max", 40.0, None, true),
        ];
        let metrics = metrics_5h(9999);
        assert!(infer_from_modular_caps("acme", "acme", &plans, &metrics).is_none());
    }

    #[test]
    fn caps_inference_none_with_single_plan() {
        let plans = vec![plan("Only", 10.0, Some(100), false)];
        let metrics = metrics_5h(9999);
        assert!(infer_from_modular_caps("acme", "acme", &plans, &metrics).is_none());
    }

    #[test]
    fn caps_inference_picks_priciest_when_all_exceeded() {
        let plans = vec![
            plan("Lite", 10.0, Some(100), false),
            plan("Mid", 25.0, Some(500), false),
        ];
        let metrics = metrics_5h(10_000);
        let out = infer_from_modular_caps("acme", "acme", &plans, &metrics).unwrap();
        assert_eq!(out.detected_plan_type.as_deref(), Some("Mid"));
    }

    #[test]
    fn caps_inference_token_cap_rules_out_plan() {
        let plans = vec![
            ProviderPlanOption {
                id: "p1".into(),
                provider: "acme".into(),
                name: "Lite".into(),
                tier: Some("pro".into()),
                price: Some(10.0),
                period: Some("month".into()),
                unmetered: false,
                usage_limits: vec![UsageLimit {
                    window_seconds: Some(604_800),
                    request_cap: None,
                    input_token_cap: Some(1_000_000),
                    output_token_cap: None,
                    confidence: None,
                }],
                usage_limit_confidence: None,
                label: "Lite".into(),
            },
            ProviderPlanOption {
                id: "p2".into(),
                provider: "acme".into(),
                name: "Max".into(),
                tier: Some("pro".into()),
                price: Some(40.0),
                period: Some("month".into()),
                unmetered: false,
                usage_limits: vec![UsageLimit {
                    window_seconds: Some(604_800),
                    request_cap: None,
                    input_token_cap: Some(10_000_000),
                    output_token_cap: None,
                    confidence: None,
                }],
                usage_limit_confidence: None,
                label: "Max".into(),
            },
        ];
        let mut metrics = BTreeMap::new();
        metrics.insert(
            604_800_000,
            WindowMetrics {
                input_tokens: 2_000_000,
                ..Default::default()
            },
        );
        let out = infer_from_modular_caps("acme", "acme", &plans, &metrics).unwrap();
        assert_eq!(out.detected_plan_type.as_deref(), Some("Max"));
    }

    #[test]
    fn parse_usage_limits_from_modular_array() {
        let p = json!({
            "usageLimits": [
                {"windowSeconds": 18000, "requestCap": 200, "inputTokenCap": null, "outputTokenCap": null, "confidence": "documented"},
                {"windowSeconds": 604800, "requestCap": null, "inputTokenCap": 50000000, "outputTokenCap": null, "confidence": "documented"}
            ]
        });
        let limits = parse_usage_limits(&p);
        assert_eq!(limits.len(), 2);
        assert_eq!(limits[0].window_seconds, Some(18_000));
        assert_eq!(limits[0].request_cap, Some(200));
        assert_eq!(limits[1].window_seconds, Some(604_800));
        assert_eq!(limits[1].input_token_cap, Some(50_000_000));
    }

    #[test]
    fn parse_usage_limits_backfill_from_legacy_fields() {
        let p = json!({
            "sessionRequestCap": 200,
            "weeklyRequestCap": 2000,
            "requestLimit": 80,
            "requestLimitWindow": "3h"
        });
        let limits = parse_usage_limits(&p);
        assert_eq!(limits.len(), 3);
        assert!(limits
            .iter()
            .any(|l| l.window_seconds == Some(18_000) && l.request_cap == Some(200)));
        assert!(limits
            .iter()
            .any(|l| l.window_seconds == Some(604_800) && l.request_cap == Some(2000)));
        assert!(limits
            .iter()
            .any(|l| l.window_seconds == Some(10_800) && l.request_cap == Some(80)));
    }

    #[test]
    fn parse_window_string_handles_common_formats() {
        assert_eq!(parse_window_string(Some("5h")), Some(18_000));
        assert_eq!(parse_window_string(Some("3h")), Some(10_800));
        assert_eq!(parse_window_string(Some("1h")), Some(3_600));
        assert_eq!(parse_window_string(Some("30m")), Some(1_800));
        assert_eq!(parse_window_string(Some("day")), Some(86_400));
        assert_eq!(parse_window_string(Some("week")), Some(604_800));
        assert_eq!(parse_window_string(Some("month")), Some(2_592_000));
        assert_eq!(parse_window_string(None), None);
        assert_eq!(parse_window_string(Some("unknown")), None);
    }
}
