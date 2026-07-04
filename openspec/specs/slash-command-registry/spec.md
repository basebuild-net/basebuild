# slash-command-registry Specification

## Requirements
### Requirement: Provider-based command discovery
The system SHALL discover slash commands from prioritized providers, deduplicated by command name with first-wins semantics (mirroring oh-my-pi): builtin UI commands (priority 100), project `.omp/commands/*.md` then user `~/.omp/agent/commands/*.md` (90), `.claude/commands/**/*.md` user and project with `dir:name` namespaced aliases (80), `.codex/commands/*.md` (70), skill commands `/skill:<name>` (60), and MCP prompt commands (50). Shadowed duplicates SHALL remain inspectable in a command list UI.

#### Scenario: Project command shadows user command
- **WHEN** `<project>/.omp/commands/review.md` and `~/.omp/agent/commands/review.md` both exist
- **THEN** `/review` executes the project version and the command list shows the user version as shadowed

#### Scenario: Discovery refresh
- **WHEN** the active project changes or the user triggers a command refresh
- **THEN** file-based commands are rescanned; no continuous file watcher is required

### Requirement: Markdown command format and expansion
File-based commands SHALL support YAML frontmatter (`name`, `description`; name defaults to filename) and body templates expanded with positional `$1..$n`, slice `$@[start]`/`$@[start:length]`, and aggregate `$ARGUMENTS`/`$@` replacements using quote-aware argument parsing. When a template uses no placeholder, arguments SHALL be appended.

#### Scenario: Positional expansion
- **WHEN** `/fix-issue 123 high` invokes a command body containing `Fix issue #$1 with priority $2`
- **THEN** the prompt sent to the harness is `Fix issue #123 with priority high`

#### Scenario: Quoted arguments
- **WHEN** the user types `/summarize "src/main file.rs"`
- **THEN** `$1` expands to `src/main file.rs` as a single argument

### Requirement: Composer integration
The chat composer SHALL show an autocomplete popup when input begins with `/`, listing matching commands with descriptions and source badges, keyboard-navigable. Builtin commands (`/login`, `/model`, `/models refresh`, `/mcp`, `/plan`, `/idea`, `/openspec`, `/skill:<name>`) SHALL execute UI actions immediately; file/MCP-prompt commands SHALL expand into the outgoing prompt.

#### Scenario: Autocomplete
- **WHEN** the user types `/re` in the composer
- **THEN** a popup lists commands starting with `re` (e.g. `/review`) with description and source, and Enter/Tab completes the selection

#### Scenario: Builtin plan commands
- **WHEN** the user runs `/plan list`, `/plan run <ref>`, `/idea generate`, or `/openspec <ref>`
- **THEN** the corresponding pipeline UI action executes without sending the command text to the provider

### Requirement: Unknown command fallthrough
Unknown `/text` input SHALL NOT hard-fail. The composer SHALL indicate no command matched and allow sending the literal text to the model with one action, matching oh-my-pi's fallthrough semantics.

#### Scenario: Unknown command
- **WHEN** the user submits `/frobnicate now` and no command named `frobnicate` exists
- **THEN** the composer shows "no matching command" with a send-as-text action, and never silently drops the input

### Requirement: Skill commands
When skills are available, each SHALL be invokable as `/skill:<name> [args]`, injecting the skill body (frontmatter stripped) plus optional user args into the conversation context.

#### Scenario: Skill invocation
- **WHEN** the user runs `/skill:basebuild-session-title retitle this`
- **THEN** the skill content is injected as context with the args noted, and the turn proceeds with the bound model
