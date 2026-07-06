# Proposal: Basebuild Planning Skill

## Why

The idea→plan pipeline only exists inside the desktop app (SQLite + panels); nothing works from a plain agent harness, and the bundled `basebuild-idea-generation` skill is stale — it predates the `concept → picked → archived` migration and outputs to an app-only contract instead of files. We want one portable skill that runs the full loop — categories → ideas → iterative picking → executor-proof plans — storing everything under `.basebuild/` so agents, humans, and (later) the app share a single file-based source of truth. The schematic skill that feeds this loop with project fundamentals predates the planning system and lacks a way to detect drift between the schematic and reality.

## What Changes

- Add `skills/basebuild-planning/` — a standard `SKILL.md` (frontmatter: `name`, `description` only) plus on-demand `references/schema.md` and `references/templates.md`; portable across OMP, Claude Code, opencode, and the app's `read_skill`.
- Define the `.basebuild/` planning file schema: `categories.md`, `ideas/<slug>.md` (frontmatter + body), `plans/<slug>/` folders (`plan.md` + `tasks.md` + optional `design.md`), `plans/archive/`, and a `[planning]` table merged into the existing `.basebuild/config.toml`.
- File-schema lifecycles: ideas `concept → picked → archived`; plans `draft → planned → ready → running → finished` with `cancelled` reachable from any non-terminal status. `planned` (artifacts complete and thought out; engine-neutral) replaces the app's `openspec` status name in the file schema.
- Pluggable planning engines: native artifact generation by default; planning skills detected from the harness (e.g. OpenSpec `propose`) offered once and persisted; the plan record file owns lifecycle regardless of engine.
- Executor-proof planning bar: artifacts are written by the strongest available model and must be self-contained — embedded constraints, exact paths, per-task acceptance criteria, verification commands — so weaker executing models cannot drift.
- Rework `skills/basebuild-project-schematic/` (v2): questionnaire (create), section-by-section update, and a new **re-alignment** mode that diffs the schematic against repo reality and `.basebuild` planning data; template gains a `## Vision` section (what the project should become); explicit pairing with the planning skill (schematic feeds categories/ideas; finished plans trigger a re-alignment offer).
- **BREAKING** Remove `skills/basebuild-idea-generation/` (superseded; pre-migration statuses, app-only output contract).

Out of scope (follow-ups, not this change):

- App-side ingestion/sync of `.basebuild` planning files into SQLite.
- App DB/UI status rename `openspec → planned` (AGENTS.md Invariant 9 stays as-is until then; design.md records the mapping).
- Importing pre-existing external plans into `.basebuild` (separate command/feature).
- Updating this repo's own `.basebuild/project-schematic.md` to the v2 template (requires explicit owner approval per AGENTS.md).

## Capabilities

### New Capabilities

- `planning-file-schema` — the `.basebuild/` planning data formats and their invariants.
- `planning-skill-workflow` — the portable planning skill's behavior: analysis, categories, ideation loop, engines, promotion, lifecycle.
- `schematic-skill-workflow` — the schematic skill's behavior: questionnaire, update, re-alignment, planning pairing.

### Modified Capabilities

- None. `chat-idea-generation`, `plan-pipeline`, and `openspec-artifacts` describe the app's SQLite/UI surface and are untouched by this file-based skill work.

## Impact

- New: `skills/basebuild-planning/SKILL.md`, `skills/basebuild-planning/references/schema.md`, `skills/basebuild-planning/references/templates.md`.
- Modified: `skills/basebuild-project-schematic/SKILL.md` (v2 rework, name kept — no reference churn).
- Removed: `skills/basebuild-idea-generation/` (no code references it; the `official.idea-generation` config-pack id in `config_pack_service.rs` is a separate subsystem and keeps its name).
- No Rust/TS changes. Installer skill bundling picks up the change automatically (bundles `skills/` wholesale).
- Docs: AGENTS.md skills references where present, `openspec/ROADMAP.md` (Invariant 12).
