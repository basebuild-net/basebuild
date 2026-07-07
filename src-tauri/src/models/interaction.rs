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
}

impl QuestionKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            QuestionKind::Options => "options",
            QuestionKind::Multi => "multi",
            QuestionKind::Confirm => "confirm",
            QuestionKind::Text => "text",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "multi" => QuestionKind::Multi,
            "confirm" => QuestionKind::Confirm,
            "text" => QuestionKind::Text,
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
    pub questions: Vec<Question>,
    pub status: InteractionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answers: Option<serde_json::Value>,
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
        };
        let json = serde_json::to_string(&q).unwrap();
        assert!(json.contains("\"allowFreeText\":false"));
        assert!(!json.contains("\"questionId\""));
    }
}
