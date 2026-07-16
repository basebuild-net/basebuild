use serde::{Deserialize, Serialize};

use crate::models::planning_assessment::ImplementationAssessment;

pub const EXECUTION_ADVICE_SCHEMA_VERSION: u8 = 1;
pub const MODEL_EXECUTION_PROFILE_SCHEMA_VERSION: u8 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionRole {
    Planner,
    Coder,
}

impl ExecutionRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Planner => "planner",
            Self::Coder => "coder",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelExecutionRouteV1 {
    pub provider_slug: String,
    pub model_slug: String,
    pub api_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelExecutionCapabilitiesV1 {
    pub tools: bool,
    pub reasoning: bool,
    pub structured_output: bool,
    pub images: bool,
    pub context_limit: Option<u32>,
    pub output_limit: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionSignalKind {
    Coding,
    Reasoning,
    Agentic,
    Intelligence,
    OutputSpeed,
    Latency,
    CostPerTask,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceConfidence {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelExecutionSignalV1 {
    pub kind: ExecutionSignalKind,
    pub normalized_value: Option<f64>,
    pub raw_value: Option<f64>,
    pub unit: String,
    pub source_name: String,
    pub source_url: String,
    pub measured_at: Option<String>,
    pub fetched_at: String,
    pub confidence: EvidenceConfidence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelExecutionEconomicsV1 {
    pub input_price: Option<f64>,
    pub output_price: Option<f64>,
    pub subscription_plans: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelExecutionProfileV1 {
    pub schema_version: u8,
    pub canonical_model_id: String,
    pub provider_family: String,
    pub display_name: String,
    pub routes: Vec<ModelExecutionRouteV1>,
    pub capabilities: ModelExecutionCapabilitiesV1,
    pub signals: Vec<ModelExecutionSignalV1>,
    pub economics: Option<ModelExecutionEconomicsV1>,
    pub fetched_at: String,
}

impl ModelExecutionProfileV1 {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != MODEL_EXECUTION_PROFILE_SCHEMA_VERSION {
            return Err("unsupported model execution profile schemaVersion".to_string());
        }
        validate_id("canonicalModelId", &self.canonical_model_id)?;
        validate_id("providerFamily", &self.provider_family)?;
        validate_text("displayName", &self.display_name, 240)?;
        validate_text("fetchedAt", &self.fetched_at, 80)?;
        if self.routes.is_empty() || self.routes.len() > 128 {
            return Err("model execution profile routes must contain 1-128 entries".to_string());
        }
        for route in &self.routes {
            validate_id("route.providerSlug", &route.provider_slug)?;
            validate_id("route.modelSlug", &route.model_slug)?;
            validate_text("route.apiId", &route.api_id, 240)?;
        }
        if self.signals.len() > 32 {
            return Err(
                "model execution profile signals must contain at most 32 entries".to_string(),
            );
        }
        for signal in &self.signals {
            if let Some(value) = signal.normalized_value {
                if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                    return Err(
                        "signal normalizedValue must be finite and between 0 and 1".to_string()
                    );
                }
            }
            if signal.raw_value.is_some_and(|value| !value.is_finite()) {
                return Err("signal rawValue must be finite".to_string());
            }
            validate_text("signal.unit", &signal.unit, 80)?;
            validate_text("signal.sourceName", &signal.source_name, 240)?;
            validate_text("signal.sourceUrl", &signal.source_url, 2_000)?;
            if !signal.source_url.starts_with("https://")
                && !signal.source_url.starts_with("http://")
            {
                return Err("signal sourceUrl must use http or https".to_string());
            }
            validate_text("signal.fetchedAt", &signal.fetched_at, 80)?;
            if let Some(measured_at) = &signal.measured_at {
                validate_text("signal.measuredAt", measured_at, 80)?;
            }
        }
        if let Some(economics) = &self.economics {
            for value in [economics.input_price, economics.output_price]
                .into_iter()
                .flatten()
            {
                if !value.is_finite() || value < 0.0 {
                    return Err("economics prices must be finite and non-negative".to_string());
                }
            }
            if economics.subscription_plans.len() > 32 {
                return Err(
                    "economics subscriptionPlans must contain at most 32 entries".to_string(),
                );
            }
            for plan in &economics.subscription_plans {
                validate_text("economics.subscriptionPlans", plan, 240)?;
            }
        }
        Ok(())
    }

    pub fn signal(&self, kind: ExecutionSignalKind) -> Option<&ModelExecutionSignalV1> {
        self.signals.iter().find(|signal| signal.kind == kind)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CapacityEvidence {
    pub provider_id: String,
    pub remaining_fraction: Option<f64>,
    pub observed_at: Option<i64>,
    pub source: String,
    pub stale: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionRouteCandidate {
    pub provider_id: String,
    pub model_id: String,
    pub label: String,
    pub connected: bool,
    pub blocked: bool,
    pub supports_tools: bool,
    pub supports_reasoning: bool,
    pub supports_images: bool,
    pub supported_efforts: Vec<String>,
    pub context_window: Option<i64>,
    pub input_price: Option<f64>,
    pub output_price: Option<f64>,
    pub profile: Option<ModelExecutionProfileV1>,
    pub profile_cached_at: Option<i64>,
    pub profile_error: Option<String>,
    pub capacity: Option<CapacityEvidence>,
    pub selected: bool,
    pub user_override: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionAdvisorInput {
    pub role: ExecutionRole,
    pub assessment: ImplementationAssessment,
    pub expected_context_tokens: Option<u32>,
    pub routes: Vec<ExecutionRouteCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdviceFactor {
    pub name: String,
    pub score: f64,
    pub max_score: f64,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RouteRecommendation {
    pub provider_id: String,
    pub model_id: String,
    pub label: String,
    pub score: f64,
    pub confidence: EvidenceConfidence,
    pub factors: Vec<AdviceFactor>,
    pub reasons: Vec<String>,
    pub source_freshness: Vec<String>,
    pub user_override: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedRoute {
    pub provider_id: String,
    pub model_id: String,
    pub reasons: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoleExecutionAdvice {
    pub role: ExecutionRole,
    pub recommendation: Option<RouteRecommendation>,
    pub alternatives: Vec<RouteRecommendation>,
    pub excluded: Vec<ExcludedRoute>,
    pub confidence: EvidenceConfidence,
    pub generated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionAdviceBundle {
    pub schema_version: u8,
    pub assessment_source: String,
    pub assessment_stale: bool,
    pub difficulty_bucket: u8,
    pub effort_bucket: String,
    pub planner: RoleExecutionAdvice,
    pub coder: RoleExecutionAdvice,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AdvisorFeedbackOutcome {
    Accepted,
    Overridden,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorFeedbackEvent {
    pub id: String,
    pub schema_version: u8,
    pub role: ExecutionRole,
    pub recommended_provider_id: String,
    pub recommended_model_id: String,
    pub selected_provider_id: String,
    pub selected_model_id: String,
    pub outcome: AdvisorFeedbackOutcome,
    pub confidence: EvidenceConfidence,
    pub difficulty_bucket: u8,
    pub effort_bucket: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewAdvisorFeedbackEvent {
    pub role: ExecutionRole,
    pub recommended_provider_id: String,
    pub recommended_model_id: String,
    pub selected_provider_id: String,
    pub selected_model_id: String,
    pub outcome: AdvisorFeedbackOutcome,
    pub confidence: EvidenceConfidence,
    pub difficulty_bucket: u8,
    pub effort_bucket: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdvisorFeedbackConsent {
    pub enabled: bool,
    pub updated_at: Option<i64>,
}

impl Default for AdvisorFeedbackConsent {
    fn default() -> Self {
        Self {
            enabled: false,
            updated_at: None,
        }
    }
}

fn validate_id(name: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 240
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._/@:-".contains(&byte))
    {
        return Err(format!("{name} must be a bounded identifier"));
    }
    Ok(())
}

fn validate_text(name: &str, value: &str, max: usize) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().count() > max {
        return Err(format!("{name} must contain 1-{max} characters"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unbounded_or_unproven_profile_values() {
        let mut profile = ModelExecutionProfileV1 {
            schema_version: 1,
            canonical_model_id: "claude/sonnet-4-5".to_string(),
            provider_family: "anthropic".to_string(),
            display_name: "Claude Sonnet 4.5".to_string(),
            routes: vec![ModelExecutionRouteV1 {
                provider_slug: "anthropic".to_string(),
                model_slug: "claude-sonnet-4-5".to_string(),
                api_id: "claude-sonnet-4-5".to_string(),
            }],
            capabilities: ModelExecutionCapabilitiesV1 {
                tools: true,
                reasoning: true,
                structured_output: true,
                images: true,
                context_limit: Some(200_000),
                output_limit: Some(64_000),
            },
            signals: vec![ModelExecutionSignalV1 {
                kind: ExecutionSignalKind::Coding,
                normalized_value: None,
                raw_value: None,
                unit: "index".to_string(),
                source_name: "Public benchmark".to_string(),
                source_url: "https://basebuild.net/methodology".to_string(),
                measured_at: None,
                fetched_at: "2026-07-16T00:00:00Z".to_string(),
                confidence: EvidenceConfidence::Low,
            }],
            economics: None,
            fetched_at: "2026-07-16T00:00:00Z".to_string(),
        };
        assert!(profile.validate().is_ok());
        profile.signals[0].normalized_value = Some(f64::NAN);
        assert!(profile.validate().is_err());
    }
}
