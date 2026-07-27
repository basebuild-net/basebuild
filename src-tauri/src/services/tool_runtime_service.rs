//! Core tool runtime for the native agent loop.
//!
//! `registry()` is the authoritative list of the tools the model can call:
//! workspace file tools, `run_command`, skill lookups, the loop-intercepted
//! interaction tools, and local planning readouts, including
//! `project_status`, which reports Basebuild's own plans, plan runs, ideas,
//! and git working state from local state alone. All file tools are
//! workspace-scoped: paths are canonicalized and prefix-checked
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
/// Maximum number of files `search_files` scans before bailing (bounds work
/// on huge trees so the agent loop thread is never pinned indefinitely).
const SEARCH_MAX_FILES_SCANNED: usize = 20_000;

/// Directory names that are always pruned from `search_files` / `list_files`
/// walks. These are dependency caches, build output, and VCS metadata that
/// dwarf source trees and would otherwise pin a tool thread reading tens of
/// thousands of irrelevant files. Dot-directories are already skipped by the
/// walkers, so `.git` / `.next` / `.cache` are covered implicitly.
const PRUNED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "coverage",
    ".turbo",
    ".parcel-cache",
    ".vscode",
    ".idea",
];

/// Returns true if a directory entry's name should be pruned from file walks.
/// Dot-directories are already skipped by the walkers (`starts_with('.')`),
/// so this only lists non-dot dependency/build/VCS caches.
fn is_pruned_dir(name: &str) -> bool {
    PRUNED_DIRS.contains(&name)
}

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
                name: "get_execution_advice".to_string(),
                description: "Read Basebuild's local planner/coder route recommendation for one persisted plan or idea. The result is computed locally from a bounded assessment, connected route metadata, coarse capacity, and public model evidence. It never includes credentials, account ids, project text, source, messages, questionnaire answers, raw usage, diffs, logs, or absolute paths. When this chat uses an external provider, returning the result crosses that provider boundary and is gated by Allow external context.".to_string(),
                parameters: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "planId": { "type": "string", "minLength": 1, "maxLength": 240 },
                        "ideaId": { "type": "string", "minLength": 1, "maxLength": 240 }
                    },
                    "oneOf": [
                        { "required": ["planId"] },
                        { "required": ["ideaId"] }
                    ]
                }),
            },
            kind: ToolKind::ReadOnly,
            execute: get_execution_advice,
        },
        ToolDef {
            schema: ToolSchema {
                name: "project_status".to_string(),
                description: "Report Basebuild's own local project state: plans grouped by status, active and recent plan runs, captured ideas, and the current git branch with a working-tree summary. Every value is read from the local Basebuild database and the local repository. The report contains no credentials, no secrets, and no absolute paths. This is the right way to answer questions about what is planned, what is running, and what is outstanding, and it should be read before proposing new work so proposals build on what already exists instead of guessing or shelling out.".to_string(),
                parameters: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "sections": {
                            "type": "array",
                            "maxItems": 4,
                            "items": {
                                "type": "string",
                                "enum": ["plans", "runs", "ideas", "git"]
                            },
                            "description": "Which sections to include. Omit for all sections."
                        }
                    }
                }),
            },
            kind: ToolKind::ReadOnly,
            execute: project_status,
        },
        ToolDef {
            schema: ToolSchema {
                name: "propose_ideas".to_string(),
                description: "Capture a batch of distinct, grounded implementation ideas. Every idea requires a versioned bounded assessment; invalid items reject the complete batch. Inspect the repository and existing ideas/plans first, cite concrete evidence, and call this tool instead of printing an idea wall as prose.".to_string(),
                parameters: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "ideas": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": 12,
                            "description": "Distinct, non-duplicate ideas to capture.",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "title": { "type": "string", "minLength": 1, "maxLength": 240, "description": "Plain, verb-first title of 2-5 words. No file names or implementation detail." },
                                    "description": { "type": "string", "minLength": 1, "maxLength": 20000, "description": "Concise concrete target and user-visible reason." },
                                    "grounding": { "type": "string", "minLength": 1, "maxLength": 4000, "description": "Concrete supporting evidence: real files, symbols, observed behavior, or an explicit unknown." },
                                    "anchor": { "type": "string", "maxLength": 4000, "description": "Optional schematic Vision, end goal, or current priority served." },
                                    "assessment": {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "properties": {
                                            "schemaVersion": { "type": "integer", "enum": [1] },
                                            "effort": {
                                                "type": "object",
                                                "additionalProperties": false,
                                                "properties": {
                                                    "minHours": { "type": "integer", "minimum": 1, "maximum": 10000 },
                                                    "maxHours": { "type": "integer", "minimum": 1, "maximum": 10000 }
                                                },
                                                "required": ["minHours", "maxHours"]
                                            },
                                            "difficulty": { "type": "integer", "minimum": 1, "maximum": 5 },
                                            "impact": { "type": "integer", "minimum": 1, "maximum": 5 },
                                            "risk": { "type": "integer", "minimum": 1, "maximum": 5 },
                                            "confidence": { "type": "integer", "minimum": 1, "maximum": 5 },
                                            "rationale": { "type": "string", "minLength": 1, "maxLength": 4000 },
                                            "grounding": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "type": "string", "minLength": 1, "maxLength": 4000 } },
                                            "requiredCapabilities": { "type": "array", "maxItems": 32, "items": { "type": "string", "minLength": 1, "maxLength": 4000 } },
                                            "constraints": { "type": "array", "maxItems": 32, "items": { "type": "string", "minLength": 1, "maxLength": 4000 } },
                                            "missingEvidence": { "type": "array", "maxItems": 32, "items": { "type": "string", "minLength": 1, "maxLength": 4000 } },
                                            "alternatives": { "type": "array", "maxItems": 32, "items": { "type": "string", "minLength": 1, "maxLength": 4000 } }
                                        },
                                        "required": ["schemaVersion", "effort", "difficulty", "impact", "risk", "confidence", "rationale", "grounding", "requiredCapabilities", "constraints", "missingEvidence", "alternatives"]
                                    }
                                },
                                "required": ["title", "description", "grounding", "assessment"]
                            }
                        },
                        "categoryId": { "type": "string", "description": "Optional category id applied to every idea in the batch." }
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
                name: "list_skills".to_string(),
                description: "List all available Basebuild skills (bundled and user-installed). Skills are reusable knowledge modules with instructions for specific tasks (e.g. 'basebuild-planning', 'dotnet-coding-standards'). Each entry includes the skill name and a short description. Use read_skill to get the full content of a skill before following its guidance.".to_string(),
                parameters: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {}
                }),
            },
            kind: ToolKind::ReadOnly,
            execute: list_skills,
        },
        ToolDef {
            schema: ToolSchema {
                name: "read_skill".to_string(),
                description: "Read the full SKILL.md content of a named Basebuild skill. Skills contain detailed instructions, conventions, and step-by-step guidance for specific tasks. Always read a skill's content before applying its guidance to the user's project.".to_string(),
                parameters: json!({
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "name": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 128,
                            "description": "The skill name (e.g. 'basebuild-planning', 'dotnet-coding-standards'). Use list_skills to discover valid names."
                        }
                    },
                    "required": ["name"]
                }),
            },
            kind: ToolKind::ReadOnly,
            execute: read_skill,
        },
        ToolDef {
            schema: ToolSchema {
                name: "ask_user".to_string(),
                description: "Pause and present a focused, resumable questionnaire. Use a concise title and description, group related questions with pageId/pageTitle, mark decision-critical questions required, and use a rating question for a typed bounded score. Legacy flat questions remain supported. The user may minimize without cancelling; only final submission resumes the loop.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "title": {
                            "type": "string",
                            "maxLength": 256,
                            "description": "Prominent questionnaire title."
                        },
                        "description": {
                            "type": "string",
                            "maxLength": 4096,
                            "description": "Why these decisions are needed and what continues afterward."
                        },
                        "questions": {
                            "type": "array",
                            "minItems": 1,
                            "maxItems": 32,
                            "description": "Questions in page order. Questions sharing a pageId render on the same page.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": { "type": "string", "maxLength": 128, "description": "Unique question id used to key the answer." },
                                    "prompt": { "type": "string", "maxLength": 4096, "description": "Question text shown to the user." },
                                    "kind": { "type": "string", "enum": ["options", "multi", "confirm", "text", "rating"] },
                                    "pageId": { "type": "string", "maxLength": 128, "description": "Optional stable page id. Omit on every question for a legacy single page." },
                                    "pageTitle": { "type": "string", "maxLength": 256 },
                                    "pageDescription": { "type": "string", "maxLength": 4096 },
                                    "required": { "type": "boolean", "default": false },
                                    "multiline": { "type": "boolean", "default": false, "description": "Render a multiline text control for text questions." },
                                    "options": {
                                        "type": "array",
                                        "maxItems": 20,
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "label": { "type": "string", "maxLength": 256 },
                                                "description": { "type": "string", "maxLength": 1024 }
                                            },
                                            "required": ["label"]
                                        }
                                    },
                                    "recommended": { "type": "integer", "minimum": 0, "description": "Index into options." },
                                    "allowFreeText": { "type": "boolean", "default": false },
                                    "detail": { "type": "string", "maxLength": 8192, "description": "Optional read-only context; never treated as an answer." },
                                    "scale": {
                                        "type": "object",
                                        "description": "Rating bounds. Omit for the default 1–5 scale.",
                                        "properties": {
                                            "min": { "type": "integer", "minimum": 0, "maximum": 9 },
                                            "max": { "type": "integer", "minimum": 1, "maximum": 10 },
                                            "lowLabel": { "type": "string", "maxLength": 128 },
                                            "highLabel": { "type": "string", "maxLength": 128 },
                                            "style": { "type": "string", "enum": ["stars", "numbers"] }
                                        },
                                        "required": ["min", "max"]
                                    }
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
        // Skip dot-directories and dependency/build caches unless the
        // pattern explicitly targets them by name. `**` recursion prunes
        // them so a broad glob doesn't scan node_modules/target; an explicit
        // segment like `node_modules/foo` still enters via the zero-dir match.
        if (name.starts_with('.') && !first.starts_with('.'))
            || (first == "**" && is_pruned_dir(&name))
        {
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
    let mut files_scanned = 0usize;
    search_recursive(
        &canonical_root,
        &search_root,
        &re,
        &mut results,
        &mut files_scanned,
    );
    if results.is_empty() {
        let mut msg = format!("No matches for pattern '{}'.", pattern);
        if files_scanned >= SEARCH_MAX_FILES_SCANNED {
            msg.push_str(&format!(
                " (scan stopped after {files_scanned} files; narrow the `path` scope to search deeper)"
            ));
        }
        return ToolResult::success(msg);
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
    if files_scanned >= SEARCH_MAX_FILES_SCANNED {
        out.push_str(&format!(
            "\n... scan stopped after {files_scanned} files; narrow the `path` scope to search deeper.\n"
        ));
    }
    ToolResult::success(out)
}

fn search_recursive(
    root: &Path,
    current: &Path,
    re: &regex::Regex,
    results: &mut Vec<(String, usize, String)>,
    files_scanned: &mut usize,
) {
    if *files_scanned >= SEARCH_MAX_FILES_SCANNED {
        return;
    }
    let entries = match std::fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if *files_scanned >= SEARCH_MAX_FILES_SCANNED {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || is_pruned_dir(&name) {
            continue;
        }
        let path = entry.path();
        let is_dir = entry.metadata().map(|m| m.is_dir()).unwrap_or(false);
        if is_dir {
            search_recursive(root, &path, re, results, files_scanned);
        } else {
            *files_scanned += 1;
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

/// Return the local, sanitized execution recommendation for one persisted
/// planning artifact. The project path is used only as a local lookup key.
fn get_execution_advice(workspace_root: &Path, args: &Value) -> ToolResult {
    let plan_id = args.get("planId").and_then(Value::as_str);
    let idea_id = args.get("ideaId").and_then(Value::as_str);
    if plan_id.is_some() == idea_id.is_some() {
        return ToolResult::failure("Provide exactly one bounded planId or ideaId.".to_string());
    }
    let project_path = workspace_root.to_string_lossy();
    match crate::services::execution_advisor_service::ExecutionAdvisorService::get_advice(
        &project_path,
        plan_id,
        idea_id,
    ) {
        Ok(advice) => serde_json::to_string_pretty(&advice)
            .map(ToolResult::success)
            .unwrap_or_else(|error| ToolResult::failure(error.to_string())),
        Err(error) => ToolResult::failure(error),
    }
}

/// Section names `project_status` understands, in the order they are
/// rendered. The report order is fixed so the model sees a stable shape
/// regardless of the order the sections were requested in.
const PROJECT_STATUS_SECTIONS: [&str; 4] = ["plans", "runs", "ideas", "git"];
/// Maximum plans listed individually before the tail is summarized.
const PROJECT_STATUS_MAX_PLANS: usize = 20;
/// Maximum active (non-terminal) runs listed before the tail is summarized.
const PROJECT_STATUS_MAX_ACTIVE_RUNS: usize = 20;
/// Maximum finished runs listed after the active ones.
const PROJECT_STATUS_MAX_TERMINAL_RUNS: usize = 5;
/// Maximum concept ideas listed by title.
const PROJECT_STATUS_MAX_IDEAS: usize = 10;
/// Maximum characters of any user-authored title echoed into the report.
const PROJECT_STATUS_MAX_LABEL: usize = 120;

/// One shared rejection message so a bad `sections` argument always names the
/// values the model is allowed to pass.
fn project_status_section_error(offender: &str) -> String {
    format!(
        "Invalid 'sections' argument: {offender}. Valid sections are: plans, runs, ideas, git. Omit 'sections' for all of them."
    )
}

/// Collapse a user-authored title into one bounded single-line label. Titles
/// are free text, so an embedded newline would forge a section heading in the
/// report and a very long title would crowd out the rest of the status.
fn project_status_label(raw: &str) -> String {
    let single_line = raw
        .split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    if single_line.is_empty() {
        return "(untitled)".to_string();
    }
    if single_line.chars().count() <= PROJECT_STATUS_MAX_LABEL {
        return single_line;
    }
    let head: String = single_line.chars().take(PROJECT_STATUS_MAX_LABEL).collect();
    format!("{head}...")
}

/// Count occurrences of each status label, preserving first-seen order so the
/// summary line reflects the service's own ordering rather than a hash order.
fn project_status_counts<'a>(statuses: impl Iterator<Item = &'a str>) -> Vec<(&'a str, usize)> {
    let mut counts: Vec<(&'a str, usize)> = Vec::new();
    for status in statuses {
        match counts.iter_mut().find(|(name, _)| *name == status) {
            Some(entry) => entry.1 += 1,
            None => counts.push((status, 1)),
        }
    }
    counts
}

/// Render `(status, count)` pairs as `status n, status n`.
fn project_status_format_counts(counts: &[(&str, usize)]) -> String {
    counts
        .iter()
        .map(|(name, count)| format!("{name} {count}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Plan-status counts plus a bounded listing. Takes the already-fetched
/// result because the runs section reuses the same query for plan titles.
fn project_status_plans(plans: &Result<Vec<crate::models::plan::Plan>, String>) -> String {
    let plans = match plans {
        Ok(plans) => plans,
        Err(error) => return format!("Unavailable: {error}"),
    };
    if plans.is_empty() {
        return "No plans yet.".to_string();
    }
    let counts = project_status_counts(plans.iter().map(|plan| plan.status.as_str()));
    let mut lines = vec![format!(
        "{} total ({}).",
        plans.len(),
        project_status_format_counts(&counts)
    )];
    for plan in plans.iter().take(PROJECT_STATUS_MAX_PLANS) {
        lines.push(format!(
            "- [{}] {} ({})",
            plan.status.as_str(),
            project_status_label(&plan.title),
            plan.id
        ));
    }
    if plans.len() > PROJECT_STATUS_MAX_PLANS {
        lines.push(format!(
            "... and {} more not listed.",
            plans.len() - PROJECT_STATUS_MAX_PLANS
        ));
    }
    lines.join("\n")
}

/// Active runs first (those are what the user can still act on), then the
/// most recent finished ones for context. `plans` is only a title lookup: a
/// failed plan query degrades a run to its plan id, never drops it.
fn project_status_runs(
    runs: &Result<Vec<crate::models::plan_run::PlanRun>, String>,
    plans: &Result<Vec<crate::models::plan::Plan>, String>,
) -> String {
    use crate::models::plan_run::{PlanRun, PlanRunStatus};

    let runs = match runs {
        Ok(runs) => runs,
        Err(error) => return format!("Unavailable: {error}"),
    };
    if runs.is_empty() {
        return "No plan runs recorded.".to_string();
    }
    let titles = plans.as_deref().unwrap_or(&[]);
    let describe = |run: &PlanRun| -> String {
        let plan = titles
            .iter()
            .find(|plan| plan.id == run.plan_id)
            .map(|plan| project_status_label(&plan.title))
            .unwrap_or_else(|| format!("plan {}", run.plan_id));
        format!("- [{}] {} (run {})", run.status.as_str(), plan, run.id)
    };
    let is_terminal = |status: PlanRunStatus| {
        matches!(
            status,
            PlanRunStatus::Succeeded | PlanRunStatus::Failed | PlanRunStatus::Cancelled
        )
    };

    let counts = project_status_counts(runs.iter().map(|run| run.status.as_str()));
    let mut lines = vec![format!(
        "{} total ({}).",
        runs.len(),
        project_status_format_counts(&counts)
    )];

    let active: Vec<&PlanRun> = runs.iter().filter(|run| !is_terminal(run.status)).collect();
    if active.is_empty() {
        lines.push("No active runs.".to_string());
    } else {
        lines.push(format!("Active ({}):", active.len()));
        for run in active.iter().copied().take(PROJECT_STATUS_MAX_ACTIVE_RUNS) {
            lines.push(describe(run));
        }
        if active.len() > PROJECT_STATUS_MAX_ACTIVE_RUNS {
            lines.push(format!(
                "... and {} more active.",
                active.len() - PROJECT_STATUS_MAX_ACTIVE_RUNS
            ));
        }
    }

    // The service returns newest first, so the head of the terminal slice is
    // already the most recent finished work.
    let terminal: Vec<&PlanRun> = runs.iter().filter(|run| is_terminal(run.status)).collect();
    if !terminal.is_empty() {
        lines.push(format!(
            "Most recent finished ({} of {}):",
            terminal.len().min(PROJECT_STATUS_MAX_TERMINAL_RUNS),
            terminal.len()
        ));
        for run in terminal.iter().copied().take(PROJECT_STATUS_MAX_TERMINAL_RUNS) {
            lines.push(describe(run));
        }
    }
    lines.join("\n")
}

/// Idea counts across the full status set plus the open concepts by title.
/// Every status is printed even at zero so an absent status is never read as
/// a gap in the report.
fn project_status_ideas(ideas: &Result<Vec<crate::models::idea::Idea>, String>) -> String {
    use crate::models::idea::{Idea, IdeaStatus};

    let ideas = match ideas {
        Ok(ideas) => ideas,
        Err(error) => return format!("Unavailable: {error}"),
    };
    if ideas.is_empty() {
        return "No ideas captured yet.".to_string();
    }
    let summary = [
        IdeaStatus::Concept,
        IdeaStatus::Picked,
        IdeaStatus::Rejected,
        IdeaStatus::Archived,
    ]
    .iter()
    .map(|status| {
        format!(
            "{} {}",
            status.as_str(),
            ideas.iter().filter(|idea| idea.status == *status).count()
        )
    })
    .collect::<Vec<_>>()
    .join(", ");
    let mut lines = vec![format!("{} total ({}).", ideas.len(), summary)];

    let concepts: Vec<&Idea> = ideas
        .iter()
        .filter(|idea| idea.status == IdeaStatus::Concept)
        .collect();
    if concepts.is_empty() {
        lines.push("No open concepts.".to_string());
    } else {
        for idea in concepts.iter().copied().take(PROJECT_STATUS_MAX_IDEAS) {
            lines.push(format!("- {}", project_status_label(&idea.title)));
        }
        if concepts.len() > PROJECT_STATUS_MAX_IDEAS {
            lines.push(format!(
                "... and {} more concepts.",
                concepts.len() - PROJECT_STATUS_MAX_IDEAS
            ));
        }
    }
    lines.join("\n")
}

/// Branch and a one-line working-tree summary. Never file contents, never a
/// diff, never a path: only counts and the branch/upstream ref names.
fn project_status_git(workspace_root: &Path) -> String {
    let status = match crate::services::git_service::GitService::status(workspace_root) {
        Ok(status) => status,
        // A workspace without a repository is a normal state, not a tool
        // failure, and git's error text can carry absolute paths.
        Err(_) => return "Git: not a repository or unavailable.".to_string(),
    };
    let mut branch = format!("Branch: {}", status.branch.branch);
    if status.unborn {
        branch.push_str(" (no commits yet)");
    }
    if let Some(upstream) = &status.branch.upstream {
        branch.push_str(&format!(", upstream {upstream}"));
    }
    if status.branch.ahead > 0 || status.branch.behind > 0 {
        branch.push_str(&format!(
            ", ahead {}, behind {}",
            status.branch.ahead, status.branch.behind
        ));
    }
    let tree = if status.staged.is_empty() && status.unstaged.is_empty() && status.untracked.is_empty()
    {
        "Working tree: clean.".to_string()
    } else {
        format!(
            "Working tree: {} staged, {} unstaged, {} untracked.",
            status.staged.len(),
            status.unstaged.len(),
            status.untracked.len()
        )
    };
    format!("{branch}\n{tree}")
}

/// Report Basebuild's own local view of the project: plans, plan runs, ideas,
/// and git working state, all read from the local database and repository.
///
/// Every section degrades to an explicit line rather than failing the call: a
/// status report that half works is more useful than an error, and a silently
/// omitted section would read to the model as "nothing exists" and send it
/// off proposing work that is already planned or running.
fn project_status(workspace_root: &Path, args: &Value) -> ToolResult {
    let requested: Vec<&'static str> = match args.get("sections") {
        None | Some(Value::Null) => PROJECT_STATUS_SECTIONS.to_vec(),
        Some(Value::Array(items)) => {
            let mut requested: Vec<&'static str> = Vec::with_capacity(items.len());
            for item in items {
                let name = match item.as_str() {
                    Some(name) => name.trim(),
                    None => {
                        return ToolResult::failure(project_status_section_error(
                            "section names must be strings",
                        ))
                    }
                };
                match PROJECT_STATUS_SECTIONS.iter().find(|known| **known == name) {
                    Some(known) => {
                        if !requested.contains(known) {
                            requested.push(*known);
                        }
                    }
                    None => {
                        return ToolResult::failure(project_status_section_error(&format!(
                            "unknown section '{name}'"
                        )))
                    }
                }
            }
            // An explicit empty array asks for nothing useful; treat it the
            // same as omitting the argument.
            if requested.is_empty() {
                PROJECT_STATUS_SECTIONS.to_vec()
            } else {
                requested
            }
        }
        Some(_) => {
            return ToolResult::failure(project_status_section_error(
                "'sections' must be an array of strings",
            ))
        }
    };

    // The workspace root doubles as the project key for the plan/idea
    // services. Only its final component is ever printed.
    let project_path = workspace_root.to_string_lossy();
    let project_name = workspace_root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "(workspace)".to_string());

    // One plan query backs two sections: the plans listing and the run title
    // lookup. Skip it entirely when neither section was requested.
    let plans = if requested.contains(&"plans") || requested.contains(&"runs") {
        crate::services::plan_service::PlanService::list_for_project(&project_path)
    } else {
        Ok(Vec::new())
    };

    let mut report = format!("# Project status: {project_name}\n");
    for section in PROJECT_STATUS_SECTIONS
        .iter()
        .filter(|section| requested.contains(*section))
    {
        let (heading, body) = match *section {
            "plans" => ("Plans", project_status_plans(&plans)),
            "runs" => (
                "Plan runs",
                project_status_runs(
                    &crate::services::plan_runner_service::PlanRunnerService::list_runs_for_project(
                        &project_path,
                    ),
                    &plans,
                ),
            ),
            "ideas" => (
                "Ideas",
                project_status_ideas(
                    &crate::services::session_service::SessionService::list_ideas_for_project(
                        &project_path,
                    ),
                ),
            ),
            // `requested` only ever holds PROJECT_STATUS_SECTIONS values, so
            // the remaining arm is `git`. Matched as the default rather than
            // unreachable!() so a future section can never panic the tool.
            _ => ("Git", project_status_git(workspace_root)),
        };
        report.push_str(&format!("\n## {heading}\n{body}\n"));
    }
    truncate_output(report)
}

/// Fallback executor for the propose_ideas tool. The agent loop intercepts
/// this tool before it reaches the generic executor and calls
/// SessionService::create_idea instead. This function exists only so the
/// ToolDef has a valid execute pointer.
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

/// List all available Basebuild skills (bundled + user-installed).
/// Returns one line per skill: "name — description".
fn list_skills(_workspace_root: &Path, _args: &Value) -> ToolResult {
    match crate::services::skill_registry_service::SkillRegistryService::list() {
        Ok(skills) => {
            if skills.is_empty() {
                return ToolResult::success(
                    "No skills are installed. Skills can be added to ~/.basebuild/skills/ or bundled by the app.".to_string(),
                );
            }
            let mut lines: Vec<String> = Vec::with_capacity(skills.len());
            for skill in &skills {
                let desc = if skill.description.is_empty() {
                    "(no description)"
                } else {
                    &skill.description
                };
                lines.push(format!("{} — {}", skill.name, desc));
            }
            ToolResult::success(lines.join("\n"))
        }
        Err(e) => ToolResult::failure(format!("Failed to list skills: {e}")),
    }
}

/// Read the full SKILL.md content of a named skill.
fn read_skill(_workspace_root: &Path, args: &Value) -> ToolResult {
    let name = match args.get("name").and_then(Value::as_str) {
        Some(n) => n,
        None => return ToolResult::failure("Missing required parameter: name".to_string()),
    };
    match crate::services::skill_registry_service::SkillRegistryService::read_content(name) {
        Some(content) => ToolResult::success(content),
        None => ToolResult::failure(format!(
            "Skill '{name}' not found. Use list_skills to see available skill names."
        )),
    }
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
    fn search_files_prunes_dependency_dirs() {
        // node_modules/target/dist must be pruned so a broad search doesn't
        // scan tens of thousands of files and stall the agent loop thread.
        let dir = workspace();
        let root = dir.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(root.join("target")).unwrap();
        fs::write(root.join("src/main.rs"), "let x = \"needle\";\n").unwrap();
        // Would be scanned if node_modules weren't pruned.
        fs::write(
            root.join("node_modules/pkg/index.js"),
            "const y = \"needle\";\n",
        )
        .unwrap();
        fs::write(root.join("target/build.log"), "needle\n").unwrap();
        let args = json!({ "pattern": "needle" });
        let result = search_files(root, &args);
        assert_eq!(result.status, "succeeded");
        assert!(
            result.content.contains("src/main.rs:1:"),
            "src match missing: {}",
            result.content
        );
        assert!(
            !result.content.contains("node_modules/"),
            "node_modules not pruned: {}",
            result.content
        );
        assert!(
            !result.content.contains("target/"),
            "target not pruned: {}",
            result.content
        );
    }

    #[test]
    fn list_files_prunes_dependency_dirs_in_globstar() {
        let dir = workspace();
        let root = dir.path();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {}").unwrap();
        fs::write(
            root.join("node_modules/pkg/index.js"),
            "module.exports = {}",
        )
        .unwrap();
        let args = json!({ "glob": "**/*" });
        let result = list_files(root, &args);
        assert_eq!(result.status, "succeeded");
        assert!(
            result.content.contains("src/main.rs"),
            "src match missing: {}",
            result.content
        );
        assert!(
            !result.content.contains("node_modules/"),
            "node_modules not pruned: {}",
            result.content
        );
    }

    #[test]
    fn list_files_explicit_segment_enters_pruned_dir() {
        // An explicit segment like `node_modules/*` must still enter the dir;
        // only `**` recursion prunes dependency caches.
        let dir = workspace();
        let root = dir.path();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::write(root.join("node_modules/index.js"), "module.exports = {}").unwrap();
        let args = json!({ "glob": "node_modules/*" });
        let result = list_files(root, &args);
        assert_eq!(result.status, "succeeded");
        assert!(
            result.content.contains("node_modules/index.js"),
            "explicit segment should enter node_modules: {}",
            result.content
        );
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
    fn ask_user_schema_exposes_paged_rating_contract() {
        let tool = registry()
            .into_iter()
            .find(|definition| definition.schema.name == "ask_user")
            .unwrap();
        let properties = &tool.schema.parameters["properties"];
        assert!(properties.get("title").is_some());
        assert!(properties.get("description").is_some());
        let question = &properties["questions"]["items"]["properties"];
        assert!(question["kind"]["enum"]
            .as_array()
            .unwrap()
            .iter()
            .any(|kind| kind == "rating"));
        assert!(question.get("pageId").is_some());
        assert!(question.get("required").is_some());
        assert!(question.get("scale").is_some());
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
    #[test]
    fn propose_ideas_assessment_schema_snapshot() {
        let tool = registry()
            .into_iter()
            .find(|tool| tool.schema.name == "propose_ideas")
            .expect("propose_ideas tool");
        let assessment =
            &tool.schema.parameters["properties"]["ideas"]["items"]["properties"]["assessment"];

        assert_eq!(
            assessment,
            &json!({
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "schemaVersion": { "type": "integer", "enum": [1] },
                    "effort": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "minHours": { "type": "integer", "minimum": 1, "maximum": 10000 },
                            "maxHours": { "type": "integer", "minimum": 1, "maximum": 10000 }
                        },
                        "required": ["minHours", "maxHours"]
                    },
                    "difficulty": { "type": "integer", "minimum": 1, "maximum": 5 },
                    "impact": { "type": "integer", "minimum": 1, "maximum": 5 },
                    "risk": { "type": "integer", "minimum": 1, "maximum": 5 },
                    "confidence": { "type": "integer", "minimum": 1, "maximum": 5 },
                    "rationale": { "type": "string", "minLength": 1, "maxLength": 4000 },
                    "grounding": { "type": "array", "minItems": 1, "maxItems": 32, "items": { "type": "string", "minLength": 1, "maxLength": 4000 } },
                    "requiredCapabilities": { "type": "array", "maxItems": 32, "items": { "type": "string", "minLength": 1, "maxLength": 4000 } },
                    "constraints": { "type": "array", "maxItems": 32, "items": { "type": "string", "minLength": 1, "maxLength": 4000 } },
                    "missingEvidence": { "type": "array", "maxItems": 32, "items": { "type": "string", "minLength": 1, "maxLength": 4000 } },
                    "alternatives": { "type": "array", "maxItems": 32, "items": { "type": "string", "minLength": 1, "maxLength": 4000 } }
                },
                "required": ["schemaVersion", "effort", "difficulty", "impact", "risk", "confidence", "rationale", "grounding", "requiredCapabilities", "constraints", "missingEvidence", "alternatives"]
            })
        );
    }

    #[test]
    fn project_status_is_registered_read_only() {
        let tool = registry()
            .into_iter()
            .find(|tool| tool.schema.name == "project_status")
            .expect("project_status tool");
        assert_eq!(tool.kind, ToolKind::ReadOnly);
        assert_eq!(
            tool.schema.parameters["properties"]["sections"]["items"]["enum"],
            json!(["plans", "runs", "ideas", "git"])
        );
        assert!(
            tool.schema.parameters.get("required").is_none(),
            "sections must stay optional"
        );
    }

    #[test]
    fn project_status_rejects_unknown_section() {
        let dir = workspace();
        let result = project_status(dir.path(), &json!({ "sections": ["plans", "deployments"] }));
        assert_eq!(result.status, "failed");
        assert!(
            result.content.contains("deployments"),
            "failure names the offending section: {}",
            result.content
        );
        for valid in ["plans", "runs", "ideas", "git"] {
            assert!(
                result.content.contains(valid),
                "failure names valid section {valid}: {}",
                result.content
            );
        }
    }

    #[test]
    fn project_status_empty_workspace_reports_every_section() {
        let dir = workspace();
        let root = dir.path();
        let result = project_status(root, &json!({}));
        assert_eq!(result.status, "succeeded");
        for heading in ["## Plans", "## Plan runs", "## Ideas", "## Git"] {
            assert!(
                result.content.contains(heading),
                "missing {heading} in:\n{}",
                result.content
            );
        }
        let absolute = root.to_string_lossy().to_string();
        assert!(
            !result.content.contains(&absolute),
            "report leaked the absolute workspace path:\n{}",
            result.content
        );
    }

    #[test]
    fn project_status_sections_filter_selects_one_section() {
        let dir = workspace();
        let result = project_status(dir.path(), &json!({ "sections": ["git"] }));
        assert_eq!(result.status, "succeeded");
        assert!(result.content.contains("## Git"));
        assert!(!result.content.contains("## Plans"));
        assert!(!result.content.contains("## Plan runs"));
        assert!(!result.content.contains("## Ideas"));
        // A bare temp dir is normally not a repository, but the section must
        // state something either way instead of going silently missing.
        assert!(
            result
                .content
                .contains("Git: not a repository or unavailable.")
                || result.content.contains("Branch: "),
            "git section states a branch or an explicit unavailable line:\n{}",
            result.content
        );
    }
}
