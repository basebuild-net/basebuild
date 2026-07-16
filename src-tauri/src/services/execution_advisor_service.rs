use std::collections::{HashMap, HashSet};

use rusqlite::{params, OptionalExtension};

use crate::{
    models::{
        execution_advisor::{
            AdviceFactor, CapacityEvidence, EvidenceConfidence, ExcludedRoute,
            ExecutionAdviceBundle, ExecutionAdvisorInput, ExecutionRole, ExecutionRouteCandidate,
            ExecutionSignalKind, ModelExecutionProfileV1, RoleExecutionAdvice,
            RouteRecommendation, EXECUTION_ADVICE_SCHEMA_VERSION,
        },
        planning_assessment::ImplementationAssessment,
    },
    services::{
        native_chat_service::NativeChatService,
        omp_telemetry_service::OmpTelemetryService,
        plan_service::PlanService,
        provider_model_catalog_service::ProviderModelCatalogService,
        session_service::SessionService,
        sync_service,
        storage_service::StorageService,
    },
};

type DbResult<T> = Result<T, String>;

const PROFILE_STALE_SECONDS: i64 = 7 * 24 * 60 * 60;
const CAPACITY_STALE_SECONDS: i64 = 60 * 60;

#[derive(Clone)]
struct CachedProfile {
    profile: ModelExecutionProfileV1,
    fetched_at: i64,
    error: Option<String>,
}

pub struct ExecutionAdvisorService;

impl ExecutionAdvisorService {
    pub fn get_advice(
        project_path: &str,
        plan_id: Option<&str>,
        idea_id: Option<&str>,
    ) -> DbResult<ExecutionAdviceBundle> {
        if project_path.trim().is_empty() || project_path.chars().count() > 4_000 {
            return Err("projectPath is required and must be 4,000 characters or fewer".to_string());
        }
        let (assessment, expected_context_tokens, assessment_source, assessment_stale) =
            Self::resolve_assessment(plan_id, idea_id)?;
        assessment.validate()?;

        let planner_input = Self::build_input(
            project_path,
            ExecutionRole::Planner,
            &assessment,
            expected_context_tokens,
        )?;
        let coder_input = Self::build_input(
            project_path,
            ExecutionRole::Coder,
            &assessment,
            expected_context_tokens,
        )?;

        Ok(ExecutionAdviceBundle {
            schema_version: EXECUTION_ADVICE_SCHEMA_VERSION,
            assessment_source,
            assessment_stale,
            planner: Self::rank(planner_input),
            coder: Self::rank(coder_input),
        })
    }

    pub fn set_override(
        project_path: &str,
        role: ExecutionRole,
        provider_id: &str,
        model_id: &str,
    ) -> DbResult<()> {
        validate_route_id("providerId", provider_id)?;
        validate_route_id("modelId", model_id)?;
        let catalog = ProviderModelCatalogService::catalog();
        let exists = catalog
            .models
            .iter()
            .any(|model| model.provider_id == provider_id && model.id == model_id);
        if !exists {
            return Err("The selected provider/model route is not in the local catalog".to_string());
        }
        let conn = StorageService::connect()?;
        conn.execute(
            "INSERT INTO execution_advisor_overrides
                (project_path, role, provider_id, model_id, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(project_path, role) DO UPDATE SET
                provider_id = excluded.provider_id,
                model_id = excluded.model_id,
                updated_at = excluded.updated_at",
            params![project_path, role.as_str(), provider_id, model_id, now_seconds()],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn clear_override(project_path: &str, role: ExecutionRole) -> DbResult<()> {
        let conn = StorageService::connect()?;
        conn.execute(
            "DELETE FROM execution_advisor_overrides WHERE project_path = ?1 AND role = ?2",
            params![project_path, role.as_str()],
        )
        .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub fn rank(input: ExecutionAdvisorInput) -> RoleExecutionAdvice {
        let generated_at = now_seconds();
        let requires_images = input
            .assessment
            .required_capabilities
            .iter()
            .any(|value| value.to_ascii_lowercase().contains("image"));
        let mut recommendations = Vec::new();
        let mut excluded = Vec::new();

        for route in input.routes {
            let mut hard_reasons = Vec::new();
            if !route.connected {
                hard_reasons.push("Provider is not connected".to_string());
            }
            if route.blocked {
                hard_reasons.push("Provider is blocked locally".to_string());
            }
            if !route.supports_tools {
                hard_reasons.push("Route does not support tool calls".to_string());
            }
            if requires_images && !route.supports_images {
                hard_reasons.push("Plan requires image input support".to_string());
            }
            if let (Some(required), Some(limit)) = (input.expected_context_tokens, route.context_window) {
                if i64::from(required) > limit {
                    hard_reasons.push(format!(
                        "Estimated context {required} exceeds the {limit} token route limit"
                    ));
                }
            }
            if input.role == ExecutionRole::Planner
                && input.assessment.difficulty >= 4
                && !route.supports_reasoning
            {
                hard_reasons.push("High-difficulty planning requires a reasoning-capable route".to_string());
            }
            if route
                .capacity
                .as_ref()
                .filter(|capacity| !capacity.stale)
                .and_then(|capacity| capacity.remaining_fraction)
                .is_some_and(|remaining| remaining <= 0.05)
                && !route.user_override
            {
                hard_reasons.push("Fresh local usage shows less than 5% capacity remaining".to_string());
            }
            if !hard_reasons.is_empty() {
                excluded.push(ExcludedRoute {
                    provider_id: route.provider_id,
                    model_id: route.model_id,
                    reasons: hard_reasons,
                });
                continue;
            }

            recommendations.push(score_route(input.role, &input.assessment, route, generated_at));
        }

        recommendations.sort_by(|left, right| {
            right
                .user_override
                .cmp(&left.user_override)
                .then_with(|| right.score.total_cmp(&left.score))
                .then_with(|| left.provider_id.cmp(&right.provider_id))
                .then_with(|| left.model_id.cmp(&right.model_id))
        });
        excluded.sort_by(|left, right| {
            left.provider_id
                .cmp(&right.provider_id)
                .then_with(|| left.model_id.cmp(&right.model_id))
        });

        let recommendation = recommendations.first().cloned();
        let alternatives = recommendations.into_iter().skip(1).take(3).collect::<Vec<_>>();
        let confidence = recommendation
            .as_ref()
            .map(|recommendation| recommendation.confidence)
            .unwrap_or(EvidenceConfidence::Low);
        RoleExecutionAdvice {
            role: input.role,
            recommendation,
            alternatives,
            excluded,
            confidence,
            generated_at,
        }
    }

    fn resolve_assessment(
        plan_id: Option<&str>,
        idea_id: Option<&str>,
    ) -> DbResult<(ImplementationAssessment, Option<u32>, String, bool)> {
        if let Some(plan_id) = plan_id {
            let plan = PlanService::get(plan_id)?.ok_or_else(|| "Plan not found".to_string())?;
            if let Some(assessment) = plan.assessment {
                return Ok((
                    assessment.implementation,
                    Some(assessment.expected_context_tokens),
                    "plan_assessment".to_string(),
                    assessment.stale,
                ));
            }
            if let Some(idea_id) = plan.idea_id.as_deref() {
                if let Some(idea) = SessionService::get_idea(idea_id)? {
                    if let Some(assessment) = idea.assessment {
                        return Ok((assessment, None, "source_idea_assessment".to_string(), false));
                    }
                }
            }
            return Err("This plan does not have a structured implementation assessment yet".to_string());
        }
        if let Some(idea_id) = idea_id {
            let idea = SessionService::get_idea(idea_id)?.ok_or_else(|| "Idea not found".to_string())?;
            return idea
                .assessment
                .map(|assessment| (assessment, None, "idea_assessment".to_string(), false))
                .ok_or_else(|| "This legacy idea does not have a structured implementation assessment".to_string());
        }
        Err("planId or ideaId is required".to_string())
    }

    fn build_input(
        project_path: &str,
        role: ExecutionRole,
        assessment: &ImplementationAssessment,
        expected_context_tokens: Option<u32>,
    ) -> DbResult<ExecutionAdvisorInput> {
        let catalog = ProviderModelCatalogService::catalog();
        let blocked = load_blocked_providers()?;
        let profiles = load_profiles()?;
        let override_route = load_override(project_path, role)?;
        let selected = NativeChatService::resolve_model_default(project_path).ok();
        let omp = OmpTelemetryService::snapshot();
        let latest_native = load_latest_native_metrics()?;
        let omp_remaining = omp
            .windows
            .iter()
            .map(|window| window.remaining_fraction)
            .filter(|value| value.is_finite())
            .reduce(f64::min);
        let mut account_capacity = HashMap::<String, CapacityEvidence>::new();
        if let Some((usage, fetched_at, cache_error)) = sync_service::cached_projected_usage()? {
            for row in usage.live.rows {
                if !row.remaining_fraction.is_finite() {
                    continue;
                }
                let evidence = account_capacity
                    .entry(row.provider.clone())
                    .or_insert_with(|| CapacityEvidence {
                        provider_id: row.provider.clone(),
                        remaining_fraction: Some(row.remaining_fraction),
                        observed_at: Some(usage.assembled_at.max(fetched_at)),
                        source: "account_cache".to_string(),
                        stale: cache_error.is_some()
                            || row.is_stale
                            || now_seconds().saturating_sub(fetched_at) > CAPACITY_STALE_SECONDS,
                    });
                evidence.remaining_fraction = evidence
                    .remaining_fraction
                    .map(|remaining| remaining.min(row.remaining_fraction));
                evidence.stale |= row.is_stale;
            }
        }

        let providers = catalog
            .providers
            .iter()
            .map(|provider| (provider.id.as_str(), provider))
            .collect::<HashMap<_, _>>();
        let now = now_seconds();
        let routes = catalog
            .models
            .into_iter()
            .map(|model| {
                let provider = providers.get(model.provider_id.as_str());
                let matched_profile = match_profile(&profiles, &model.provider_id, &model.id, model.model_api_id.as_deref());
                let capacity = if omp.provider.as_deref() == Some(model.provider_id.as_str()) {
                    Some(CapacityEvidence {
                        provider_id: model.provider_id.clone(),
                        remaining_fraction: omp_remaining,
                        observed_at: Some(omp.assembled_at),
                        source: "omp_live".to_string(),
                        stale: now.saturating_sub(omp.assembled_at) > CAPACITY_STALE_SECONDS
                            || omp.windows.iter().any(|window| window.is_stale),
                    })
                } else if let Some(account) = account_capacity.get(&model.provider_id) {
                    Some(account.clone())
                } else {
                    latest_native
                        .get(&(model.provider_id.clone(), model.id.clone()))
                        .copied()
                        .map(|observed_at| CapacityEvidence {
                            provider_id: model.provider_id.clone(),
                            remaining_fraction: None,
                            observed_at: Some(observed_at),
                            source: "native_metrics".to_string(),
                            stale: now.saturating_sub(observed_at) > PROFILE_STALE_SECONDS,
                        })
                };
                let (profile, profile_cached_at, profile_error) = matched_profile
                    .map(|cached| (Some(cached.profile.clone()), Some(cached.fetched_at), cached.error.clone()))
                    .unwrap_or((None, None, None));
                ExecutionRouteCandidate {
                    connected: provider.is_some_and(|provider| provider.configured || provider.local_only),
                    blocked: blocked.contains(&model.provider_id),
                    supports_tools: model.supports_tools,
                    supports_reasoning: model.supports_reasoning,
                    supports_images: model.supports_images,
                    supported_efforts: model.supported_efforts,
                    context_window: model.context_window,
                    input_price: model.cost_input,
                    output_price: model.cost_output,
                    profile,
                    profile_cached_at,
                    profile_error,
                    capacity,
                    selected: selected.as_ref().is_some_and(|selected| {
                        selected.provider_id == model.provider_id && selected.model_id == model.id
                    }),
                    user_override: override_route.as_ref().is_some_and(|(provider_id, model_id)| {
                        provider_id == &model.provider_id && model_id == &model.id
                    }),
                    provider_id: model.provider_id,
                    model_id: model.id,
                    label: model.label,
                }
            })
            .collect();

        Ok(ExecutionAdvisorInput {
            role,
            assessment: assessment.clone(),
            expected_context_tokens,
            routes,
        })
    }
}

fn score_route(
    role: ExecutionRole,
    assessment: &ImplementationAssessment,
    route: ExecutionRouteCandidate,
    now: i64,
) -> RouteRecommendation {
    let mut factors = Vec::new();
    let mut reasons = Vec::new();
    let mut source_freshness = Vec::new();

    let primary_kind = match role {
        ExecutionRole::Planner => ExecutionSignalKind::Reasoning,
        ExecutionRole::Coder => ExecutionSignalKind::Coding,
    };
    let quality_value = route
        .profile
        .as_ref()
        .and_then(|profile| profile.signal(primary_kind))
        .and_then(|signal| signal.normalized_value)
        .or_else(|| {
            route
                .profile
                .as_ref()
                .and_then(|profile| profile.signal(ExecutionSignalKind::Intelligence))
                .and_then(|signal| signal.normalized_value)
        });
    let quality_score = quality_value.map_or(12.0, |value| value * 45.0);
    factors.push(AdviceFactor {
        name: "quality_fit".to_string(),
        score: quality_score,
        max_score: 45.0,
        explanation: quality_value.map_or_else(
            || "No comparable public quality signal; using a conservative capability fallback".to_string(),
            |value| format!("Public role-fit evidence scores {:.0}%", value * 100.0),
        ),
    });

    let agentic_value = route
        .profile
        .as_ref()
        .and_then(|profile| profile.signal(ExecutionSignalKind::Agentic))
        .and_then(|signal| signal.normalized_value);
    let agentic_score = agentic_value.map_or(5.0, |value| value * 15.0);
    factors.push(AdviceFactor {
        name: "agentic_fit".to_string(),
        score: agentic_score,
        max_score: 15.0,
        explanation: agentic_value.map_or_else(
            || "Agentic benchmark unavailable".to_string(),
            |value| format!("Public agentic evidence scores {:.0}%", value * 100.0),
        ),
    });

    let capability_score = 10.0 + if route.supports_reasoning { 5.0 } else { 0.0 };
    factors.push(AdviceFactor {
        name: "capabilities".to_string(),
        score: capability_score,
        max_score: 15.0,
        explanation: if route.supports_reasoning {
            "Tool and reasoning support match the assessed work".to_string()
        } else {
            "Tool support matches; extended reasoning is unavailable".to_string()
        },
    });

    let capacity_value = route
        .capacity
        .as_ref()
        .and_then(|capacity| capacity.remaining_fraction)
        .filter(|_| !route.capacity.as_ref().is_some_and(|capacity| capacity.stale));
    let capacity_score = capacity_value.map_or(5.0, |value| value.clamp(0.0, 1.0) * 15.0);
    factors.push(AdviceFactor {
        name: "capacity".to_string(),
        score: capacity_score,
        max_score: 15.0,
        explanation: capacity_value.map_or_else(
            || "Fresh remaining-capacity evidence is unavailable".to_string(),
            |value| format!("Local telemetry reports {:.0}% remaining", value * 100.0),
        ),
    });

    let output_price = route
        .output_price
        .or_else(|| route.profile.as_ref()?.economics.as_ref()?.output_price);
    let economics_score = output_price.map_or(2.0, |price| 5.0 / (1.0 + price / 20.0));
    factors.push(AdviceFactor {
        name: "economics".to_string(),
        score: economics_score,
        max_score: 5.0,
        explanation: output_price.map_or_else(
            || "Comparable price evidence is unavailable".to_string(),
            |price| format!("Published output price signal: ${price:.2}"),
        ),
    });

    let speed_value = route
        .profile
        .as_ref()
        .and_then(|profile| profile.signal(ExecutionSignalKind::OutputSpeed))
        .and_then(|signal| signal.normalized_value);
    let speed_score = speed_value.map_or(2.0, |value| value * 5.0);
    factors.push(AdviceFactor {
        name: "speed".to_string(),
        score: speed_score,
        max_score: 5.0,
        explanation: speed_value.map_or_else(
            || "Comparable output-speed evidence is unavailable".to_string(),
            |value| format!("Public speed evidence scores {:.0}%", value * 100.0),
        ),
    });

    let selected_score = if route.selected { 2.0 } else { 0.0 };
    factors.push(AdviceFactor {
        name: "current_selection".to_string(),
        score: selected_score,
        max_score: 2.0,
        explanation: if route.selected {
            "This is the current project route".to_string()
        } else {
            "This route is available but not currently selected".to_string()
        },
    });

    let mut score = factors.iter().map(|factor| factor.score).sum::<f64>();
    if route.user_override {
        score += 1_000.0;
        reasons.push("Explicit user override".to_string());
    }
    if assessment.difficulty >= 4 && route.supports_reasoning {
        reasons.push("Reasoning support fits the high difficulty rating".to_string());
    }
    if let Some(profile_cached_at) = route.profile_cached_at {
        let age = now.saturating_sub(profile_cached_at);
        source_freshness.push(format!("public_profile_age_seconds:{age}"));
    } else {
        source_freshness.push("public_profile:missing".to_string());
    }
    if route.profile_error.is_some() {
        source_freshness.push("public_profile_refresh:last_good_after_error".to_string());
    }
    if let Some(capacity) = &route.capacity {
        source_freshness.push(format!(
            "capacity:{}:{}",
            capacity.source,
            if capacity.stale { "stale" } else { "fresh" }
        ));
    } else {
        source_freshness.push("capacity:missing".to_string());
    }

    let high_confidence_signals = route
        .profile
        .as_ref()
        .map(|profile| {
            profile
                .signals
                .iter()
                .filter(|signal| signal.confidence == EvidenceConfidence::High && signal.normalized_value.is_some())
                .count()
        })
        .unwrap_or_default();
    let confidence = if high_confidence_signals >= 2
        && route.capacity.as_ref().is_some_and(|capacity| !capacity.stale)
    {
        EvidenceConfidence::High
    } else if route.profile.is_some() {
        EvidenceConfidence::Medium
    } else {
        EvidenceConfidence::Low
    };

    RouteRecommendation {
        provider_id: route.provider_id,
        model_id: route.model_id,
        label: route.label,
        score: (score * 10.0).round() / 10.0,
        confidence,
        factors,
        reasons,
        source_freshness,
        user_override: route.user_override,
    }
}

fn load_profiles() -> DbResult<Vec<CachedProfile>> {
    let conn = StorageService::connect()?;
    let mut statement = conn
        .prepare(
            "SELECT profile_json, fetched_at, error
             FROM model_execution_profile_cache
             ORDER BY canonical_model_id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    let mut profiles = Vec::new();
    for row in rows {
        let (profile_json, fetched_at, error) = row.map_err(|error| error.to_string())?;
        let Ok(profile) = serde_json::from_str::<ModelExecutionProfileV1>(&profile_json) else {
            continue;
        };
        if profile.validate().is_ok() {
            profiles.push(CachedProfile {
                profile,
                fetched_at,
                error,
            });
        }
    }
    Ok(profiles)
}

fn match_profile<'a>(
    profiles: &'a [CachedProfile],
    provider_id: &str,
    model_id: &str,
    api_id: Option<&str>,
) -> Option<&'a CachedProfile> {
    profiles.iter().find(|cached| {
        cached.profile.routes.iter().any(|route| {
            route.provider_slug == provider_id
                && (route.model_slug == model_id
                    || api_id.is_some_and(|api_id| route.api_id == api_id))
        })
    })
}

fn load_blocked_providers() -> DbResult<HashSet<String>> {
    let conn = StorageService::connect()?;
    let mut statement = conn
        .prepare("SELECT provider_id FROM native_blocked_providers")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|error| error.to_string())
}

fn load_latest_native_metrics() -> DbResult<HashMap<(String, String), i64>> {
    let conn = StorageService::connect()?;
    let mut statement = conn
        .prepare(
            "SELECT provider_id, model_id, MAX(created_at)
             FROM native_request_metrics
             GROUP BY provider_id, model_id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                (row.get::<_, String>(0)?, row.get::<_, String>(1)?),
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<HashMap<_, _>, _>>()
        .map_err(|error| error.to_string())
}

fn load_override(project_path: &str, role: ExecutionRole) -> DbResult<Option<(String, String)>> {
    let conn = StorageService::connect()?;
    conn.query_row(
        "SELECT provider_id, model_id
         FROM execution_advisor_overrides
         WHERE project_path = ?1 AND role = ?2",
        params![project_path, role.as_str()],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn validate_route_id(name: &str, value: &str) -> DbResult<()> {
    if value.is_empty()
        || value.len() > 240
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._/@:-".contains(&byte))
    {
        return Err(format!("{name} must be a bounded provider/model identifier"));
    }
    Ok(())
}

fn now_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        execution_advisor::{ModelExecutionCapabilitiesV1, ModelExecutionRouteV1},
        planning_assessment::EffortRange,
    };

    fn assessment() -> ImplementationAssessment {
        ImplementationAssessment {
            schema_version: 1,
            effort: EffortRange {
                min_hours: 4,
                max_hours: 8,
            },
            difficulty: 4,
            impact: 4,
            risk: 3,
            confidence: 4,
            rationale: "A bounded cross-service implementation.".to_string(),
            grounding: vec!["src/service.rs".to_string()],
            required_capabilities: vec!["tools".to_string()],
            constraints: vec![],
            missing_evidence: vec![],
            alternatives: vec![],
        }
    }

    fn candidate(provider: &str, model: &str, score: Option<f64>) -> ExecutionRouteCandidate {
        let profile = score.map(|score| ModelExecutionProfileV1 {
            schema_version: 1,
            canonical_model_id: model.to_string(),
            provider_family: provider.to_string(),
            display_name: model.to_string(),
            routes: vec![ModelExecutionRouteV1 {
                provider_slug: provider.to_string(),
                model_slug: model.to_string(),
                api_id: model.to_string(),
            }],
            capabilities: ModelExecutionCapabilitiesV1 {
                tools: true,
                reasoning: true,
                structured_output: true,
                images: false,
                context_limit: Some(200_000),
                output_limit: Some(32_000),
            },
            signals: vec![crate::models::execution_advisor::ModelExecutionSignalV1 {
                kind: ExecutionSignalKind::Coding,
                normalized_value: Some(score),
                raw_value: Some(score * 100.0),
                unit: "index".to_string(),
                source_name: "Public benchmark".to_string(),
                source_url: "https://basebuild.net/methodology".to_string(),
                measured_at: None,
                fetched_at: "2026-07-16T00:00:00Z".to_string(),
                confidence: EvidenceConfidence::High,
            }],
            economics: None,
            fetched_at: "2026-07-16T00:00:00Z".to_string(),
        });
        ExecutionRouteCandidate {
            provider_id: provider.to_string(),
            model_id: model.to_string(),
            label: model.to_string(),
            connected: true,
            blocked: false,
            supports_tools: true,
            supports_reasoning: true,
            supports_images: false,
            supported_efforts: vec!["high".to_string()],
            context_window: Some(200_000),
            input_price: None,
            output_price: None,
            profile,
            profile_cached_at: Some(now_seconds()),
            profile_error: None,
            capacity: Some(CapacityEvidence {
                provider_id: provider.to_string(),
                remaining_fraction: Some(0.75),
                observed_at: Some(now_seconds()),
                source: "test".to_string(),
                stale: false,
            }),
            selected: false,
            user_override: false,
        }
    }

    #[test]
    fn unavailable_best_model_is_excluded() {
        let mut unavailable = candidate("provider-a", "best", Some(1.0));
        unavailable.connected = false;
        let advice = ExecutionAdvisorService::rank(ExecutionAdvisorInput {
            role: ExecutionRole::Coder,
            assessment: assessment(),
            expected_context_tokens: Some(10_000),
            routes: vec![unavailable, candidate("provider-b", "available", Some(0.7))],
        });
        assert_eq!(advice.recommendation.unwrap().model_id, "available");
        assert!(advice.excluded[0].reasons[0].contains("not connected"));
    }

    #[test]
    fn insufficient_context_and_low_capacity_are_hard_gates() {
        let mut short = candidate("provider-a", "short", Some(1.0));
        short.context_window = Some(1_000);
        let mut depleted = candidate("provider-b", "depleted", Some(0.9));
        depleted.capacity.as_mut().unwrap().remaining_fraction = Some(0.01);
        let advice = ExecutionAdvisorService::rank(ExecutionAdvisorInput {
            role: ExecutionRole::Coder,
            assessment: assessment(),
            expected_context_tokens: Some(10_000),
            routes: vec![short, depleted],
        });
        assert!(advice.recommendation.is_none());
        assert_eq!(advice.excluded.len(), 2);
    }

    #[test]
    fn explicit_compatible_override_wins_and_missing_evidence_lowers_confidence() {
        let mut override_route = candidate("provider-a", "manual", None);
        override_route.user_override = true;
        override_route.capacity = None;
        let advice = ExecutionAdvisorService::rank(ExecutionAdvisorInput {
            role: ExecutionRole::Coder,
            assessment: assessment(),
            expected_context_tokens: None,
            routes: vec![candidate("provider-b", "benchmarked", Some(1.0)), override_route],
        });
        let recommendation = advice.recommendation.unwrap();
        assert_eq!(recommendation.model_id, "manual");
        assert_eq!(recommendation.confidence, EvidenceConfidence::Low);
        assert!(recommendation.user_override);
    }

    #[test]
    fn stale_capacity_does_not_exclude_and_offline_profile_remains_usable() {
        let mut route = candidate("provider-a", "cached", Some(0.8));
        let capacity = route.capacity.as_mut().unwrap();
        capacity.remaining_fraction = Some(0.01);
        capacity.stale = true;
        route.profile_error = Some("offline".to_string());
        let advice = ExecutionAdvisorService::rank(ExecutionAdvisorInput {
            role: ExecutionRole::Coder,
            assessment: assessment(),
            expected_context_tokens: None,
            routes: vec![route],
        });
        let recommendation = advice.recommendation.unwrap();
        assert_eq!(recommendation.model_id, "cached");
        assert!(recommendation
            .source_freshness
            .iter()
            .any(|source| source.contains("last_good_after_error")));
    }

    #[test]
    fn tool_incompatible_route_is_excluded() {
        let mut route = candidate("provider-a", "no-tools", Some(1.0));
        route.supports_tools = false;
        let advice = ExecutionAdvisorService::rank(ExecutionAdvisorInput {
            role: ExecutionRole::Coder,
            assessment: assessment(),
            expected_context_tokens: None,
            routes: vec![route],
        });
        assert!(advice.recommendation.is_none());
        assert!(advice.excluded[0].reasons[0].contains("tool calls"));
    }

    #[test]
    fn tied_candidates_have_deterministic_route_order() {
        let advice = ExecutionAdvisorService::rank(ExecutionAdvisorInput {
            role: ExecutionRole::Coder,
            assessment: assessment(),
            expected_context_tokens: None,
            routes: vec![
                candidate("provider-b", "same", Some(0.8)),
                candidate("provider-a", "same", Some(0.8)),
            ],
        });
        assert_eq!(advice.recommendation.unwrap().provider_id, "provider-a");
    }
}
