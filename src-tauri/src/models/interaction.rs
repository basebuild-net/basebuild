use serde::{Deserialize, Serialize};

/// Question kind for `ask_user` interactions.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuestionKind {
    /// Single-select from a list of options.
    Options,
    /// Multi-select from a list of options.
    Multi,
    /// Confirm/deny (two buttons).
    Confirm,
    /// Free-text input.
    Text,
    /// Numeric rating over a bounded scale.
    Rating,
}

impl QuestionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            QuestionKind::Options => "options",
            QuestionKind::Multi => "multi",
            QuestionKind::Confirm => "confirm",
            QuestionKind::Text => "text",
            QuestionKind::Rating => "rating",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "multi" => QuestionKind::Multi,
            "confirm" => QuestionKind::Confirm,
            "text" => QuestionKind::Text,
            "rating" => QuestionKind::Rating,
            _ => QuestionKind::Options,
        }
    }
}

/// A single question in an `ask_user` call.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub prompt: String,
    pub kind: QuestionKind,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub options: Vec<QuestionOption>,
    /// Index into `options` of the recommended choice.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommended: Option<usize>,
    /// Allow free-text input even for `options` kind.
    #[serde(default)]
    pub allow_free_text: bool,
    /// Optional read-only preview/context shown in the card (e.g. prefilled
    /// field content the user is being asked to confirm). Not an answer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Optional page identifier. Flat legacy questions without one form a
    /// single implicit page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_description: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub multiline: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<RatingScale>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RatingScale {
    pub min: i64,
    pub max: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub low_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub high_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<RatingStyle>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RatingStyle {
    Stars,
    Numbers,
}
/// An option in a question.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionOption {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Status of a pending interaction.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum InteractionStatus {
    Pending,
    Answered,
    Cancelled,
}

impl InteractionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            InteractionStatus::Pending => "pending",
            InteractionStatus::Answered => "answered",
            InteractionStatus::Cancelled => "cancelled",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "answered" => InteractionStatus::Answered,
            "cancelled" => InteractionStatus::Cancelled,
            _ => InteractionStatus::Pending,
        }
    }
}

/// A persisted pending interaction. Created when the agent calls `ask_user`,
/// resolved when the user answers or cancels.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInteraction {
    pub id: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub questions: Vec<Question>,
    pub status: InteractionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answers: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft_answers: Option<Vec<QuestionAnswer>>,
    #[serde(default)]
    pub current_page: usize,
    pub created_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<i64>,
}

/// Answer to a single question, keyed by question id.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionAnswer {
    pub question_id: String,
    /// Selected option labels (one for `options`/`confirm`, multiple for `multi`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub selected: Vec<String>,
    /// Free-text answer (for `text` kind or `allow_free_text`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Numeric value for rating questions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<i64>,
}

/// Request to resolve a pending interaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveInteractionRequest {
    pub answers: Vec<QuestionAnswer>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn question_kind_round_trips() {
        for kind in [
            QuestionKind::Options,
            QuestionKind::Multi,
            QuestionKind::Confirm,
            QuestionKind::Text,
            QuestionKind::Rating,
        ] {
            let s = kind.as_str();
            assert_eq!(QuestionKind::from_str(s), kind);
        }
    }

    #[test]
    fn interaction_status_round_trips() {
        for status in [
            InteractionStatus::Pending,
            InteractionStatus::Answered,
            InteractionStatus::Cancelled,
        ] {
            let s = status.as_str();
            assert_eq!(InteractionStatus::from_str(s), status);
        }
    }

    #[test]
    fn question_serializes_camel_case() {
        let q = Question {
            id: "q1".into(),
            prompt: "Pick one".into(),
            kind: QuestionKind::Options,
            options: vec![QuestionOption {
                label: "A".into(),
                description: Some("Option A".into()),
            }],
            recommended: Some(0),
            allow_free_text: false,
            detail: None,
            page_id: None,
            page_title: None,
            required: false,
            page_description: None,
            multiline: false,
            scale: None,
        };
        let json = serde_json::to_string(&q).unwrap();
        assert!(json.contains("\"allowFreeText\":false"));
        assert!(!json.contains("\"questionId\""));
    }

    #[test]
    fn shared_planning_contract_fixture_is_valid_json() {
        let fixture = include_str!("../../../tests/fixtures/planning-contract-v1.json");
        let parsed: serde_json::Value = serde_json::from_str(fixture).unwrap();
        let legacy: PendingInteraction =
            serde_json::from_value(parsed["legacyInteraction"].clone()).unwrap();
        assert_eq!(legacy.questions.len(), 1);
        assert_eq!(legacy.current_page, 0);
        assert!(legacy.title.is_none());
        let current: PendingInteraction =
            serde_json::from_value(parsed["interactionV1"].clone()).unwrap();
        assert_eq!(current.questions[1].kind, QuestionKind::Rating);
        assert_eq!(current.current_page, 1);
        assert!(parsed.get("assessmentV1").is_some());
        assert!(parsed.get("modelProfilesV1").is_some());
    }
}
