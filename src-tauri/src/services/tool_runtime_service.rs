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
}

impl ToolResult {
    pub fn success(content: String) -> Self {
        Self { content, status: "succeeded".to_string(), full_content: None }
    }
    pub fn failure(content: String) -> Self {
        Self { content, status: "failed".to_string(), full_content: None }
    }
    pub fn denied(content: String) -> Self {
        Self { content, status: "denied".to_string(), full_content: None }
    }
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
                description: "Capture one or more structured ideas during a generate-ideas run. Each idea has a title and a short description, and is optionally tagged with a category. Call this tool with the ideas as they are formed; do not emit them as prose. The user promotes or rejects each card in the UI.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "ideas": {
                            "type": "array",
                            "description": "Ideas to capture.",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": { "type": "string", "description": "Short title (max 12 words)." },
                                    "description": { "type": "string", "description": "1-2 sentence description of the idea." }
                                },
                                "required": ["title", "description"]
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
                let canonical_parent = parent.canonicalize().map_err(|e| {
                    format!("Path parent not accessible: {e}")
                })?;
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
    let start = args.get("start_line").and_then(Value::as_i64).map(|i| i.max(1) as usize).unwrap_or(1);
    let end = args.get("end_line").and_then(Value::as_i64).map(|i| i as usize);
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
        };
    }
    // Return line-numbered content.
    let mut out = String::new();
    for (i, line) in lines.iter().enumerate() {
        out.push_str(&format!("{:>6}\t{}\n", i + 1, line));
    }
    ToolResult::success(out)
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
    // Create parent directories if needed.
    if let Some(parent) = resolved.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                return ToolResult::failure(format!("Failed to create directories for '{path}': {e}"));
            }
        }
    }
    match std::fs::write(&resolved, content) {
        Ok(_) => ToolResult::success(format!("Wrote {} bytes to {}", content.len(), path)),
        Err(e) => ToolResult::failure(format!("Failed to write file '{path}': {e}")),
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
    let expected = args.get("expected_occurrences").and_then(Value::as_i64).unwrap_or(1) as usize;
    let resolved = match resolve_scoped(workspace_root, path) {
        Ok(p) => p,
        Err(e) => return ToolResult::denied(e),
    };
    let content = match std::fs::read_to_string(&resolved) {
        Ok(c) => c,
        Err(e) => return ToolResult::failure(format!("Failed to read file '{path}': {e}")),
    };
    let actual = content.matches(old_text).count();
    if actual != expected {
        return ToolResult::failure(format!(
            "Edit rejected: expected {} occurrence(s) of old_text, found {}. No changes made.",
            expected, actual
        ));
    }
    let new_content = content.replacen(old_text, new_text, expected);
    match std::fs::write(&resolved, &new_content) {
        Ok(_) => ToolResult::success(format!("Replaced {} occurrence(s) in {}", expected, path)),
        Err(e) => ToolResult::failure(format!("Failed to write file '{path}': {e}")),
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
        out.push_str(&format!("\n... and {} more files (showing first 500).\n", matches.len() - 500));
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
        out.push_str(&format!("\n... and {} more matches (showing first 200).\n", results.len() - 200));
    }
    ToolResult::success(out)
}

fn search_recursive(root: &Path, current: &Path, re: &regex::Regex, results: &mut Vec<(String, usize, String)>) {
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
    let timeout_secs = args.get("timeout_secs").and_then(Value::as_i64).unwrap_or(DEFAULT_COMMAND_TIMEOUT_SECS as i64) as u64;
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
            let stdout = child.stdout.take().map(|mut r| {
                let mut buf = String::new();
                let _ = std::io::Read::read_to_string(&mut r, &mut buf);
                buf
            }).unwrap_or_default();
            let stderr = child.stderr.take().map(|mut r| {
                let mut buf = String::new();
                let _ = std::io::Read::read_to_string(&mut r, &mut buf);
                buf
            }).unwrap_or_default();
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
            let mut result = format!("Exit code: {}\nDuration: {}ms\n\n", status.code().unwrap_or(-1), duration_ms);
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
trait ChildWaitTimeoutExt {
    /// Returns `Ok(Some(status))` on exit, `Ok(None)` on timeout.
    fn wait_timeout(&mut self, dur: std::time::Duration) -> std::io::Result<Option<std::process::ExitStatus>>;
}

impl ChildWaitTimeoutExt for std::process::Child {
    fn wait_timeout(&mut self, dur: std::time::Duration) -> std::io::Result<Option<std::process::ExitStatus>> {
        // Poll-based: check every 50ms.
        let start = Instant::now();
        loop {
            match self.try_wait()? {
                Some(status) => return Ok(Some(status)),
                None => {
                    if start.elapsed() >= dur {
                        return Ok(None); // Timeout.
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
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
        fs::write(root.join("test.txt"), "line one\nline two\nline three\nline four").unwrap();
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
        let proposal_count = matches.iter().filter(|m| m.ends_with("proposal.md")).count();
        assert_eq!(proposal_count, 2, "expected 2 proposal.md files, got {matches:?}");
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
        fs::write(root.join("src/main.rs"), "fn main() {\n    println!(\"hello\");\n}").unwrap();
        fs::write(root.join("src/lib.rs"), "pub fn greet() {\n    println!(\"hello\");\n}").unwrap();
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
}
