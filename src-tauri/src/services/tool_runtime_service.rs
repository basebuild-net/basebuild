//! Core tool runtime for the native agent loop.
//!
//! Implements the six tools the model can call: `read_file`, `write_file`,
//! `edit_file`, `list_files`, `search_files`, and `run_command`. All file
//! tools are workspace-scoped: paths are canonicalized and prefix-checked
//! against the workspace root after symlink resolution, so `..` traversal
//! and symlink escapes are rejected. `run_command` executes with its cwd
//! inside the workspace. Escape attempts return an error result to the
//! model and never touch the filesystem outside the workspace.
//!
//! Tool results are structured strings the model can consume. Oversized
//! outputs are head+tail truncated with an explicit marker and the full size
//! noted; the full output is stored locally by the caller if needed.

use std::path::{Path, PathBuf};
use std::time::Instant;

use serde_json::{json, Value};

use crate::services::process_helpers::hidden_command;
use crate::services::provider_client::ToolSchema;

/// Maximum output size before head+tail truncation (128 KB).
const MAX_OUTPUT_BYTES: usize = 128 * 1024;
/// Default command timeout in seconds.
const DEFAULT_COMMAND_TIMEOUT_SECS: u64 = 120;
/// Maximum file size `read_file` returns without an explicit range (1 MB).
const MAX_READ_FILE_BYTES: u64 = 1_048_576;

/// Whether a tool reads or mutates state. Read-only calls from one response
/// run concurrently; mutating calls run sequentially in response order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolKind {
    ReadOnly,
    Mutating,
}

/// A tool the agent can call.
#[derive(Debug, Clone)]
pub struct ToolDef {
    pub schema: ToolSchema,
    pub kind: ToolKind,
    /// Execute the tool with parsed JSON arguments against the workspace root.
    /// Returns `(result_text, status)` where status is `succeeded`/`failed`/
    /// `denied`/`cancelled`.
    pub execute: fn(workspace_root: &Path, args: &Value) -> ToolResult,
}

/// The outcome of a tool execution.
#[derive(Debug, Clone)]
pub struct ToolResult {
    /// The text returned to the model. May be truncated for large outputs.
    pub content: String,
    /// `succeeded`, `failed`, `denied` (scoping rejection), or `cancelled`.
    pub status: String,
    /// Full output before truncation, when the caller wants to persist it.
    /// `None` when content was not truncated.
    pub full_content: Option<String>,
    /// Unified line diff for `edit_file`/`write_file` results, capped at
    /// 400 lines with head/tail elision. `None` for non-file tools or
    /// when content is unchanged.
    pub diff: Option<String>,
    /// How the approval decision was made: "approved", "denied", "auto",
    /// "rule". `None` for non-gateway calls (propose_ideas, ask_user).
    pub decision: Option<String>,
    /// The rule pattern that matched, if any.
    pub rule_source: Option<String>,
    /// Whether the tool touched a sensitive path and its arguments/diff
    /// should be redacted before persistence or emission.
    pub sensitive: bool,
}

impl ToolResult {
    pub fn success(content: String) -> Self {
        Self {
            content,
            status: "succeeded".to_string(),
            full_content: None,
            diff: None,
            decision: None,
            rule_source: None,
            sensitive: false,
        }
    }
    pub fn failure(content: String) -> Self {
        Self {
            content,
            status: "failed".to_string(),
            full_content: None,
            diff: None,
            decision: None,
            rule_source: None,
            sensitive: false,
        }
    }
    pub fn denied(content: String) -> Self {
        Self {
            content,
            status: "denied".to_string(),
            full_content: None,
            diff: None,
            decision: None,
            rule_source: None,
            sensitive: false,
        }
    }
}
/// Redaction marker used when a tool touches a sensitive path.
const REDACTED_ARGUMENT: &str = "[redacted: sensitive path]";

/// Recursively replace string values for keys that carry file body content
/// (`content`, `old_text`, `new_text`) with a redaction marker. Non-body
/// keys and path arguments are left untouched so audit logs still show what
/// file was touched.
fn redact_argument_value(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, val) in map.iter_mut() {
                if (key == "content" || key == "old_text" || key == "new_text") && val.is_string() {
                    *val = Value::String(REDACTED_ARGUMENT.to_string());
                } else {
                    redact_argument_value(val);
                }
            }
        }
        Value::Array(arr) => {
            for val in arr {
                redact_argument_value(val);
            }
        }
        _ => {}
    }
}

/// Redact body fields from a tool-arguments JSON string. Returns the original
/// string unchanged if it is not valid JSON.
pub fn redact_tool_arguments(arguments: &str) -> String {
    let mut value: Value = match serde_json::from_str(arguments) {
        Ok(v) => v,
        Err(_) => return arguments.to_string(),
    };
    redact_argument_value(&mut value);
    serde_json::to_string(&value).unwrap_or_else(|_| arguments.to_string())
}

/// Heuristic check for paths that commonly hold credentials or secrets.
/// Matching is case-insensitive on the resolved workspace-relative path.
fn is_sensitive_path(path: &Path) -> bool {
    let name_lower = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_lowercase());
    let ext_lower = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());
    let components: Vec<String> = path
        .components()
        .filter_map(|c| c.as_os_str().to_str().map(|s| s.to_lowercase()))
        .collect();

    // Any component is a known secret-bearing directory.
    for comp in &components {
        if comp == ".ssh" || comp == ".aws" || comp == ".gnupg" || comp == ".omp" {
            return true;
        }
    }

    if let Some(name) = name_lower {
        // .env files and private-key naming conventions.
        if name == ".env" || name.starts_with(".env.") {
            return true;
        }
        if name.starts_with("id_rsa")
            || name.starts_with("id_ed25519")
            || name.starts_with("id_ecdsa")
        {
            return true;
        }
        if name == "credentials.json" {
            return true;
        }

        // Common secret-bearing extensions.
        if let Some(ref ext) = ext_lower {
            if ext == "pem" || ext == "key" || ext == "p12" || ext == "pfx" {
                return true;
            }
        }

        // SQLite/DB files inside a dot-directory.
        if let Some(ref ext) = ext_lower {
            if ext == "sqlite" || ext == "sqlite3" || ext == "db" || ext == "db3" {
                let ancestor_dot = components
                    .iter()
                    .take(components.len().saturating_sub(1))
                    .any(|c| c.starts_with('.'));
                if ancestor_dot {
                    return true;
                }
            }
        }
    }

    false
}

/// Return the registry of all available tools with their schemas.
pub fn registry() -> Vec<ToolDef> {
    vec![
        ToolDef {
            schema: ToolSchema {
                name: "read_file".to_string(),
                description: "Read the contents of a file within the workspace. Returns line-numbered text. Use start_line/end_line to read a range of a large file.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Workspace-relative path to the file." },
                        "start_line": { "type": "integer", "description": "1-based first line to read (inclusive). Optional." },
                        "end_line": { "type": "integer", "description": "1-based last line to read (inclusive). Optional." }
                    },
                    "required": ["path"]
                }),
            },
            kind: ToolKind::ReadOnly,
            execute: read_file,
        },
        ToolDef {
            schema: ToolSchema {
                name: "write_file".to_string(),
                description: "Create or overwrite a file within the workspace with the given content.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Workspace-relative path to the file." },
                        "content": { "type": "string", "description": "The full content to write." }
                    },
                    "required": ["path", "content"]
                }),
            },
            kind: ToolKind::Mutating,
            execute: write_file,
        },
        ToolDef {
            schema: ToolSchema {
                name: "edit_file".to_string(),
                description: "Replace exact occurrences of old_text with new_text in a file. The edit is rejected if the number of occurrences does not match expected_occurrences.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Workspace-relative path to the file." },
                        "old_text": { "type": "string", "description": "The exact text to find." },
                        "new_text": { "type": "string", "description": "The replacement text." },
                        "expected_occurrences": { "type": "integer", "description": "Expected number of matches. Defaults to 1. The edit is rejected if the actual count differs.", "default": 1 }
                    },
                    "required": ["path", "old_text", "new_text"]
                }),
            },
            kind: ToolKind::Mutating,
            execute: edit_file,
        },
        ToolDef {
            schema: ToolSchema {
                name: "list_files".to_string(),
                description: "List files matching a glob pattern within the workspace. Returns relative paths.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "glob": { "type": "string", "description": "Glob pattern (e.g. \"**/*.rs\", \"src/*.ts\")." }
                    },
                    "required": ["glob"]
                }),
            },
            kind: ToolKind::ReadOnly,
            execute: list_files,
        },
        ToolDef {
            schema: ToolSchema {
                name: "search_files".to_string(),
                description: "Search file contents with a Rust regex. Returns matching lines with file paths and line numbers, workspace-scoped.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string", "description": "Rust regex pattern (RE2-style; no lookaround)." },
                        "path": { "type": "string", "description": "Optional workspace-relative subdirectory to scope the search." }
                    },
                    "required": ["pattern"]
                }),
            },
            kind: ToolKind::ReadOnly,
            execute: search_files,
        },
        ToolDef {
            schema: ToolSchema {
                name: "run_command".to_string(),
                description: "Run a shell command in the workspace cwd. Output is captured (interleaved stdout+stderr), size-capped, with a timeout. Use for builds, tests, and git operations.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "command": { "type": "string", "description": "The command line to execute." },
                        "cwd": { "type": "string", "description": "Optional workspace-relative subdirectory to run in. Defaults to workspace root." },
                        "timeout_secs": { "type": "integer", "description": "Timeout in seconds. Default 120.", "default": 120 }
                    },
                    "required": ["command"]
                }),
            },
            kind: ToolKind::Mutating,
            execute: run_command,
        },
        ToolDef {
            schema: ToolSchema {
                name: "propose_ideas".to_string(),
                description: "Capture one or more structured ideas during a generate-ideas run. Each idea must cite concrete grounding (real files, functions, or observed gaps); ideas without grounding are rejected. An optional anchor names the schematic element (Vision / End goal / Current priority) the idea serves. Call this tool with ideas as they are formed; do not emit them as prose.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "ideas": {
                            "type": "array",
                            "description": "Ideas to capture.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": { "type": "string", "description": "Plain, verb-first title of 2-5 words. No file names or implementation detail." },
                                    "description": { "type": "string", "description": "One concise sentence naming the concrete target and user-visible reason." },
                                    "grounding": { "type": "string", "description": "Concrete supporting evidence: real files, functions, or observed gaps. Keep evidence here rather than in the title. Required." },
                                    "anchor": { "type": "string", "description": "Optional schematic element served (Vision / End goal / Current priority). Omit if outside current focus." }
                                },
                                "required": ["title", "description", "grounding"]
                            }
                        },
                        "categoryId": { "type": "string", "description": "Optional category id to tag every idea in this batch with (e.g. for category-directed generation)." }
                    },
                    "required": ["ideas"]
                }),
            },
            // Intercepted by the agent loop before reaching the generic executor;
            // this execute fn is a no-op fallback that should never be called.
            kind: ToolKind::ReadOnly,
            execute: propose_ideas_fallback,
        },
        ToolDef {
            schema: ToolSchema {
                name: "ask_user".to_string(),
                description: "Present one or more questions to the user and wait for their response. Each question carries an id, a prompt, a kind (options, multi, confirm, text), an optional option list, an optional recommended-option index, an optional allow-free-text flag, and an optional `detail` preview. The user can always ALSO type a custom answer for any question, so answers may include both a selected option and free text. The loop pauses until the user responds or the run is cancelled.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "questions": {
                            "type": "array",
                            "description": "Questions to present. All render in one card; answers are returned keyed by question id.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": { "type": "string", "description": "Unique question id (used to key the answer)." },
                                    "prompt": { "type": "string", "description": "The question text shown to the user." },
                                    "kind": { "type": "string", "enum": ["options", "multi", "confirm", "text"], "description": "Question kind: single-select, multi-select, confirm/deny, or free-text." },
                                    "options": {
                                        "type": "array",
                                        "description": "Options for `options`/`multi`/`confirm` kinds. Ignored for `text`.",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "label": { "type": "string", "description": "Option label shown as a button." },
                                                "description": { "type": "string", "description": "Optional longer description shown in the button tooltip." }
                                            },
                                            "required": ["label"]
                                        }
                                    },
                                    "recommended": { "type": "integer", "description": "Index into `options` of the recommended choice. The recommended option is visibly marked." },
                                    "allowFreeText": { "type": "boolean", "description": "Deprecated hint: the UI always accepts a typed answer for every question. Kept for compatibility.", "default": false },
                                    "detail": { "type": "string", "description": "Optional read-only preview/context shown in the card (e.g. the prefilled field content the user is confirming). Use this so the user can review a value before answering. Not treated as an answer." }
                                },
                                "required": ["id", "prompt", "kind"]
                            }
                        }
                    },
                    "required": ["questions"]
                }),
            },
            // Intercepted by the agent loop before reaching the generic
            // executor; this execute fn is a no-op fallback that should
            // never be called directly.
            kind: ToolKind::ReadOnly,
            execute: ask_user_fallback,
        },
    ]
}

fn resolve_scoped(workspace_root: &Path, relative: &str) -> Result<PathBuf, String> {
    let canonical_root = workspace_root
        .canonicalize()
        .map_err(|e| format!("Workspace root not accessible: {e}"))?;
    // Normalize the relative path: resolve `..` lexically to detect escapes
    // before touching the filesystem. This catches `../../etc/passwd` even
    // when the target doesn't exist.
    let normalized = normalize_relative(relative);
    if normalized.starts_with("../") || normalized == ".." {
        return Err(format!(
            "Path '{}' resolves outside the workspace and was denied.",
            relative
        ));
    }
    let candidate = canonical_root.join(&normalized);
    // For existing paths, also verify canonicalization doesn't escape (symlinks).
    // Canonicalize the longest existing prefix to catch symlink escapes.
    if candidate.exists() {
        let canonical = match candidate.canonicalize() {
            Ok(c) => c,
            Err(e) => return Err(format!("Path not accessible: {e}")),
        };
        if !canonical.starts_with(&canonical_root) {
            return Err(format!(
                "Path '{}' resolves outside the workspace and was denied.",
                relative
            ));
        }
        Ok(canonical)
    } else {
        // For non-existent paths (write_file to new file), check the parent
        // if it exists, to catch symlink escapes on existing directories.
        if let Some(parent) = candidate.parent() {
            if parent.exists() {
                let canonical_parent = parent
                    .canonicalize()
                    .map_err(|e| format!("Path parent not accessible: {e}"))?;
                if !canonical_parent.starts_with(&canonical_root) {
                    return Err(format!(
                        "Path '{}' resolves outside the workspace and was denied.",
                        relative
                    ));
                }
            }
        }
        Ok(candidate)
    }
}

/// Lexically normalize a relative path, resolving `.` and `..` segments.
/// Returns a path that starts with `../` if it escapes the workspace root.
fn normalize_relative(relative: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    let normalized = relative.replace('\\', "/");
    for segment in normalized.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if parts.last().map(|s| *s != "..").unwrap_or(false) {
                    parts.pop();
                } else {
                    parts.push("..");
                }
            }
            s => parts.push(s),
        }
    }
    parts.join("/")
}

/// Truncate output to MAX_OUTPUT_BYTES with a head+tail + truncation marker.
fn truncate_output(content: String) -> ToolResult {
    let bytes = content.as_bytes();
    if bytes.len() <= MAX_OUTPUT_BYTES {
        return ToolResult::success(content);
    }
    let head = MAX_OUTPUT_BYTES / 2;
    let tail = MAX_OUTPUT_BYTES / 2;
    let mut truncated = String::new();
    truncated.push_str(&content[..head]);
    truncated.push_str(&format!(
        "\n\n... [truncated: full output was {} bytes; {} bytes shown] ...\n\n",
        bytes.len(),
        MAX_OUTPUT_BYTES
    ));
    truncated.push_str(&content[content.len() - tail..]);
    ToolResult {
        content: truncated,
        status: "succeeded".to_string(),
        full_content: Some(content),
        diff: None,
        decision: None,
        rule_source: None,
        sensitive: false,
    }
}

// ─── Tool implementations ───

fn read_file(workspace_root: &Path, args: &Value) -> ToolResult {
    let path = match args.get("path").and_then(Value::as_str) {
        Some(p) => p,
        None => return ToolResult::failure("Missing required parameter: path".to_string()),
    };
    let resolved = match resolve_scoped(workspace_root, path) {
        Ok(p) => p,
        Err(e) => return ToolResult::denied(e),
    };
    let content = match std::fs::read_to_string(&resolved) {
        Ok(c) => c,
        Err(e) => return ToolResult::failure(format!("Failed to read file '{path}': {e}")),
    };
    let lines: Vec<&str> = content.lines().collect();
    let start = args
        .get("start_line")
        .and_then(Value::as_i64)
        .map(|i| i.max(1) as usize)
        .unwrap_or(1);
    let end = args
        .get("end_line")
        .and_then(Value::as_i64)
        .map(|i| i as usize);
    // If a range is requested, return just that range with line numbers.
    if start > 1 || end.is_some() {
        let end = end.unwrap_or(lines.len());
        let start = start.min(lines.len());
        let end = end.min(lines.len());
        let start = start.min(end);
        let mut out = String::new();
        for (i, line) in lines.iter().enumerate() {
            let n = i + 1;
            if n >= start && n <= end {
                out.push_str(&format!("{:>6}\t{}\n", n, line));
            }
        }
        return ToolResult::success(out);
    }
    // No range: check size and truncate if needed.
    let file_size = content.len();
    if file_size > MAX_READ_FILE_BYTES as usize {
        let lines: Vec<&str> = content.lines().collect();
        let head = 200.min(lines.len());
        let mut out = format!(
            "[File is {} bytes ({} lines); showing first {} lines. Use start_line/end_line for ranges.]\n\n",
            file_size, lines.len(), head
        );
        for (i, line) in lines.iter().take(head).enumerate() {
            out.push_str(&format!("{:>6}\t{}\n", i + 1, line));
        }
        return ToolResult {
            content: out,
            status: "succeeded".to_string(),
            full_content: Some(content),
            diff: None,
            decision: None,
            rule_source: None,
            sensitive: false,
        };
    }
    // Return line-numbered content.
    let mut out = String::new();
    for (i, line) in lines.iter().enumerate() {
        out.push_str(&format!("{:>6}\t{}\n", i + 1, line));
    }
    ToolResult::success(out)
}
/// Maximum diff output lines before head+tail elision.
const MAX_DIFF_LINES: usize = 400;

/// Compute a unified line diff between `before` and `after` using a
/// simple LCS algorithm. Output is capped at `MAX_DIFF_LINES` lines with
/// head/tail elision. Returns `None` when content is unchanged.
fn compute_diff(before: &str, after: &str) -> Option<String> {
    let before_lines: Vec<&str> = before.lines().collect();
    let after_lines: Vec<&str> = after.lines().collect();

    // Short-circuit: identical content.
    if before == after {
        return None;
    }

    let n = before_lines.len();
    let m = after_lines.len();

    // LCS table (rows = before, cols = after). For large inputs this is
    // O(n*m) memory; cap at 2000 lines each to avoid pathological cases.
    if n > 2000 || m > 2000 {
        // Fallback: just show all-after as additions and all-before as deletions.
        return Some(format!(
            "Diff too large ({} → {} lines); showing summary only.\n{} lines removed, {} lines added.",
            n, m, n, m
        ));
    }

    let mut lcs = vec![vec![0u32; m + 1]; n + 1];
    for i in 1..=n {
        for j in 1..=m {
            if before_lines[i - 1] == after_lines[j - 1] {
                lcs[i][j] = lcs[i - 1][j - 1] + 1;
            } else {
                lcs[i][j] = lcs[i - 1][j].max(lcs[i][j - 1]);
            }
        }
    }

    // Backtrack to produce the unified diff.
    let mut diff_lines: Vec<String> = Vec::new();
    let mut i = n;
    let mut j = m;
    while i > 0 || j > 0 {
        if i > 0 && j > 0 && before_lines[i - 1] == after_lines[j - 1] {
            diff_lines.push(format!(" {}", before_lines[i - 1]));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || lcs[i][j - 1] >= lcs[i - 1][j]) {
            diff_lines.push(format!("+{}", after_lines[j - 1]));
            j -= 1;
        } else if i > 0 {
            diff_lines.push(format!("-{}", before_lines[i - 1]));
            i -= 1;
        }
    }
    diff_lines.reverse();

    // Cap at MAX_DIFF_LINES with head/tail elision.
    if diff_lines.len() <= MAX_DIFF_LINES {
        Some(diff_lines.join("\n"))
    } else {
        let head = MAX_DIFF_LINES / 2;
        let tail = MAX_DIFF_LINES - head;
        let omitted = diff_lines.len() - MAX_DIFF_LINES;
        let mut out: Vec<String> = diff_lines[..head].to_vec();
        out.push(format!("... ({} lines omitted) ...", omitted));
        out.extend(diff_lines[diff_lines.len() - tail..].iter().cloned());
        Some(out.join("\n"))
    }
}

fn write_file(workspace_root: &Path, args: &Value) -> ToolResult {
    let path = match args.get("path").and_then(Value::as_str) {
        Some(p) => p,
        None => return ToolResult::failure("Missing required parameter: path".to_string()),
    };
    let content = match args.get("content").and_then(Value::as_str) {
        Some(c) => c,
        None => return ToolResult::failure("Missing required parameter: content".to_string()),
    };
    let resolved = match resolve_scoped(workspace_root, path) {
        Ok(p) => p,
        Err(e) => return ToolResult::denied(e),
    };
    let sensitive = is_sensitive_path(&resolved);
    // Read existing content for diff (empty if new file). Skip the read for
    // files larger than the read cap so writing a huge file does not force an
    // equally huge in-memory pre-image.
    let oversize = std::fs::metadata(&resolved)
        .map(|m| m.len() > MAX_READ_FILE_BYTES)
        .unwrap_or(false);
    let before = if oversize {
        String::new()
    } else {
        std::fs::read_to_string(&resolved).unwrap_or_default()
    };
    // Create parent directories if needed.
    if let Some(parent) = resolved.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return ToolResult {
                    content: format!("Failed to create directories for '{path}': {e}"),
                    status: "failed".to_string(),
                    full_content: None,
                    diff: None,
                    decision: None,
                    rule_source: None,
                    sensitive,
                };
            }
        }
    }
    match std::fs::write(&resolved, content) {
        Ok(_) => {
            let diff = if sensitive || oversize {
                None
            } else {
                compute_diff(&before, content)
            };
            ToolResult {
                content: format!("Wrote {} bytes to {}", content.len(), path),
                status: "succeeded".to_string(),
                full_content: None,
                diff,
                decision: None,
                rule_source: None,
                sensitive,
            }
        }
        Err(e) => ToolResult {
            content: format!("Failed to write file '{path}': {e}"),
            status: "failed".to_string(),
            full_content: None,
            diff: None,
            decision: None,
            rule_source: None,
            sensitive,
        },
    }
}

fn edit_file(workspace_root: &Path, args: &Value) -> ToolResult {
    let path = match args.get("path").and_then(Value::as_str) {
        Some(p) => p,
        None => return ToolResult::failure("Missing required parameter: path".to_string()),
    };
    let old_text = match args.get("old_text").and_then(Value::as_str) {
        Some(t) => t,
        None => return ToolResult::failure("Missing required parameter: old_text".to_string()),
    };
    let new_text = match args.get("new_text").and_then(Value::as_str) {
        Some(t) => t,
        None => return ToolResult::failure("Missing required parameter: new_text".to_string()),
    };
    let expected = args
        .get("expected_occurrences")
        .and_then(Value::as_i64)
        .unwrap_or(1) as usize;
    let resolved = match resolve_scoped(workspace_root, path) {
        Ok(p) => p,
        Err(e) => return ToolResult::denied(e),
    };
    let sensitive = is_sensitive_path(&resolved);
    // Editing huge files would allocate unbounded memory; reject explicitly.
    if let Ok(metadata) = std::fs::metadata(&resolved) {
        if metadata.len() > MAX_READ_FILE_BYTES {
            return ToolResult {
                content: format!("File exceeds the 1 MB edit limit: {path}"),
                status: "failed".to_string(),
                full_content: None,
                diff: None,
                decision: None,
                rule_source: None,
                sensitive,
            };
        }
    }
    let content = match std::fs::read_to_string(&resolved) {
        Ok(c) => c,
        Err(e) => {
            return ToolResult {
                content: format!("Failed to read file '{path}': {e}"),
                status: "failed".to_string(),
                full_content: None,
                diff: None,
                decision: None,
                rule_source: None,
                sensitive,
            }
        }
    };
    let actual = content.matches(old_text).count();
    if actual != expected {
        return ToolResult {
            content: format!(
                "Edit rejected: expected {} occurrence(s) of old_text, found {}. No changes made.",
                expected, actual
            ),
            status: "failed".to_string(),
            full_content: None,
            diff: None,
            decision: None,
            rule_source: None,
            sensitive,
        };
    }
    let new_content = content.replacen(old_text, new_text, expected);
    let diff = if sensitive {
        None
    } else {
        compute_diff(&content, &new_content)
    };
    match std::fs::write(&resolved, &new_content) {
        Ok(_) => ToolResult {
            content: format!("Replaced {} occurrence(s) in {}", expected, path),
            status: "succeeded".to_string(),
            full_content: None,
            diff,
            decision: None,
            rule_source: None,
            sensitive,
        },
        Err(e) => ToolResult {
            content: format!("Failed to write file '{path}': {e}"),
            status: "failed".to_string(),
            full_content: None,
            diff: None,
            decision: None,
            rule_source: None,
            sensitive,
        },
    }
}

fn list_files(workspace_root: &Path, args: &Value) -> ToolResult {
    let glob = match args.get("glob").and_then(Value::as_str) {
        Some(g) => g,
        None => return ToolResult::failure("Missing required parameter: glob".to_string()),
    };
    let canonical_root = match workspace_root.canonicalize() {
        Ok(p) => p,
        Err(e) => return ToolResult::failure(format!("Workspace root not accessible: {e}")),
    };
    let matches = walk_glob(&canonical_root, glob);
    if matches.is_empty() {
        return ToolResult::success(format!("No files matched glob '{}'.", glob));
    }
    let mut out = String::new();
    for m in matches.iter().take(500) {
        out.push_str(m);
        out.push('\n');
    }
    if matches.len() > 500 {
        out.push_str(&format!(
            "\n... and {} more files (showing first 500).\n",
            matches.len() - 500
        ));
    }
    ToolResult::success(out)
}

/// Simple recursive glob walker supporting `**` and `*`. Results are
/// deduplicated and sorted so each matching path appears exactly once.
fn walk_glob(root: &Path, pattern: &str) -> Vec<String> {
    let mut results = Vec::new();
    walk_glob_recursive(root, root, pattern, &mut results);
    results.sort();
    results.dedup();
    results
}

fn walk_glob_recursive(root: &Path, current: &Path, pattern: &str, results: &mut Vec<String>) {
    // Split pattern into first segment and rest.
    let (first, rest) = match pattern.split_once('/') {
        Some((f, r)) => (f, Some(r)),
        None => (pattern, None),
    };
    // For `**` with a remainder, the zero-directory match must be tried ONCE
    // (not once per directory entry — that produced mass duplicates). Try it
    // here before iterating entries so it fires exactly once per recursion.
    if first == "**" {
        if let Some(rest_pattern) = rest {
            walk_glob_recursive(root, current, rest_pattern, results);
        }
    }
    let entries = match std::fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip dot-directories unless explicitly matched.
        if name.starts_with('.') && !first.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let is_dir = entry.metadata().map(|m| m.is_dir()).unwrap_or(false);
        if first == "**" {
            if let Some(_rest_pattern) = rest {
                // Zero-dir match already tried above; only recurse into subdirs here.
                if is_dir {
                    walk_glob_recursive(root, &path, pattern, results);
                }
            } else {
                // `**` at end matches all files recursively.
                if is_dir {
                    walk_glob_recursive(root, &path, "**", results);
                } else {
                    if let Ok(rel) = path.strip_prefix(root) {
                        results.push(rel.to_string_lossy().replace('\\', "/"));
                    }
                }
            }
        } else if glob_match(first, &name) {
            if is_dir {
                if let Some(rest_pattern) = rest {
                    walk_glob_recursive(root, &path, rest_pattern, results);
                }
            } else if rest.is_none() {
                if let Ok(rel) = path.strip_prefix(root) {
                    results.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
}

/// Simple glob matcher: supports `*` and `?` within a single path segment.
fn glob_match(pattern: &str, name: &str) -> bool {
    let p: Vec<char> = pattern.chars().collect();
    let n: Vec<char> = name.chars().collect();
    glob_match_inner(&p, &n)
}

fn glob_match_inner(pattern: &[char], name: &[char]) -> bool {
    let mut pi = 0;
    let mut ni = 0;
    let mut star_pi: Option<usize> = None;
    let mut star_ni = 0;
    while ni < name.len() {
        if pi < pattern.len() && (pattern[pi] == '?' || pattern[pi] == name[ni]) {
            pi += 1;
            ni += 1;
        } else if pi < pattern.len() && pattern[pi] == '*' {
            star_pi = Some(pi);
            star_ni = ni;
            pi += 1;
        } else if let Some(spi) = star_pi {
            pi = spi + 1;
            star_ni += 1;
            ni = star_ni;
        } else {
            return false;
        }
    }
    while pi < pattern.len() && pattern[pi] == '*' {
        pi += 1;
    }
    pi == pattern.len()
}

fn search_files(workspace_root: &Path, args: &Value) -> ToolResult {
    let pattern = match args.get("pattern").and_then(Value::as_str) {
        Some(p) => p,
        None => return ToolResult::failure("Missing required parameter: pattern".to_string()),
    };
    let scope = args.get("path").and_then(Value::as_str).unwrap_or("");
    let canonical_root = match workspace_root.canonicalize() {
        Ok(p) => p,
        Err(e) => return ToolResult::failure(format!("Workspace root not accessible: {e}")),
    };
    let search_root = if scope.is_empty() {
        canonical_root.clone()
    } else {
        match resolve_scoped(workspace_root, scope) {
            Ok(p) => p,
            Err(e) => return ToolResult::denied(e),
        }
    };
    // Compile regex.
    let re = match regex::Regex::new(pattern) {
        Ok(r) => r,
        Err(e) => return ToolResult::failure(format!("Invalid regex pattern: {e}")),
    };
    let mut results = Vec::new();
    search_recursive(&canonical_root, &search_root, &re, &mut results);
    if results.is_empty() {
        return ToolResult::success(format!("No matches for pattern '{}'.", pattern));
    }
    let mut out = String::new();
    for (path, line_no, line) in results.iter().take(200) {
        out.push_str(&format!("{}:{}: {}\n", path, line_no, line));
    }
    if results.len() > 200 {
        out.push_str(&format!(
            "\n... and {} more matches (showing first 200).\n",
            results.len() - 200
        ));
    }
    ToolResult::success(out)
}

fn search_recursive(
    root: &Path,
    current: &Path,
    re: &regex::Regex,
    results: &mut Vec<(String, usize, String)>,
) {
    let entries = match std::fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let is_dir = entry.metadata().map(|m| m.is_dir()).unwrap_or(false);
        if is_dir {
            search_recursive(root, &path, re, results);
        } else {
            let content = match std::fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue, // Binary or unreadable.
            };
            if let Ok(rel) = path.strip_prefix(root) {
                let rel_str = rel.to_string_lossy().replace('\\', "/");
                for (i, line) in content.lines().enumerate() {
                    if re.is_match(line) {
                        results.push((rel_str.clone(), i + 1, line.to_string()));
                    }
                }
            }
        }
    }
}

fn run_command(workspace_root: &Path, args: &Value) -> ToolResult {
    let command = match args.get("command").and_then(Value::as_str) {
        Some(c) => c,
        None => return ToolResult::failure("Missing required parameter: command".to_string()),
    };
    let cwd_rel = args.get("cwd").and_then(Value::as_str).unwrap_or("");
    let timeout_secs = args
        .get("timeout_secs")
        .and_then(Value::as_i64)
        .unwrap_or(DEFAULT_COMMAND_TIMEOUT_SECS as i64) as u64;
    let canonical_root = match workspace_root.canonicalize() {
        Ok(p) => p,
        Err(e) => return ToolResult::failure(format!("Workspace root not accessible: {e}")),
    };
    let cwd = if cwd_rel.is_empty() {
        canonical_root.clone()
    } else {
        match resolve_scoped(workspace_root, cwd_rel) {
            Ok(p) => p,
            Err(e) => return ToolResult::denied(e),
        }
    };
    // Spawn via cmd /C on Windows, sh -c on Unix. Hidden console.
    #[cfg(windows)]
    let mut cmd = {
        let mut c = hidden_command("cmd");
        c.arg("/C").arg(command);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = hidden_command("sh");
        c.arg("-c").arg(command);
        c
    };
    cmd.current_dir(&cwd);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());
    cmd.stdin(std::process::Stdio::null());
    let start = Instant::now();
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return ToolResult::failure(format!("Failed to spawn command: {e}")),
    };
    // Wait with timeout.
    let wait_result = child.wait_timeout(std::time::Duration::from_secs(timeout_secs));
    match wait_result {
        Ok(Some(status)) => {
            let stdout = child
                .stdout
                .take()
                .map(|mut r| {
                    let mut buf = String::new();
                    let _ = std::io::Read::read_to_string(&mut r, &mut buf);
                    buf
                })
                .unwrap_or_default();
            let stderr = child
                .stderr
                .take()
                .map(|mut r| {
                    let mut buf = String::new();
                    let _ = std::io::Read::read_to_string(&mut r, &mut buf);
                    buf
                })
                .unwrap_or_default();
            let mut output = String::new();
            if !stdout.is_empty() {
                output.push_str(&stdout);
            }
            if !stderr.is_empty() {
                if !output.is_empty() {
                    output.push_str("\n");
                }
                output.push_str(&stderr);
            }
            let duration_ms = start.elapsed().as_millis();
            let mut result = format!(
                "Exit code: {}\nDuration: {}ms\n\n",
                status.code().unwrap_or(-1),
                duration_ms
            );
            result.push_str(&output);
            // Truncate if needed.
            truncate_output(result)
        }
        Ok(None) => {
            // Timed out: kill the process tree.
            let _ = child.kill();
            let _ = child.wait();
            let duration_ms = start.elapsed().as_millis();
            ToolResult::failure(format!(
                "Command timed out after {}s and was killed. Duration: {}ms.",
                timeout_secs, duration_ms
            ))
        }
        Err(e) => ToolResult::failure(format!("Command wait failed: {e}")),
    }
}

/// Fallback executor for the propose_ideas tool. The agent loop intercepts
/// this tool before it reaches the generic executor and calls
/// SessionService::create_idea instead. This fn exists only so the ToolDef
/// has a valid execute pointer; if called directly, it returns a notice.
fn propose_ideas_fallback(_workspace_root: &Path, _args: &Value) -> ToolResult {
    ToolResult::failure(
        "propose_ideas must be intercepted by the agent loop. This fallback should never be called.".to_string(),
    )
}

/// Fallback executor for the ask_user tool. The agent loop intercepts this
/// tool before it reaches the generic executor and parks the iteration on
/// the interaction substrate. This fn exists only so the ToolDef has a valid
/// execute pointer; if called directly, it returns a notice.
fn ask_user_fallback(_workspace_root: &Path, _args: &Value) -> ToolResult {
    ToolResult::failure(
        "ask_user must be intercepted by the agent loop. This fallback should never be called."
            .to_string(),
    )
}
trait ChildWaitTimeoutExt {
    /// Returns `Ok(Some(status))` on exit, `Ok(None)` on timeout.
    fn wait_timeout(
        &mut self,
        dur: std::time::Duration,
    ) -> std::io::Result<Option<std::process::ExitStatus>>;
}

impl ChildWaitTimeoutExt for std::process::Child {
    fn wait_timeout(
        &mut self,
        dur: std::time::Duration,
    ) -> std::io::Result<Option<std::process::ExitStatus>> {
        // Poll-based: check every 50ms.
        let start = Instant::now();
        loop {
            match self.try_wait() {
                Ok(Some(status)) => return Ok(Some(status)),
                Ok(None) => {
                    if start.elapsed() >= dur {
                        return Ok(None); // Timeout.
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                Err(e) => return Err(e),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn workspace() -> TempDir {
        TempDir::new().expect("temp dir")
    }

    #[test]
    fn resolve_scoped_rejects_dotdot() {
        let dir = workspace();
        let root = dir.path();
        let result = resolve_scoped(root, "../../etc/passwd");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("outside the workspace"));
    }

    #[test]
    fn resolve_scoped_rejects_symlink_escape() {
        let dir = workspace();
        let root = dir.path();
        // Create a symlink pointing outside the workspace.
        let link = root.join("escape");
        #[cfg(unix)]
        std::os::unix::fs::symlink("/etc", &link).ok();
        #[cfg(windows)]
        {
            // Symlink creation on Windows may require privileges; skip if it fails.
            let _ = std::os::windows::fs::symlink_dir("C:\\Windows", &link);
        }
        if link.exists() {
            let result = resolve_scoped(root, "escape/passwd");
            assert!(result.is_err());
        }
    }

    #[test]
    fn resolve_scoped_allows_nested() {
        let dir = workspace();
        let root = dir.path();
        fs::create_dir_all(root.join("src/sub")).unwrap();
        let result = resolve_scoped(root, "src/sub/file.txt").unwrap();
        assert!(result.starts_with(&root.canonicalize().unwrap()));
    }

    #[test]
    fn edit_file_rejects_occurrence_mismatch() {
        let dir = workspace();
        let root = dir.path();
        fs::write(root.join("test.txt"), "foo bar foo bar foo").unwrap();
        let args = json!({
            "path": "test.txt",
            "old_text": "foo",
            "new_text": "baz",
            "expected_occurrences": 2
        });
        let result = edit_file(root, &args);
        assert_eq!(result.status, "failed");
        assert!(result.content.contains("expected 2 occurrence(s)"));
        assert!(result.content.contains("found 3"));
        // Verify no changes.
        let content = fs::read_to_string(root.join("test.txt")).unwrap();
        assert_eq!(content, "foo bar foo bar foo");
    }

    #[test]
    fn edit_file_succeeds_on_exact_match() {
        let dir = workspace();
        let root = dir.path();
        fs::write(root.join("test.txt"), "hello world").unwrap();
        let args = json!({
            "path": "test.txt",
            "old_text": "hello",
            "new_text": "goodbye",
            "expected_occurrences": 1
        });
        let result = edit_file(root, &args);
        assert_eq!(result.status, "succeeded");
        let content = fs::read_to_string(root.join("test.txt")).unwrap();
        assert_eq!(content, "goodbye world");
    }

    #[test]
    fn write_file_creates_parent_dirs() {
        let dir = workspace();
        let root = dir.path();
        let args = json!({
            "path": "src/sub/new.txt",
            "content": "hello"
        });
        let result = write_file(root, &args);
        assert_eq!(result.status, "succeeded");
        let content = fs::read_to_string(root.join("src/sub/new.txt")).unwrap();
        assert_eq!(content, "hello");
    }

    #[test]
    fn write_file_denied_outside_workspace() {
        let dir = workspace();
        let root = dir.path();
        let args = json!({
            "path": "../../../etc/passwd",
            "content": "malicious"
        });
        let result = write_file(root, &args);
        assert_eq!(result.status, "denied");
    }

    #[test]
    fn read_file_returns_line_numbers() {
        let dir = workspace();
        let root = dir.path();
        fs::write(root.join("test.txt"), "line one\nline two\nline three").unwrap();
        let args = json!({ "path": "test.txt" });
        let result = read_file(root, &args);
        assert_eq!(result.status, "succeeded");
        assert!(result.content.contains("     1\tline one"));
        assert!(result.content.contains("     2\tline two"));
        assert!(result.content.contains("     3\tline three"));
    }

    #[test]
    fn read_file_range() {
        let dir = workspace();
        let root = dir.path();
        fs::write(
            root.join("test.txt"),
            "line one\nline two\nline three\nline four",
        )
        .unwrap();
        let args = json!({ "path": "test.txt", "start_line": 2, "end_line": 3 });
        let result = read_file(root, &args);
        assert_eq!(result.status, "succeeded");
        assert!(result.content.contains("     2\tline two"));
        assert!(result.content.contains("     3\tline three"));
        assert!(!result.content.contains("line one"));
        assert!(!result.content.contains("line four"));
    }

    #[test]
    fn list_files_glob() {
        let dir = workspace();
        let root = dir.path();
        fs::create_dir_all(root.join("src/sub")).unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(root.join("src/sub/mod.rs"), "pub mod x;").unwrap();
        fs::write(root.join("README.md"), "# Test").unwrap();
        let args = json!({ "glob": "**/*.rs" });
        let result = list_files(root, &args);
        assert_eq!(result.status, "succeeded");
        assert!(result.content.contains("src/main.rs"));
        assert!(result.content.contains("src/sub/mod.rs"));
        assert!(!result.content.contains("README.md"));
    }

    #[test]
    fn list_files_glob_has_no_duplicates() {
        // Regression: `**` zero-directory match was tried once per directory
        // entry, producing mass duplicates. This test creates a directory with
        // multiple sibling entries and asserts each match appears exactly once.
        let dir = workspace();
        let root = dir.path();
        fs::create_dir_all(root.join("openspec/changes/plan-a")).unwrap();
        fs::create_dir_all(root.join("openspec/changes/plan-b")).unwrap();
        fs::write(root.join("openspec/changes/plan-a/proposal.md"), "# A").unwrap();
        fs::write(root.join("openspec/changes/plan-b/proposal.md"), "# B").unwrap();
        fs::write(root.join("openspec/changes/plan-a/spec.md"), "spec A").unwrap();
        // Add sibling entries to the parent dir to amplify the duplicate bug.
        for i in 0..5 {
            fs::write(root.join("openspec/changes/plan-a/file_{i}.txt"), "").unwrap();
        }
        let matches = walk_glob(root, "**/proposal.md");
        let proposal_count = matches
            .iter()
            .filter(|m| m.ends_with("proposal.md"))
            .count();
        assert_eq!(
            proposal_count, 2,
            "expected 2 proposal.md files, got {matches:?}"
        );
        // No duplicates at all.
        let mut sorted = matches.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), matches.len(), "duplicates found: {matches:?}");
    }
    #[test]
    fn search_files_finds_matches() {
        let dir = workspace();
        let root = dir.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/main.rs"),
            "fn main() {\n    println!(\"hello\");\n}",
        )
        .unwrap();
        fs::write(
            root.join("src/lib.rs"),
            "pub fn greet() {\n    println!(\"hello\");\n}",
        )
        .unwrap();
        let args = json!({ "pattern": "hello" });
        let result = search_files(root, &args);
        assert_eq!(result.status, "succeeded");
        assert!(result.content.contains("src/main.rs:2:"));
        assert!(result.content.contains("src/lib.rs:2:"));
    }

    #[test]
    fn run_command_captures_output() {
        let dir = workspace();
        let root = dir.path();
        let args = json!({
            "command": "echo hello-world",
            "timeout_secs": 10
        });
        let result = run_command(root, &args);
        assert_eq!(result.status, "succeeded");
        assert!(result.content.contains("hello-world"));
        assert!(result.content.contains("Exit code: 0"));
    }

    #[test]
    fn run_command_times_out() {
        let dir = workspace();
        let root = dir.path();
        // Cross-platform long-running command:
        //   Windows: `ping -t 127.0.0.1` pings forever until killed
        //   Unix: `sleep 30` blocks for 30 seconds
        #[cfg(windows)]
        let command = "ping -t 127.0.0.1";
        #[cfg(not(windows))]
        let command = "sleep 30";
        let args = json!({
            "command": command,
            "timeout_secs": 2
        });
        let result = run_command(root, &args);
        assert_eq!(result.status, "failed");
        assert!(result.content.contains("timed out"));
    }

    #[test]
    fn truncate_output_preserves_head_and_tail() {
        let big = "A".repeat(MAX_OUTPUT_BYTES * 2);
        let result = truncate_output(big);
        assert!(result.content.contains("[truncated"));
        assert!(result.full_content.is_some());
        assert!(result.content.starts_with('A'));
    }

    #[test]
    fn compute_diff_identical_returns_none() {
        let text = "line one\nline two\nline three";
        assert!(compute_diff(text, text).is_none());
    }

    #[test]
    fn compute_diff_added_lines() {
        let before = "line one\nline three";
        let after = "line one\nline two\nline three";
        let diff = compute_diff(before, after).expect("should produce a diff");
        assert!(diff.contains("+line two"));
        assert!(!diff.contains("-line"));
    }

    #[test]
    fn compute_diff_removed_lines() {
        let before = "line one\nline two\nline three";
        let after = "line one\nline three";
        let diff = compute_diff(before, after).expect("should produce a diff");
        assert!(diff.contains("-line two"));
        assert!(!diff.contains("+line"));
    }

    #[test]
    fn compute_diff_modified_line() {
        let before = "old text\nline two";
        let after = "new text\nline two";
        let diff = compute_diff(before, after).expect("should produce a diff");
        assert!(diff.contains("-old text"));
        assert!(diff.contains("+new text"));
        assert!(diff.contains(" line two"));
    }

    #[test]
    fn compute_diff_elides_over_cap() {
        let before: String = (0..500).map(|i| format!("line {i}\n")).collect();
        let after: String = (0..500).map(|i| format!("changed {i}\n")).collect();
        let diff = compute_diff(&before, &after).expect("should produce a diff");
        assert!(diff.contains("lines omitted"));
    }

    #[test]
    fn compute_diff_empty_before() {
        let after = "new file content\nline two";
        let diff = compute_diff("", after).expect("should produce a diff");
        assert!(diff.contains("+new file content"));
        assert!(diff.contains("+line two"));
    }

    #[test]
    fn write_file_includes_diff() {
        let dir = workspace();
        let root = dir.path();
        // Write initial content.
        let args1 = json!({ "path": "test.txt", "content": "original\n" });
        let result1 = write_file(root, &args1);
        assert_eq!(result1.status, "succeeded");
        // Diff from empty to "original" should be Some.
        assert!(result1.diff.is_some());
        // Overwrite with new content.
        let args2 = json!({ "path": "test.txt", "content": "modified\n" });
        let result2 = write_file(root, &args2);
        assert_eq!(result2.status, "succeeded");
        let diff = result2.diff.as_ref().expect("diff should be present");
        assert!(diff.contains("-original"));
        assert!(diff.contains("+modified"));
    }

    #[test]
    fn edit_file_includes_diff() {
        let dir = workspace();
        let root = dir.path();
        // Create a file first.
        std::fs::write(root.join("edit.txt"), "line one\nold line\nline three\n").unwrap();
        let args = json!({
            "path": "edit.txt",
            "old_text": "old line",
            "new_text": "new line"
        });
        let result = edit_file(root, &args);
        assert_eq!(result.status, "succeeded");
        let diff = result.diff.as_ref().expect("diff should be present");
        assert!(diff.contains("-old line"));
        assert!(diff.contains("+new line"));
        assert!(diff.contains(" line one"));
        assert!(diff.contains(" line three"));
    }

    #[test]
    fn edit_file_unchanged_returns_none_diff() {
        let dir = workspace();
        let root = dir.path();
        std::fs::write(root.join("same.txt"), "content\n").unwrap();
        // Replace with identical text — diff should be None.
        let args = json!({
            "path": "same.txt",
            "old_text": "content",
            "new_text": "content"
        });
        let result = edit_file(root, &args);
        assert_eq!(result.status, "succeeded");
        assert!(result.diff.is_none());
    }

    #[test]
    fn write_file_to_schematic_path_succeeds() {
        let dir = workspace();
        let root = dir.path();
        // The agent writes the project schematic to .basebuild/project-schematic.md.
        let schematic_content = "# Project Schematic\n\n## Goals\n- Build the thing\n";
        let args = json!({
            "path": ".basebuild/project-schematic.md",
            "content": schematic_content,
        });
        let result = write_file(root, &args);
        assert_eq!(result.status, "succeeded");
        // Verify the file was written at the correct path.
        let written =
            std::fs::read_to_string(root.join(".basebuild/project-schematic.md")).unwrap();
        assert_eq!(written, schematic_content);
        // Diff should be present (new file).
        assert!(result.diff.is_some());
    }

    #[test]
    fn write_file_to_schematic_path_is_workspace_scoped() {
        let dir = workspace();
        let root = dir.path();
        // Writing to .basebuild/project-schematic.md should stay within the workspace.
        let args = json!({
            "path": ".basebuild/project-schematic.md",
            "content": "schematic content\n",
        });
        let result = write_file(root, &args);
        assert_eq!(result.status, "succeeded");
        // Verify the file is inside the workspace root.
        let written_path = root.join(".basebuild").join("project-schematic.md");
        assert!(
            written_path.exists(),
            "schematic file should exist within workspace"
        );
        // Verify parent directory was created.
        assert!(
            root.join(".basebuild").exists(),
            ".basebuild directory should be created"
        );
    }

    #[test]
    fn write_file_to_schematic_path_rejects_traversal() {
        let dir = workspace();
        let root = dir.path();
        // Path traversal attempt targeting outside the workspace.
        let args = json!({
            "path": ".basebuild/../../etc/schematic.md",
            "content": "malicious\n",
        });
        let result = write_file(root, &args);
        // Should be denied (workspace-scoped path rejection).
        assert_eq!(result.status, "denied");
    }
    #[test]
    fn sensitive_path_detection() {
        use std::path::Path;
        let cases: Vec<(&str, bool)> = vec![
            (".env", true),
            (".env.local", true),
            ("id_rsa", true),
            ("id_rsa.pub", true),
            ("id_ed25519", true),
            ("id_ecdsa", true),
            ("x.pem", true),
            ("x.PEM", true),
            ("server.key", true),
            ("bundle.p12", true),
            ("cert.pfx", true),
            ("credentials.json", true),
            (".ssh/config", true),
            (".aws/credentials", true),
            (".gnupg/secring.gpg", true),
            (".omp/agent.db", true),
            (".omp/agent.sqlite", true),
            (".omp/agent.sqlite3", true),
            ("src/main.rs", false),
            ("README.md", false),
            ("data/app.db", false),
            ("app.sqlite", false),
        ];
        for (input, expected) in cases {
            let path = Path::new(input);
            assert_eq!(
                is_sensitive_path(path),
                expected,
                "is_sensitive_path({:?}) should be {}",
                input,
                expected
            );
        }
    }

    #[test]
    fn write_file_to_sensitive_path_redacts_diff() {
        let dir = workspace();
        let root = dir.path();
        let args = json!({
            "path": ".env",
            "content": "SECRET_API_KEY=12345\n"
        });
        let result = write_file(root, &args);
        assert_eq!(result.status, "succeeded");
        assert!(result.sensitive, "result should be flagged sensitive");
        assert!(
            result.diff.is_none(),
            "diff should be redacted for sensitive paths"
        );
        assert!(
            result.content.contains("Wrote"),
            "content summary should remain visible"
        );
        let written = fs::read_to_string(root.join(".env")).unwrap();
        assert_eq!(
            written, "SECRET_API_KEY=12345\n",
            "file must still be written"
        );
    }

    #[test]
    fn edit_file_oversize_rejected() {
        let dir = workspace();
        let root = dir.path();
        let big = "x".repeat(MAX_READ_FILE_BYTES as usize + 1024);
        fs::write(root.join("big.txt"), &big).unwrap();
        let args = json!({
            "path": "big.txt",
            "old_text": "x",
            "new_text": "y"
        });
        let result = edit_file(root, &args);
        assert_eq!(result.status, "failed");
        assert!(
            result.content.contains("1 MB edit limit"),
            "error should mention the 1 MB edit limit: {:?}",
            result.content
        );
        // The file must not have been touched.
        let content = fs::read_to_string(root.join("big.txt")).unwrap();
        assert_eq!(content.len(), big.len());
    }

    #[test]
    fn write_file_oversize_skips_diff() {
        let dir = workspace();
        let root = dir.path();
        let big = "x".repeat(MAX_READ_FILE_BYTES as usize + 1024);
        fs::write(root.join("big.txt"), &big).unwrap();
        let args = json!({
            "path": "big.txt",
            "content": "small"
        });
        let result = write_file(root, &args);
        assert_eq!(result.status, "succeeded");
        assert!(
            result.diff.is_none(),
            "diff should be skipped for oversized files"
        );
        let written = fs::read_to_string(root.join("big.txt")).unwrap();
        assert_eq!(written, "small", "write should still proceed");
    }

    #[test]
    fn redact_tool_arguments_redacts_bodies() {
        let input =
            r#"{"path":".env","content":"SECRET=1","old_text":"a","new_text":"b","other":"keep"}"#;
        let out = redact_tool_arguments(input);
        let value: Value = serde_json::from_str(&out).expect("redacted output is valid JSON");
        assert_eq!(value["path"], ".env");
        assert_eq!(value["other"], "keep");
        assert_eq!(value["content"], "[redacted: sensitive path]");
        assert_eq!(value["old_text"], "[redacted: sensitive path]");
        assert_eq!(value["new_text"], "[redacted: sensitive path]");
        // Invalid JSON is passed through unchanged.
        assert_eq!(redact_tool_arguments("not json"), "not json");
    }
}
