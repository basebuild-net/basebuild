//! What goes into a model's context window: token estimation, project context
//! files (AGENTS.md / CLAUDE.md), the compaction boundary and transcript, and
//! the plan-mode notice. Pure helpers here; persistence lives in
//! `native_chat_service`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Per-file cap for a context file injected into the system prompt.
pub const MAX_CONTEXT_FILE_BYTES: usize = 32 * 1024;
/// Total cap across every injected context file.
pub const MAX_CONTEXT_TOTAL_BYTES: usize = 96 * 1024;

/// Instruction appended to the system prompt while a session is in plan mode.
pub const PLAN_MODE_NOTICE: &str = "# Plan mode\n\
This session is in plan mode. Investigate with read-only tools (read_file, list_files, search_files, read_skill, list_skills, project_status, get_execution_advice, web_fetch, todo_write) and do NOT change the project. File writes and shell commands are refused by the harness until the user approves the plan. Produce a concrete, numbered plan with the files and steps you would change, state open questions, and stop. The user will approve the plan to start implementation.";

/// System prompt for the compaction summarization call.
pub const COMPACTION_SYSTEM_PROMPT: &str = "You compress a coding-assistant chat transcript into a faithful working summary. Keep: the user's goals and constraints, decisions made, files and symbols touched, commands run and their outcomes, open questions, and the exact next step. Drop pleasantries and repeated content. Write plain Markdown with short sections. Do not invent facts that are not in the transcript.";

/// Upper bound for the transcript sent to the summarizer.
pub const MAX_COMPACTION_TRANSCRIPT_CHARS: usize = 60_000;
/// Per-message cap inside the compaction transcript.
const MAX_COMPACTION_MESSAGE_CHARS: usize = 4_000;

/// Estimate the token count of `text`.
///
/// ASCII text averages about four characters per token. CJK ideographs, kana,
/// and hangul usually cost about one token per character, and other non-ASCII
/// scripts sit between those two. The old whitespace word count under-counted
/// CJK badly (a 500-character Chinese message counted as one token), which made
/// the context budget and the context circle lie.
pub fn estimate_tokens(text: &str) -> i64 {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return 0;
    }
    let mut ascii = 0i64;
    let mut cjk = 0i64;
    let mut other = 0i64;
    for ch in trimmed.chars() {
        if ch.is_ascii() {
            ascii += 1;
        } else if is_cjk(ch) {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    (ascii + 3) / 4 + cjk + (other + 1) / 2
}

fn is_cjk(ch: char) -> bool {
    matches!(ch as u32,
        0x1100..=0x11FF      // Hangul Jamo
        | 0x2E80..=0x2FFF    // CJK radicals
        | 0x3000..=0x303F    // CJK punctuation
        | 0x3040..=0x30FF    // Hiragana and katakana
        | 0x3130..=0x318F    // Hangul compatibility jamo
        | 0x3400..=0x4DBF    // CJK extension A
        | 0x4E00..=0x9FFF    // CJK unified ideographs
        | 0xAC00..=0xD7AF    // Hangul syllables
        | 0xF900..=0xFAFF    // CJK compatibility ideographs
        | 0xFF00..=0xFFEF    // Halfwidth and fullwidth forms
        | 0x20000..=0x2FA1F  // CJK extensions B through F and compatibility
    )
}

/// One project or global instruction file injected into the system prompt.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContextFile {
    /// Display label. Global files use `~/.basebuild/AGENTS.md`; project files
    /// use their bare file name so absolute paths never reach the UI.
    pub label: String,
    /// `global` for `~/.basebuild/AGENTS.md`, otherwise `project`.
    pub scope: String,
    /// Bytes of content injected after truncation.
    pub bytes: usize,
    pub truncated: bool,
    #[serde(skip)]
    pub content: String,
}

/// Discover context files for a project: `~/.basebuild/AGENTS.md`, then
/// `AGENTS.md` and `CLAUDE.md` in the project root. Files are deduplicated by
/// canonical path and by identical content, then capped per file and in total.
pub fn load_context_files(project_path: &str) -> Vec<ContextFile> {
    let project = Path::new(project_path);
    let mut candidates: Vec<(String, String, PathBuf)> = Vec::new();
    if let Some(home) = home_dir() {
        candidates.push((
            "~/.basebuild/AGENTS.md".to_string(),
            "global".to_string(),
            home.join(".basebuild").join("AGENTS.md"),
        ));
    }
    for name in ["AGENTS.md", "CLAUDE.md"] {
        candidates.push((name.to_string(), "project".to_string(), project.join(name)));
    }
    collect_context_files(candidates)
}

fn collect_context_files(candidates: Vec<(String, String, PathBuf)>) -> Vec<ContextFile> {
    let mut files = Vec::new();
    let mut seen_paths: HashSet<PathBuf> = HashSet::new();
    let mut seen_content: HashSet<String> = HashSet::new();
    let mut remaining = MAX_CONTEXT_TOTAL_BYTES;
    for (label, scope, path) in candidates {
        if remaining == 0 {
            break;
        }
        let Ok(raw) = std::fs::read(&path) else {
            continue;
        };
        let canonical = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        if !seen_paths.insert(canonical) {
            continue;
        }
        let Ok(text) = String::from_utf8(raw) else {
            continue;
        };
        let text = text.trim().to_string();
        if text.is_empty() || !seen_content.insert(text.clone()) {
            continue;
        }
        let cap = MAX_CONTEXT_FILE_BYTES.min(remaining);
        let (content, truncated) = truncate_at_char_boundary(&text, cap);
        remaining = remaining.saturating_sub(content.len());
        files.push(ContextFile {
            label,
            scope,
            bytes: content.len(),
            truncated,
            content,
        });
    }
    files
}

fn truncate_at_char_boundary(text: &str, max_bytes: usize) -> (String, bool) {
    if text.len() <= max_bytes {
        return (text.to_string(), false);
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_string(), true)
}

/// Render context files as a system-prompt section. Empty when there are none.
pub fn render_context_block(files: &[ContextFile]) -> String {
    if files.is_empty() {
        return String::new();
    }
    let mut out = String::from(
        "# Project context files\nThe following instruction files apply to this workspace. Follow them unless the user says otherwise.\n",
    );
    for file in files {
        out.push_str(&format!("\n## {} ({})\n", file.label, file.scope));
        out.push_str(&file.content);
        if file.truncated {
            out.push_str("\n[truncated]");
        }
        out.push('\n');
    }
    out
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Choose where a compaction cut lands. `roles` is the persisted transcript in
/// order. The cut always lands on a `user` row, so the kept suffix starts at a
/// fresh human turn and never separates an assistant tool call from its
/// result. Returns the index of the first kept row, or `None` when there are
/// not more than `keep_user_turns` user turns to fold away.
pub fn compaction_boundary(roles: &[&str], keep_user_turns: usize) -> Option<usize> {
    let user_indices: Vec<usize> = roles
        .iter()
        .enumerate()
        .filter(|(_, role)| **role == "user")
        .map(|(index, _)| index)
        .collect();
    if keep_user_turns == 0 || user_indices.len() <= keep_user_turns {
        return None;
    }
    let boundary = user_indices[user_indices.len() - keep_user_turns];
    // Nothing before the boundary means nothing to fold.
    (boundary > 0).then_some(boundary)
}

/// Fraction of the context budget above which the active history is compacted
/// before a request.
pub const AUTO_COMPACT_THRESHOLD: f64 = 0.8;

/// Compact before a request when the estimated prompt exceeds the threshold and
/// a compaction boundary exists. A budget of zero or less never triggers.
pub fn should_auto_compact(estimate: i64, budget: i64, has_boundary: bool) -> bool {
    has_boundary && budget > 0 && (estimate as f64) > (budget as f64) * AUTO_COMPACT_THRESHOLD
}

/// Render `(role, content)` rows as a compaction transcript. Each message is
/// capped, and the whole transcript stops at `MAX_COMPACTION_TRANSCRIPT_CHARS`
/// with an explicit omission marker.
pub fn render_compaction_transcript(rows: &[(&str, &str)]) -> String {
    let mut out = String::new();
    for (role, content) in rows {
        let label = match *role {
            "user" => "User",
            "assistant" => "Assistant",
            other => other,
        };
        let body: String = content.trim().chars().take(MAX_COMPACTION_MESSAGE_CHARS).collect();
        if body.is_empty() {
            continue;
        }
        let entry = format!("{label}: {body}\n\n");
        if out.chars().count() + entry.chars().count() > MAX_COMPACTION_TRANSCRIPT_CHARS {
            out.push_str("[earlier messages omitted to fit the summarizer]\n");
            break;
        }
        out.push_str(&entry);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_tokens_counts_ascii_by_quarter_words() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("   "), 0);
        // 11 ASCII characters -> ceil(11 / 4) = 3 tokens.
        assert_eq!(estimate_tokens("hello world"), 3);
    }

    #[test]
    fn estimate_tokens_counts_cjk_per_character() {
        // Four ideographs -> four tokens, not one word.
        assert_eq!(estimate_tokens("你好世界"), 4);
        // Kana and hangul are charged like ideographs.
        assert_eq!(estimate_tokens("カタカナ"), 4);
        assert_eq!(estimate_tokens("한국어"), 3);
        // Mixed text adds the per-script costs.
        assert_eq!(estimate_tokens("你好 hello"), 2 + 2);
    }

    #[test]
    fn estimate_tokens_charges_other_scripts_between_ascii_and_cjk() {
        // Cyrillic: 6 characters at about two per token.
        assert_eq!(estimate_tokens("привет"), 3);
    }

    fn file(path: &Path, body: &str) {
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn discovers_project_agents_and_claude_files() {
        let dir = tempfile::TempDir::new().unwrap();
        file(&dir.path().join("AGENTS.md"), "Use tabs.");
        file(&dir.path().join("CLAUDE.md"), "Prefer small functions.");
        let files = collect_context_files(vec![
            ("AGENTS.md".into(), "project".into(), dir.path().join("AGENTS.md")),
            ("CLAUDE.md".into(), "project".into(), dir.path().join("CLAUDE.md")),
        ]);
        let labels: Vec<&str> = files.iter().map(|f| f.label.as_str()).collect();
        assert_eq!(labels, vec!["AGENTS.md", "CLAUDE.md"]);
        assert!(!files[0].truncated);
    }

    #[test]
    fn dedupes_identical_content_and_same_canonical_path() {
        let dir = tempfile::TempDir::new().unwrap();
        file(&dir.path().join("AGENTS.md"), "Same rules.");
        file(&dir.path().join("CLAUDE.md"), "Same rules.");
        let files = collect_context_files(vec![
            ("AGENTS.md".into(), "project".into(), dir.path().join("AGENTS.md")),
            ("CLAUDE.md".into(), "project".into(), dir.path().join("CLAUDE.md")),
            ("AGENTS.md".into(), "project".into(), dir.path().join("AGENTS.md")),
        ]);
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].label, "AGENTS.md");
    }

    #[test]
    fn caps_each_file_and_the_total_on_char_boundaries() {
        let dir = tempfile::TempDir::new().unwrap();
        // Multi-byte characters force the cut to back off to a boundary.
        let big = "界".repeat(MAX_CONTEXT_FILE_BYTES);
        file(&dir.path().join("AGENTS.md"), &big);
        file(&dir.path().join("CLAUDE.md"), &"x".repeat(MAX_CONTEXT_FILE_BYTES));
        let files = collect_context_files(vec![
            ("AGENTS.md".into(), "project".into(), dir.path().join("AGENTS.md")),
            ("CLAUDE.md".into(), "project".into(), dir.path().join("CLAUDE.md")),
        ]);
        assert!(files[0].truncated);
        assert!(files[0].content.len() <= MAX_CONTEXT_FILE_BYTES);
        assert!(files[0].content.is_char_boundary(files[0].content.len()));
        let total: usize = files.iter().map(|f| f.bytes).sum();
        assert!(total <= MAX_CONTEXT_TOTAL_BYTES);
    }

    #[test]
    fn render_block_is_empty_without_files() {
        assert_eq!(render_context_block(&[]), "");
        let block = render_context_block(&[ContextFile {
            label: "AGENTS.md".into(),
            scope: "project".into(),
            bytes: 4,
            truncated: false,
            content: "Rule".into(),
        }]);
        assert!(block.contains("## AGENTS.md (project)"));
        assert!(block.contains("Rule"));
    }

    #[test]
    fn compaction_boundary_lands_on_a_user_row() {
        let roles = ["user", "assistant", "user", "assistant", "user", "assistant"];
        assert_eq!(compaction_boundary(&roles, 1), Some(4));
        assert_eq!(compaction_boundary(&roles, 2), Some(2));
        // Three user turns cannot fold anything away when all three are kept.
        assert_eq!(compaction_boundary(&roles, 3), None);
        assert_eq!(compaction_boundary(&roles, 0), None);
    }

    #[test]
    fn compaction_boundary_never_splits_tool_call_from_result() {
        // user -> assistant(tool call) -> tool result -> assistant -> user -> assistant
        let roles = ["user", "assistant", "tool", "assistant", "user", "assistant"];
        let boundary = compaction_boundary(&roles, 1).unwrap();
        assert_eq!(roles[boundary], "user");
        // Folded prefix keeps the whole tool exchange together.
        assert!(roles[..boundary].contains(&"tool"));
        assert!(!roles[boundary..].contains(&"tool"));
    }

    #[test]
    fn compaction_transcript_caps_messages_and_total() {
        let long = "a".repeat(MAX_COMPACTION_MESSAGE_CHARS * 2);
        let rows = vec![("user", long.as_str()), ("assistant", "ok")];
        let transcript = render_compaction_transcript(&rows);
        assert!(transcript.starts_with("User: "));
        assert!(transcript.contains("Assistant: ok"));
        assert!(transcript.chars().count() < MAX_COMPACTION_MESSAGE_CHARS + 200);

        let many: Vec<(&str, String)> = (0..40)
            .map(|_| ("user", "b".repeat(4_000)))
            .collect();
        let refs: Vec<(&str, &str)> = many.iter().map(|(r, c)| (*r, c.as_str())).collect();
        let capped = render_compaction_transcript(&refs);
        assert!(capped.chars().count() <= MAX_COMPACTION_TRANSCRIPT_CHARS + 80);
        assert!(capped.contains("[earlier messages omitted"));
    }

    #[test]
    fn auto_compact_triggers_only_above_threshold_with_boundary() {
        assert!(should_auto_compact(8_001, 10_000, true));
        assert!(!should_auto_compact(8_000, 10_000, true));
        assert!(!should_auto_compact(9_000, 10_000, false));
        assert!(!should_auto_compact(9_000, 0, true));
    }
}
