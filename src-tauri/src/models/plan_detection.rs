//! Provider plan detection + declaration models.
//!
//! Detection reads the local OMP usage ledger (`omp usage --json`) and extracts
//! the subscription plan signal a provider exposes. OpenAI/Codex reports a
//! concrete `planType` (e.g. `plus`); Anthropic's OAuth usage endpoint reports
//! only utilization percentages with no plan name. Providers without a
//! documented plan signal are flagged `needs_declaration` so the user can pick
//! their exact plan, which is then synced to basebuild.net for 100%-confidence
//! attribution (never a volume-guessed false positive).

use serde::{Deserialize, Serialize};

/// One provider's detected subscription plan, resolved from local OMP data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedProviderPlan {
    /// basebuild.net provider slug (e.g. `anthropic`, `openai`, `google`).
    pub provider: String,
    /// The OMP provider id the signal came from (e.g. `openai-codex`).
    pub omp_provider: String,
    /// Account email tied to the credential, when OMP exposes it.
    pub account_email: Option<String>,
    /// The raw plan-type string the provider API reported (e.g. `plus`).
    /// None when the provider exposes no plan name (e.g. Anthropic).
    pub detected_plan_type: Option<String>,
    /// `documented` when a provider-API plan type was found; else `unknown`.
    pub confidence: String,
    /// How the signal was resolved: `provider-api` | `none`.
    pub source: String,
    /// True when auto-detection failed and the user must declare the plan.
    pub needs_declaration: bool,
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
    /// Human-readable label (e.g. `Pro $20/month`).
    pub label: String,
}
