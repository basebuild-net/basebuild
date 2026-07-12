//! Provider plan detection + declaration models.
//!
//! Detection is native-first: the app decodes its own stored provider
//! credentials (OAuth JWTs) to read the subscription plan directly. OMP usage
//! metadata and request-volume heuristics are fallbacks. Providers whose plan
//! can't be proven are flagged `needs_declaration` so the user declares their
//! exact plan — a 100%-confidence attribution, never a false positive. A
//! volume-based inference (e.g. Umans exceeding a lower plan's hourly cap) is
//! surfaced as `confidence = "inferred"` with an explanatory `note`, still
//! requiring user confirmation.

use serde::{Deserialize, Serialize};

/// One provider's detected subscription plan, resolved from local data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedProviderPlan {
    /// basebuild.net provider slug (e.g. `anthropic`, `openai`, `google`).
    pub provider: String,
    /// The OMP provider id the signal came from (e.g. `openai-codex`).
    pub omp_provider: String,
    /// Account email tied to the credential, when exposed.
    pub account_email: Option<String>,
    /// The raw plan-type string detected (e.g. `plus`) or an inferred plan name.
    /// None when no plan could be resolved.
    pub detected_plan_type: Option<String>,
    /// `documented` (native/provider-API) | `inferred` (volume) | `unknown`.
    pub confidence: String,
    /// How the signal was resolved: `native` | `omp` | `volume` | `none`.
    pub source: String,
    /// True when the plan isn't proven and the user should declare/confirm it.
    pub needs_declaration: bool,
    /// Human-readable note explaining an inference (e.g. a volume-based guess).
    pub note: Option<String>,
}

/// One modular per-window usage cap from the catalog. Window length is data
/// (seconds), not a fixed column — handles 5h, 4h, 2h, 1h, daily, weekly,
/// monthly, any period. NULL window = per-request limit (context window).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimit {
    /// Window length in seconds (18000=5h, 3600=1h, 86400=1d, 604800=7d,
    /// 2592000=30d). None = per-request limit (not a period cap).
    pub window_seconds: Option<i64>,
    /// Max requests in the window. None = no request cap.
    pub request_cap: Option<i64>,
    /// Max input tokens in the window. None = no input token cap.
    pub input_token_cap: Option<i64>,
    /// Max output tokens in the window. None = no output token cap.
    pub output_token_cap: Option<i64>,
    /// How reliable: "documented" | "inferred" | "unknown".
    pub confidence: Option<String>,
}

 /// One selectable plan from the basebuild.net catalog, for the declaration UI.
 #[derive(Debug, Clone, Serialize, Deserialize)]
 #[serde(rename_all = "camelCase")]
 pub struct ProviderPlanOption {
     /// Catalog `ProviderPlan.id` — the exact id passed to `declare_usage_profile`.
     pub id: String,
     pub provider: String,
     pub name: String,
     pub tier: Option<String>,
     pub price: Option<f64>,
     pub period: Option<String>,
     /// Whether the plan is unmetered (no request cap).
     pub unmetered: bool,
    /// Modular per-window usage caps from the catalog. Canonical source for
    /// volume-based plan estimation. Backfilled from legacy flat fields when
    /// the catalog response doesn't include `usageLimits`.
    pub usage_limits: Vec<UsageLimit>,
     /// Catalog-declared confidence in the limit data (e.g. `documented`).
     pub usage_limit_confidence: Option<String>,
     pub label: String,
 }
