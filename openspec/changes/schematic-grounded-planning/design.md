# Design: Schematic-Grounded Planning

## Context

`ProjectSchematicTab.tsx` renders the schematic as a raw `<pre>`; `schematic_service.rs` is read/exists/write only. `pipeline_service.rs` builds categories/ideas from hardcoded prompt strings; `unified-planning-workspace` (prerequisite) made generation a visible chat turn with tunable prompts and a `Plans/Ideas/Categories` inspector, but seeds hardcoded default categories and still ships the legacy `GeneratePlanModal.tsx` (goal input, mode picker, file-context picker) plus "Generate plans" buttons in `PlanPanel.tsx`/`SidePanel.tsx`. The `basebuild-planning` and `basebuild-project-schematic` skills (shipped by `basebuild-planning-skill`) define the planning workflow contract but the app does not execute them. Owner direction (2026-07-05): the app has two primary features — the schematic wizard and schematic-grounded planning; no input boxes in the inspector; no hardcoded categories; blueprints per project archetype; time-boxed end goals with nudges; plain words AI-enhanced into agentic-optimized text.

## Goals / Non-Goals

**Goals**:
- Schematic as the app's grounding instrument: validated, structured, visible, wizard-maintained.
- Planning generation that executes the bundled skills agentically and cites its grounding.
- Zero hardcoded planning taxonomy; blueprint- and goal-aware focus.
- Remove the legacy generate-plans input surfaces.

**Non-Goals**:
- `.basebuild` planning-file write-through from the app (queued separately as `planning-file-ingestion`).
- App plan status rename (`plan-status-rename`, queued).
- General session context injection (`harness-context-files` owns system-prompt assembly for all chats; this change owns planning turns).
- Multi-schematic / per-subproject schematics.

## Decisions

1. **Skill files are the single source of generation instructions.** `planning_prompt_service` derives planning defaults from bundled skill content at read time (existing `read_skill` path); overrides still win; `chat_system` stays compiled. — **Rationale**: one contract for in-app and standalone use; no dual maintenance. **Alternative**: keep compiled prompts synced by hand — rejected (drift is certain).
2. **In-app skill execution adapts persistence, not workflow.** Planning turns follow the skills' workflow and grounding rules, but capture through the app's structured tool into the SQLite catalog. File write-through to `.basebuild/ideas|plans` stays in `planning-file-ingestion`. — **Rationale**: one behavioral contract, storage evolves separately; keeps this change shippable.
3. **Deterministic health, semantic quality on demand.** Parsing/validation is pure Rust (section presence, placeholder detection, end-goal dates) with unit tests; no model calls. Judging whether content is *good* is the schematic skill's re-align job, launched from the wizard. — **Rationale**: cheap, offline, testable badge; the expensive judgment is explicit and user-triggered.
4. **Template v2.1 adds `Blueprint` and `End goals`** sections (archetype, team size, stage; `End goal of <period>: …`). Parser treats them like any section; legacy schematics report them `missing` (health at most `partial`), which powers the nudges without migrations. Blueprint archetypes are an open set — the skill's questioning adapts; the app stores whatever the section says (no enum in Rust).
5. **Anchors as data, not enforcement.** `ideas.grounding` (required by the capture tool) + `ideas.anchor` (optional) additive columns; UI flags `outside current focus` when anchor is null. Generation is soft-gated on schematic health (warn + offer wizard, proceed allowed). — **Rationale**: keep the user in charge; make drift visible instead of forbidden. **Alternative**: hard-block ungrounded generation — rejected (empty/young projects must still work).
6. **Modal removal is a clean cutover.** `GeneratePlanModal.tsx`, its open-buttons, and the Settings copy referencing it are deleted; the removed spec requirements are restated as `Plan Generation Auditability` (agentic-turn era) and `Input-free planning inspector`. Proposal-card requirements (`Structured plan proposal capture`, `Proposal selection state persists`) are removed as superseded by the ideas catalog. — **Rationale**: pre-1.0, no external consumers; two entry points (chat menu, inspector buttons) replace three overlapping ones.
7. **Enhance is a diff, never a write.** Per-section AI enhancement renders before/after and applies only on approval, matching the schematic skill's approval-gated write rule and AGENTS.md invariant 5.

## Risks / Trade-offs

- **Skill prose as prompts** may be longer than tuned strings → derive per-kind extracts (named workflow sections), not whole files; token cost bounded; overrides remain the escape hatch.
- **Placeholder detection heuristics** can misclassify → keep rules simple (empty body, template scaffold markers like `<…>`), show per-section state so misclassification is visible and correctable in one click.
- **Agentic turns are slower than one-shot prompts** → reads are visible progress (better perceived latency than a fake spinner); instructions cap the read set (schematic, conventions, manifests, catalog).
- **Stale-goal nudges depend on parseable periods** → accept `<year>` and `<month> <year>` forms; anything unparseable is treated as present-but-undated (no stale nudge, still counts as filled).
- **Existing seeded categories** linger in old sessions → kept as user data; only the seeding path is removed.

## Migration Plan

Additive `ideas.grounding`/`ideas.anchor` columns; no destructive DB changes. Delete `GeneratePlanModal.tsx` + generate buttons in the same commit as the inspector/menu replacements so no dead entry points ship. Skill template updates land with the app changes (bundled skills ship in the installer). Rollback: revert the commit; DB columns are additive and ignorable.

## Open Questions

- None blocking. Blueprint archetype question set beyond SaaS/game/CLI/library/app/site can grow in the skill without app changes.

## Compatibility (api-design review)

Three compatibility surfaces, judged for a pre-1.0 (`v0.0.x`), local-first,
single-user desktop app where the React frontend and Rust backend ship in one
installer (no independent version skew) and there are no external API consumers.

| Surface | Change | Verdict |
|---|---|---|
| **Persistence (wire)** | `ideas.grounding` / `ideas.anchor` added | **Extend-only.** Additive nullable columns; old rows read fine (backward-compatible), and a hypothetical older build ignores unknown columns (forward-compatible). No destructive migration. |
| **Tauri command surface** (TS↔Rust internal API) | `schematic_inspect` added; generate-plans-modal commands removed | **Additive + safe removal.** New command is extend-only. Removed commands have exactly one caller — the deleted modal — shipped in the same binary; frontend/backend upgrade atomically, so removal cannot strand a caller. |
| **Behavior / UI** | default category seeding removed; `GeneratePlanModal` removed | **Clean cutover, justified.** Pre-1.0, no external consumers, no deprecation obligation. Existing seeded categories in old sessions are preserved as user data (not retro-deleted), so no user loses state. |

Deviations from strict extend-only are deliberate and bounded: the removals are
internal, single-binary, pre-1.0 surfaces with zero external consumers, which is
the documented exception to the extend-only deprecation cycle. The one durable
contract — the SQLite catalog — is evolved additively. Skill-derived prompt
defaults are read at runtime, so bundled-skill updates propagate without any
migration (a compatible, versionless default source).
