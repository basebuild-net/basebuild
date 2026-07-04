## ADDED Requirements

### Requirement: Context file discovery
The system SHALL discover context files by walking from the project directory up to the repository root (or the project directory alone when not a git repo): `AGENTS.md` at each level, with `CLAUDE.md` used at a level only when no `AGENTS.md` exists there. Directories whose name starts with a dot SHALL be skipped. `.basebuild/project-schematic.md` SHALL be discovered when present.

#### Scenario: Walk-up discovery
- **WHEN** a session starts in `<repo>/packages/app` with AGENTS.md at the repo root and in `packages/app`
- **THEN** both files are discovered, ordered root-first

#### Scenario: CLAUDE.md fallback
- **WHEN** a level has `CLAUDE.md` but no `AGENTS.md`
- **THEN** `CLAUDE.md` is used for that level; when both exist, only `AGENTS.md` is used

### Requirement: Caching and refresh
Discovery results SHALL be cached per project keyed by file mtimes, recomputed on session create when stale, and refreshable on demand. A changed context file SHALL NOT retroactively alter an existing session's already-sent prompt; it applies from the next assembly.

#### Scenario: Stale cache refresh
- **WHEN** AGENTS.md is edited and a new session starts
- **THEN** the new session's prompt reflects the edited content without app restart

### Requirement: Source toggles
Per-project settings SHALL allow disabling each source (context files, schematic, skills list) independently; disabled sources are omitted from assembly and inspection shows them as disabled rather than missing.

#### Scenario: Schematic disabled
- **WHEN** the user disables schematic injection for a project
- **THEN** new sessions omit the schematic part and the context inspector marks it disabled
