use serde::{Deserialize, Serialize};

pub const ASSESSMENT_SCHEMA_VERSION: u8 = 1;
const MAX_EFFORT_HOURS: u16 = 10_000;
const MAX_TEXT_CHARS: usize = 4_000;
const MAX_LIST_ITEMS: usize = 32;
const MAX_CONTEXT_TOKENS: u32 = 2_000_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffortRange {
    pub min_hours: u16,
    pub max_hours: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImplementationAssessment {
    pub schema_version: u8,
    pub effort: EffortRange,
    pub difficulty: u8,
    pub impact: u8,
    pub risk: u8,
    pub confidence: u8,
    pub rationale: String,
    #[serde(default, deserialize_with = "string_or_list")]
    pub grounding: Vec<String>,
    #[serde(default, deserialize_with = "string_or_list")]
    pub required_capabilities: Vec<String>,
    #[serde(default, deserialize_with = "string_or_list")]
    pub constraints: Vec<String>,
    #[serde(default, deserialize_with = "string_or_list")]
    pub missing_evidence: Vec<String>,
    #[serde(default, deserialize_with = "string_or_list")]
    pub alternatives: Vec<String>,
}

/// Accept a JSON array of strings OR a single string (wrapped into a
/// one-element list). Models routinely flatten list fields into prose even
/// when the prompt asks for arrays; a type mismatch here failed whole
/// generate_openspec runs after every artifact was already written.
fn string_or_list<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrList {
        One(String),
        Many(Vec<String>),
    }
    Ok(match StringOrList::deserialize(deserializer)? {
        StringOrList::One(value) => vec![value],
        StringOrList::Many(values) => values,
    })
}

impl ImplementationAssessment {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != ASSESSMENT_SCHEMA_VERSION {
            return Err(format!(
                "assessment.schemaVersion must be {ASSESSMENT_SCHEMA_VERSION}"
            ));
        }
        if self.effort.min_hours == 0 || self.effort.max_hours > MAX_EFFORT_HOURS {
            return Err(format!(
                "assessment effort must be between 1 and {MAX_EFFORT_HOURS} hours"
            ));
        }
        if self.effort.min_hours > self.effort.max_hours {
            return Err("assessment effort minHours cannot exceed maxHours".to_string());
        }
        validate_rating("difficulty", self.difficulty)?;
        validate_rating("impact", self.impact)?;
        validate_rating("risk", self.risk)?;
        validate_rating("confidence", self.confidence)?;
        if self.confidence <= 2 && self.missing_evidence.is_empty() {
            return Err(
                "assessment.missingEvidence requires at least one item when confidence is 1-2"
                    .to_string(),
            );
        }
        validate_text("rationale", &self.rationale, false)?;
        validate_list("grounding", &self.grounding, false)?;
        validate_list("requiredCapabilities", &self.required_capabilities, true)?;
        validate_list("constraints", &self.constraints, true)?;
        validate_list("missingEvidence", &self.missing_evidence, true)?;
        validate_list("alternatives", &self.alternatives, true)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParallelismGuidance {
    pub max_parallel_tasks: u8,
    pub rationale: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlanAssessment {
    pub schema_version: u8,
    pub implementation: ImplementationAssessment,
    pub artifact_fingerprint: String,
    pub source_idea_id: Option<String>,
    pub estimate_drift: String,
    pub expected_context_tokens: u32,
    pub parallelism: ParallelismGuidance,
    pub assessed_at: i64,
    pub stale: bool,
}

impl PlanAssessment {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != ASSESSMENT_SCHEMA_VERSION {
            return Err(format!(
                "plan assessment schemaVersion must be {ASSESSMENT_SCHEMA_VERSION}"
            ));
        }
        self.implementation.validate()?;
        if self.artifact_fingerprint.len() != 16
            || !self
                .artifact_fingerprint
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("plan assessment artifactFingerprint must be a 16-character hexadecimal fingerprint".to_string());
        }
        validate_text("estimateDrift", &self.estimate_drift, false)?;
        if self.expected_context_tokens == 0 || self.expected_context_tokens > MAX_CONTEXT_TOKENS {
            return Err(format!(
                "plan assessment expectedContextTokens must be between 1 and {MAX_CONTEXT_TOKENS}"
            ));
        }
        if !(1..=16).contains(&self.parallelism.max_parallel_tasks) {
            return Err(
                "plan assessment parallelism.maxParallelTasks must be between 1 and 16".to_string(),
            );
        }
        validate_text("parallelism.rationale", &self.parallelism.rationale, false)?;
        if let Some(source_idea_id) = &self.source_idea_id {
            validate_text("sourceIdeaId", source_idea_id, false)?;
        }
        Ok(())
    }
}

/// Non-cryptographic content fingerprint used only for local staleness checks.
/// FNV-1a is deterministic across processes and platforms and avoids adding a
/// hashing dependency for a value that is never used as a trust boundary.
pub fn artifact_fingerprint(parts: &[&str]) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for part in parts {
        for byte in part.as_bytes().iter().chain(std::iter::once(&0xff)) {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    format!("{hash:016x}")
}

fn validate_rating(name: &str, value: u8) -> Result<(), String> {
    if !(1..=5).contains(&value) {
        return Err(format!("assessment.{name} must be between 1 and 5"));
    }
    Ok(())
}

fn validate_text(name: &str, value: &str, allow_empty: bool) -> Result<(), String> {
    let trimmed = value.trim();
    if !allow_empty && trimmed.is_empty() {
        return Err(format!("assessment.{name} is required"));
    }
    if value.chars().count() > MAX_TEXT_CHARS {
        return Err(format!(
            "assessment.{name} must be {MAX_TEXT_CHARS} characters or fewer"
        ));
    }
    Ok(())
}

fn validate_list(name: &str, values: &[String], allow_empty: bool) -> Result<(), String> {
    if !allow_empty && values.is_empty() {
        return Err(format!("assessment.{name} requires at least one item"));
    }
    if values.len() > MAX_LIST_ITEMS {
        return Err(format!(
            "assessment.{name} must contain {MAX_LIST_ITEMS} items or fewer"
        ));
    }
    for value in values {
        validate_text(name, value, false)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_implementation() -> ImplementationAssessment {
        ImplementationAssessment {
            schema_version: ASSESSMENT_SCHEMA_VERSION,
            effort: EffortRange {
                min_hours: 4,
                max_hours: 8,
            },
            difficulty: 3,
            impact: 4,
            risk: 2,
            confidence: 4,
            rationale: "Bounded by the existing service and focused UI surface.".to_string(),
            grounding: vec!["src/service.rs::run".to_string()],
            required_capabilities: vec!["Rust".to_string()],
            constraints: vec!["No new dependencies".to_string()],
            missing_evidence: vec![],
            alternatives: vec!["Keep the current flow".to_string()],
        }
    }

    #[test]
    fn validates_bounded_implementation_assessment() {
        assert!(valid_implementation().validate().is_ok());
    }

    #[test]
    fn rejects_inverted_effort_and_out_of_range_rating() {
        let mut assessment = valid_implementation();
        assessment.effort.min_hours = 9;
        assessment.effort.max_hours = 8;
        assert!(assessment.validate().unwrap_err().contains("minHours"));

        assessment.effort.min_hours = 4;
        assessment.difficulty = 6;
        assert!(assessment.validate().unwrap_err().contains("difficulty"));
    }

    #[test]
    fn low_confidence_requires_explicit_missing_evidence() {
        let mut assessment = valid_implementation();
        assessment.confidence = 2;
        assessment.missing_evidence.clear();
        assert!(assessment
            .validate()
            .unwrap_err()
            .contains("missingEvidence"));
        assessment.missing_evidence = vec!["Runtime behavior was not observed.".to_string()];
        assert!(assessment.validate().is_ok());
    }

    #[test]
    fn fingerprint_changes_only_when_content_changes() {
        let first = artifact_fingerprint(&["proposal", "design", "tasks"]);
        let same = artifact_fingerprint(&["proposal", "design", "tasks"]);
        let changed = artifact_fingerprint(&["proposal", "changed", "tasks"]);
        assert_eq!(first, same);
        assert_ne!(first, changed);
    }

    #[test]
    fn list_fields_accept_string_or_array() {
        let json = r#"{
            "schemaVersion": 1,
            "effort": { "minHours": 4, "maxHours": 8 },
            "difficulty": 3, "impact": 3, "risk": 2, "confidence": 4,
            "rationale": "Bounded change.",
            "grounding": "Proposal names the exact component.",
            "requiredCapabilities": ["Rust"],
            "constraints": [],
            "missingEvidence": [],
            "alternatives": "Keep the current flow"
        }"#;
        let parsed: ImplementationAssessment = serde_json::from_str(json).unwrap();
        assert_eq!(
            parsed.grounding,
            vec!["Proposal names the exact component.".to_string()]
        );
        assert_eq!(
            parsed.alternatives,
            vec!["Keep the current flow".to_string()]
        );
        assert!(parsed.validate().is_ok());
    }

    #[test]
    fn omitted_list_fields_default_to_empty() {
        let json = r#"{
            "schemaVersion": 1,
            "effort": { "minHours": 4, "maxHours": 8 },
            "difficulty": 3, "impact": 3, "risk": 2, "confidence": 4,
            "rationale": "Bounded change.",
            "grounding": ["src/service.rs"]
        }"#;
        let parsed: ImplementationAssessment = serde_json::from_str(json).unwrap();
        assert!(parsed.constraints.is_empty());
        assert!(parsed.validate().is_ok());
    }
}
