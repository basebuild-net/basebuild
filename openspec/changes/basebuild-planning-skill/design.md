# Design: Basebuild Planning Skill

## Context

The app's pipeline (`plan-pipeline-harness`, `planning-system-qol`) lives in SQLite + panels. On disk, `.basebuild/` holds `project-schematic.md` plus app-created `config.toml` (TOML: `version`, `active_pack`, `[project]`), `prompts/`, `workflows/`, `cache/`, `logs/`, and a `.gitignore` covering `cache/ logs/ runs/ state.db` (`project_service.rs`). No file schema exists for ideas/plans/categories — this change defines it as the interop contract the app can adopt later. `read_skill` (`commands/skills.rs`) parses only single-line `name`/`description` frontmatter. The old `basebuild-idea-generation` skill predates the status migrations. Owner decisions (2026-07-05): replace the old skill; single `basebuild-planning` skill; markdown + YAML frontmatter; folder-per-plan artifacts; skill-based engine detection; full lifecycle scope; status word `planned` instead of `openspec`; plans authored by a strong model for weaker executors.

## Goals / Non-Goals

**Goals**:
- One portable planning skill: categories → ideas → iterative picking → plans → lifecycle.
- `.basebuild/` file schema as the durable, git-visible source of truth.
- Executor-proof plan artifacts (strong planner, weak executor).
- Engine pluggability without hardcoding foreign tools.
- Schematic skill v2 that captures fundamentals (including Vision) and re-aligns them against reality.

**Non-Goals**:
- App code changes, SQLite sync, or UI work.
- Importing pre-existing external plans (separate follow-up command).
- Replacing OpenSpec — it remains a first-class engine choice.
- Rewriting this repo's own schematic (owner approval required; separate action).

## Decisions

1. **Status word `planned`** (file schema) replaces `openspec` — engine-neutral, describes "clearly thought out, artifacts complete". **Alternatives**: `specced`, `shaped`, `refined` — all jargon-heavier. **Mapping**: file `planned` ⇔ app DB `openspec` until a follow-up app migration renames it; AGENTS.md Invariant 9 governs the app and is intentionally untouched here.
2. **Markdown + YAML frontmatter; folder-per-plan** — human-readable, git-diffable, checkbox progress parseable by regex (same approach the app already uses for openspec tasks). **Alternative**: JSON indexes — hostile to hand-editing and merges.
3. **`[planning]` table in the existing `config.toml`** — the app already owns a TOML config in `.basebuild/`; a second config file/format would create a parallel convention. The skill merges the table textually and never touches other keys. **Alternative**: new `config.yaml` — rejected as a second convention.
4. **Skill-based engine detection** — the harness already exposes available skills to the agent; probing for foreign plan directories is unreliable and explicitly descoped by the owner. `engine` stores a skill name; only OpenSpec's well-known artifact path is special-cased for the `external` pointer. Plan slugs follow openspec change-name rules (kebab-case, 2–4 words) so external promotion reuses the slug as the change name.
5. **Planning/execution model split** — planning assumes the strongest available model; artifacts must survive execution by weaker models with zero conversation context. This drives the executor-proof spec requirement: conventions restated inline, per-task acceptance criteria, per-phase verification commands, explicit guardrails.
6. **Replace `basebuild-idea-generation`** — stale statuses, app-only output contract. The `official.idea-generation` config-pack id (`config_pack_service.rs`) is a different subsystem and keeps its name.
7. **Upgrade `basebuild-project-schematic` in place** (keep directory/name) — adds Vision section, repository-fact prefill, re-alignment mode, planning pairing. **Alternative**: a new skill name — churn plus two overlapping schematic skills.
8. **Plan record always owns lifecycle** — even with an external engine, `plans/<slug>/plan.md` carries `status`; external artifacts carry content. Keeps the status board engine-agnostic and gives the app one place to read.

## Risks / Trade-offs

- **Status-name divergence** (file `planned` vs DB `openspec`) → documented mapping here; follow-up rename change queued in ROADMAP Proposed; statuses otherwise identical.
- **App will later parse these files** → keys stay flat scalars/lists; `references/schema.md` is normative; changes to it are spec changes.
- **In-flight `planning-system-qol`** touches ideas/plans in SQLite and planning UI → no file-path overlap; coordination point is the future ingestion follow-up, not this change.
- **Skill bloat** → SKILL.md stays lean (workflow + rules); exact formats/templates live in `references/` loaded on demand.
- **Interactive loops vary by harness** → the skill specifies conversational prompts (numbered picks), not harness-specific UI, so any chat-capable harness works.

## Migration Plan

Single commit/PR: new planning skill + schematic v2 + old skill deletion (installer bundles `skills/` wholesale, so the bundle self-corrects). No data migration — no `.basebuild/ideas|plans` exist in the wild yet. Rollback: revert the commit; no persistent state outside the repo. Follow-ups for ROADMAP Proposed: app DB rename `openspec → planned`; app ingestion of the file schema; external-plan import command.

## Open Questions

- None blocking. Owner confirmed scope (full lifecycle), status word, storage format, engine detection, and schematic pairing on 2026-07-05.
