use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Source priority for command resolution (lower number = higher priority,
/// mirroring oh-my-pi's precedence). First-wins on name collision.
pub const PRIORITY_BUILTIN: u32 = 100;
pub const PRIORITY_OMP: u32 = 90;
pub const PRIORITY_CLAUDE: u32 = 80;
pub const PRIORITY_CODEX: u32 = 70;
pub const PRIORITY_SKILL: u32 = 60;
pub const PRIORITY_MCP: u32 = 50;

/// A discovered slash command. Builtin commands execute UI actions; file-based
/// commands carry a markdown body template expanded with user arguments.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlashCommand {
    /// Command name without the leading `/` (e.g. "review", "login").
    pub name: String,
    /// Human-readable description from frontmatter or empty.
    pub description: String,
    /// Source label: "builtin", "omp", "claude", "codex", "skill", "mcp".
    pub source: String,
    /// Numeric priority (higher = wins on collision).
    pub priority: u32,
    /// Whether this command is shadowed by a higher-priority command with the
    /// same name. Shadowed commands are still listed in the command list UI.
    pub shadowed: bool,
    /// File path for file-based commands (null for builtin/skill).
    pub file_path: Option<String>,
    /// Markdown body template for file-based commands (null for builtin).
    pub body: Option<String>,
}

/// Result of expanding a slash command's template with user arguments.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandedCommand {
    /// The expanded prompt text to send to the model, or null for builtin
    /// commands that execute UI actions instead.
    pub prompt: Option<String>,
    /// The builtin action to execute, if any (e.g. "login", "model", "plan").
    pub builtin_action: Option<String>,
    /// Arguments parsed from the user input after the command name.
    pub arguments: Vec<String>,
}

/// Discover all slash commands available for a project. Scans:
/// - builtin manifest (hardcoded UI commands)
/// - `.omp/commands/*.md` (project then user `~/.omp/agent/commands/`)
/// - `.claude/commands/**/*.md` (recursive, with `dir:name` aliases)
/// - `.codex/commands/*.md`
/// - skills (`/skill:<name>`)
///
/// MCP prompt commands are added dynamically by the caller (they require a
/// live connection). Deduplication is first-wins by priority.
pub fn discover_commands(project_path: &str) -> Vec<SlashCommand> {
    let mut commands: Vec<SlashCommand> = Vec::new();

    // 1. Builtin commands (highest priority).
    for (name, description) in builtin_commands() {
        commands.push(SlashCommand {
            name,
            description,
            source: "builtin".to_string(),
            priority: PRIORITY_BUILTIN,
            shadowed: false,
            file_path: None,
            body: None,
        });
    }

    // 2. omp commands (project > user).
    let omp_project = Path::new(project_path).join(".omp").join("commands");
    scan_md_dir(&omp_project, "omp", PRIORITY_OMP, &mut commands);
    if let Some(home) = home_dir() {
        let omp_user = home.join(".omp").join("agent").join("commands");
        scan_md_dir(&omp_user, "omp", PRIORITY_OMP - 1, &mut commands);
    }

    // 3. claude commands (recursive, dir:name aliases).
    let claude_project = Path::new(project_path).join(".claude").join("commands");
    scan_claude_dir(&claude_project, "claude", PRIORITY_CLAUDE, &mut commands);
    if let Some(home) = home_dir() {
        let claude_user = home.join(".claude").join("commands");
        scan_claude_dir(&claude_user, "claude", PRIORITY_CLAUDE - 1, &mut commands);
    }

    // 4. codex commands.
    let codex_project = Path::new(project_path).join(".codex").join("commands");
    scan_md_dir(&codex_project, "codex", PRIORITY_CODEX, &mut commands);
    if let Some(home) = home_dir() {
        let codex_user = home.join(".codex").join("commands");
        scan_md_dir(&codex_user, "codex", PRIORITY_CODEX - 1, &mut commands);
    }

    // Deduplicate: first-wins by priority (highest priority number first).
    commands.sort_by(|a, b| b.priority.cmp(&a.priority));
    let mut seen: HashMap<String, usize> = HashMap::new();
    for (i, cmd) in commands.iter_mut().enumerate() {
        if let Some(&first_idx) = seen.get(&cmd.name) {
            // This command is shadowed by the one at first_idx.
            cmd.shadowed = true;
            let _ = first_idx;
        } else {
            seen.insert(cmd.name.clone(), i);
        }
    }

    commands
}

/// Merge MCP prompt commands into a discovered command list.
///
/// MCP prompts are dynamic (require a live connection) so they're added after
/// the static `discover_commands` call. On name collision with an existing
/// command (builtin, file-based, or another MCP prompt), the MCP prompt is
/// prefixed with its server name: `/<server>-<prompt-name>`.
///
/// Each MCP prompt entry carries the server name so the caller can route the
/// command to `mcp_get_prompt` with the correct server.
pub fn merge_mcp_prompts(
    mut commands: Vec<SlashCommand>,
    mcp_prompts: &[(String, String, String)],
) -> Vec<SlashCommand> {
    // Build the set of existing command names for collision detection.
    let mut existing: std::collections::HashSet<String> = commands.iter().map(|c| c.name.clone()).collect();

    for (server, prompt_name, description) in mcp_prompts {
        let name = if existing.contains(prompt_name) {
            // Collision — prefix with server name.
            let prefixed = format!("{server}-{prompt_name}");
            if existing.contains(&prefixed) {
                // Still collides — skip. First-wins.
                continue;
            }
            prefixed
        } else {
            prompt_name.clone()
        };

        existing.insert(name.clone());
        commands.push(SlashCommand {
            name,
            description: description.clone(),
            source: "mcp".to_string(),
            priority: PRIORITY_MCP,
            shadowed: false,
            file_path: None,
            body: None,
        });
    }

    // Re-sort so MCP commands sort after higher-priority sources.
    commands.sort_by(|a, b| b.priority.cmp(&a.priority));
    // Re-mark shadowed status.
    let mut seen: HashMap<String, usize> = HashMap::new();
    for (i, cmd) in commands.iter_mut().enumerate() {
        if let Some(&first_idx) = seen.get(&cmd.name) {
            cmd.shadowed = true;
            let _ = first_idx;
        } else {
            cmd.shadowed = false;
            seen.insert(cmd.name.clone(), i);
        }
    }

    commands
}

/// The builtin command manifest: commands that execute UI actions immediately
/// rather than expanding into a prompt.
fn builtin_commands() -> Vec<(String, String)> {
    vec![
        ("login".to_string(), "Open the provider login/connect flow".to_string()),
        ("model".to_string(), "Open the model picker".to_string()),
        ("models".to_string(), "Refresh or list available models".to_string()),
        ("mcp".to_string(), "Open MCP server management".to_string()),
        ("plan".to_string(), "Plan pipeline actions (list, run, status)".to_string()),
        ("idea".to_string(), "Idea pipeline actions (generate, promote)".to_string()),
        ("openspec".to_string(), "OpenSpec artifact actions".to_string()),
    ]
}

/// Scan a directory for `*.md` command files. Non-recursive.
fn scan_md_dir(dir: &Path, source: &str, priority: u32, out: &mut Vec<SlashCommand>) {
    if !dir.is_dir() {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Some(cmd) = parse_command_file(&path, source, priority) {
            out.push(cmd);
        }
    }
}

/// Scan a directory recursively for `*.md` command files. Files in
/// subdirectories get `dir:name` aliases (e.g. `frontend/lint.md` →
/// `frontend:lint`).
fn scan_claude_dir(dir: &Path, source: &str, priority: u32, out: &mut Vec<SlashCommand>) {
    if !dir.is_dir() {
        return;
    }
    scan_claude_dir_recursive(dir, dir, source, priority, out);
}

fn scan_claude_dir_recursive(
    current: &Path,
    root: &Path,
    source: &str,
    priority: u32,
    out: &mut Vec<SlashCommand>,
) {
    let entries = match std::fs::read_dir(current) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_claude_dir_recursive(&path, root, source, priority, out);
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        if let Some(mut cmd) = parse_command_file(&path, source, priority) {
            // Apply dir:name alias if the file is in a subdirectory.
            if let Ok(rel) = path.strip_prefix(root) {
                let rel_parent = rel.parent();
                if let Some(parent) = rel_parent {
                    if !parent.as_os_str().is_empty() {
                        let dir_name = parent
                            .components()
                            .next()
                            .and_then(|c| c.as_os_str().to_str())
                            .unwrap_or("");
                        if !dir_name.is_empty() {
                            cmd.name = format!("{}:{}", dir_name, cmd.name);
                        }
                    }
                }
            }
            out.push(cmd);
        }
    }
}

/// Parse a markdown command file: extract frontmatter (name, description)
/// and the body template. Name defaults to the filename without extension.
fn parse_command_file(path: &Path, source: &str, priority: u32) -> Option<SlashCommand> {
    let content = std::fs::read_to_string(path).ok()?;
    let (frontmatter, body) = split_frontmatter(&content);
    let default_name = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("command")
        .to_string();
    let name = frontmatter
        .get("name")
        .cloned()
        .unwrap_or(default_name);
    let description = frontmatter
        .get("description")
        .cloned()
        .unwrap_or_default();
    Some(SlashCommand {
        name,
        description,
        source: source.to_string(),
        priority,
        shadowed: false,
        file_path: Some(path.to_string_lossy().to_string()),
        body: Some(body),
    })
}

/// Split a markdown file into frontmatter (YAML between `---` lines) and body.
/// Returns (frontmatter_map, body_string).
fn split_frontmatter(content: &str) -> (HashMap<String, String>, String) {
    let mut frontmatter = HashMap::new();
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (frontmatter, content.to_string());
    }
    // Find the closing `---`.
    let after_open = &trimmed[3..];
    let close = match after_open.find("\n---") {
        Some(idx) => idx,
        None => return (frontmatter, content.to_string()),
    };
    let yaml_block = &after_open[..close];
    let body_start = close + 4; // skip "\n---"
    let body = after_open[body_start..].trim_start_matches('\n').to_string();

    // Parse simple key: value YAML (no nested structures for command frontmatter).
    for line in yaml_block.lines() {
        let line = line.trim();
        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim().to_string();
            let value = value.trim().trim_matches('"').trim_matches('\'').to_string();
            if !key.is_empty() {
                frontmatter.insert(key, value);
            }
        }
    }
    (frontmatter, body)
}

/// Parse user input into arguments using quote-aware splitting. Handles
/// double-quoted arguments containing spaces.
pub fn parse_arguments(input: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    for ch in input.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            ' ' | '\t' if !in_quotes => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

/// Expand a command's body template with user arguments. Supports:
/// - `$1`, `$2`, … `$n` — positional arguments
/// - `$@` / `$ARGUMENTS` — all arguments joined with spaces
/// - `$@[start]` / `$@[start:len]` — sliced argument ranges
/// - No placeholder → arguments appended to the body
pub fn expand_template(body: &str, args: &[String]) -> String {
    let has_placeholder = body.contains("$1")
        || body.contains("$@")
        || body.contains("$ARGUMENTS")
        || body.contains("$2");

    if !has_placeholder {
        // No placeholder: append arguments to the body.
        if args.is_empty() {
            return body.to_string();
        }
        return format!("{body}\n\n{}", args.join(" "));
    }

    let mut result = body.to_string();

    // Replace positional $1..$n.
    for (i, arg) in args.iter().enumerate() {
        let placeholder = format!("${}", i + 1);
        result = result.replace(&placeholder, arg);
    }
    // Replace unfilled positional placeholders with empty string.
    // Iterate upward until no more $N placeholders are found.
    let mut idx = args.len() + 1;
    loop {
        let placeholder = format!("${idx}");
        if !result.contains(&placeholder) {
            break;
        }
        result = result.replace(&placeholder, "");
        idx += 1;
    }

    // Replace $@ and $ARGUMENTS with all args joined. Must replace $@ AFTER
    // $ARGUMENTS so the latter's replacement doesn't get caught. And must
    // replace bare $@ before expand_sliced_at handles $@[...].
    let all_args = args.join(" ");
    result = result.replace("$ARGUMENTS", &all_args);
    // Replace bare $@ (not followed by [).
    // Use a simple approach: replace $@ that isn't $@[
    result = replace_bare_at(&result, &all_args);

    // Handle $@[start] and $@[start:len] slices.
    result = expand_sliced_at(&result, args);

    result
}

/// Replace `$@` (not followed by `[`) with the joined args.
fn replace_bare_at(text: &str, replacement: &str) -> String {
    let mut result = String::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '$' {
            match chars.peek() {
                Some('@') => {
                    // Look ahead: is the next char after @ a [?
                    let mut lookahead = chars.clone();
                    lookahead.next(); // consume @
                    if lookahead.peek() == Some(&'[') {
                        // This is $@[...], don't replace here.
                        result.push('$');
                    } else {
                        // Bare $@, replace.
                        chars.next(); // consume @
                        result.push_str(replacement);
                    }
                }
                _ => result.push('$'),
            }
        } else {
            result.push(ch);
        }
    }
    result

}

/// Expand `$@[start]` and `$@[start:len]` placeholders.
fn expand_sliced_at(text: &str, args: &[String]) -> String {
    let mut result = String::new();
    let mut remaining = text;

    loop {
        // Find $@[ ... ]
        let at_pos = match remaining.find("$@[") {
            Some(pos) => pos,
            None => {
                result.push_str(remaining);
                break;
            }
        };
        result.push_str(&remaining[..at_pos]);
        let after = &remaining[at_pos + 3..]; // skip "$@["
        let close = match after.find(']') {
            Some(pos) => pos,
            None => {
                // No closing bracket; treat as literal.
                result.push_str("$@[");
                result.push_str(after);
                break;
            }
        };
        let spec = &after[..close];
        remaining = &after[close + 1..];

        // Parse spec: "start" or "start:len"
        let (start, len) = if let Some((s, l)) = spec.split_once(':') {
            let start: usize = s.parse().unwrap_or(0);
            let len: usize = l.parse().unwrap_or(0);
            (start, Some(len))
        } else {
            (spec.parse().unwrap_or(0), None)
        };

        let sliced: Vec<&String> = args.iter().skip(start).take(len.unwrap_or(args.len())).collect();
        result.push_str(&sliced.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(" "));
    }

    result
}

/// Get the user's home directory.
fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_arguments_splits_on_whitespace() {
        assert_eq!(parse_arguments("hello world"), vec!["hello", "world"]);
        assert_eq!(parse_arguments("  a  b  c  "), vec!["a", "b", "c"]);
    }

    #[test]
    fn parse_arguments_handles_quoted_strings() {
        assert_eq!(
            parse_arguments(r#""src/main file.rs" output"#),
            vec!["src/main file.rs", "output"]
        );
        assert_eq!(parse_arguments(r#""hello world""#), vec!["hello world"]);
    }

    #[test]
    fn parse_arguments_handles_empty_input() {
        assert!(parse_arguments("").is_empty());
        assert!(parse_arguments("   ").is_empty());
    }

    #[test]
    fn expand_template_positional_replacement() {
        let body = "Fix issue #$1 with priority $2";
        let args = vec!["123".to_string(), "high".to_string()];
        assert_eq!(expand_template(body, &args), "Fix issue #123 with priority high");
    }

    #[test]
    fn expand_template_unfilled_positional_becomes_empty() {
        let body = "Fix issue #$1 with priority $2";
        let args = vec!["123".to_string()];
        assert_eq!(expand_template(body, &args), "Fix issue #123 with priority ");
    }

    #[test]
    fn expand_template_all_arguments() {
        let body = "Summarize: $ARGUMENTS";
        let args = vec!["the".to_string(), "whole".to_string(), "thing".to_string()];
        assert_eq!(expand_template(body, &args), "Summarize: the whole thing");
    }

    #[test]
    fn expand_template_at_sign_all_arguments() {
        let body = "Review: $@";
        let args = vec!["src/main.rs".to_string(), "src/lib.rs".to_string()];
        assert_eq!(expand_template(body, &args), "Review: src/main.rs src/lib.rs");
    }

    #[test]
    fn expand_template_sliced_at_from_start() {
        let body = "Args: $@[1]";
        let args = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        assert_eq!(expand_template(body, &args), "Args: b c");
    }

    #[test]
    fn expand_template_sliced_at_with_length() {
        let body = "Args: $@[0:2]";
        let args = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        assert_eq!(expand_template(body, &args), "Args: a b");
    }

    #[test]
    fn expand_template_no_placeholder_appends_args() {
        let body = "Just a body with no placeholders";
        let args = vec!["extra".to_string(), "args".to_string()];
        assert_eq!(
            expand_template(body, &args),
            "Just a body with no placeholders\n\nextra args"
        );
    }

    #[test]
    fn expand_template_no_placeholder_no_args_returns_body() {
        let body = "Just a body";
        assert_eq!(expand_template(body, &[]), body);
    }

    #[test]
    fn split_frontmatter_parses_name_and_description() {
        let content = "---\nname: my-command\ndescription: Does a thing\n---\n# Body\nHello";
        let (fm, body) = split_frontmatter(content);
        assert_eq!(fm.get("name").unwrap(), "my-command");
        assert_eq!(fm.get("description").unwrap(), "Does a thing");
        assert_eq!(body, "# Body\nHello");
    }

    #[test]
    fn split_frontmatter_no_frontmatter_returns_body() {
        let content = "# Just markdown\nNo frontmatter";
        let (fm, body) = split_frontmatter(content);
        assert!(fm.is_empty());
        assert_eq!(body, content);
    }

    #[test]
    fn split_frontmatter_handles_quoted_values() {
        let content = "---\nname: \"quoted name\"\ndescription: 'single quoted'\n---\nBody";
        let (fm, _) = split_frontmatter(content);
        assert_eq!(fm.get("name").unwrap(), "quoted name");
        assert_eq!(fm.get("description").unwrap(), "single quoted");
    }

    #[test]
    fn discover_commands_includes_builtins() {
        let commands = discover_commands("/nonexistent/path");
        assert!(commands.iter().any(|c| c.name == "login" && c.source == "builtin"));
        assert!(commands.iter().any(|c| c.name == "model" && c.source == "builtin"));
        assert!(commands.iter().any(|c| c.name == "plan" && c.source == "builtin"));
    }

    #[test]
    fn discover_commands_marks_shadows() {
        // Create a temp project with an omp command that shadows a builtin.
        let tmp = std::env::temp_dir().join(format!(
            "bb-cmd-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let omp_dir = tmp.join(".omp/commands");
        std::fs::create_dir_all(&omp_dir).unwrap();
        // Create a "model" command that shadows the builtin.
        std::fs::write(
            omp_dir.join("model.md"),
            "---\nname: model\ndescription: Custom model picker\n---\nCustom body",
        )
        .unwrap();

        let commands = discover_commands(tmp.to_str().unwrap());
        let model_cmds: Vec<&SlashCommand> = commands.iter().filter(|c| c.name == "model").collect();
        assert!(model_cmds.len() >= 2, "should have builtin + omp model commands");

        // The builtin (priority 100) should not be shadowed; the omp (priority 90) should be.
        let builtin = model_cmds.iter().find(|c| c.source == "builtin").unwrap();
        let omp = model_cmds.iter().find(|c| c.source == "omp").unwrap();
        assert!(!builtin.shadowed, "builtin is not shadowed");
        assert!(omp.shadowed, "omp is shadowed by builtin");

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
