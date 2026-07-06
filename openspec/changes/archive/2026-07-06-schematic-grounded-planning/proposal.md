# Proposal: Schematic-Grounded Planning

## Why

The schematic is supposed to keep the project grounded — the precise statement of what the project is, its niche, its primary goal — but today it is a raw `<pre>` dump with no validation, and planning barely uses it. Category generation ships hardcoded seed defaults (SEO, Optimization, Design, New Features) that ignore the project's domain; generation prompts are bespoke strings in Rust instead of the skill workflows that define planning; the right panel still carries a legacy "Generate plans" modal full of input boxes; and nothing checks whether the schematic exists, is filled out, or has time-boxed goals before the app generates work from it. The result drifts toward generic feature production instead of the core MVP.

This change reshapes the app around **two primary features**: a **schematic wizard** that captures the project's structure, approach, blueprint, and end goals; and **schematic-grounded planning** that builds categories, ideas, and plans strictly around that schematic.

## What Changes

- **Schematic wizard (pillar 1).** Create / edit / re-align flows driven by the `basebuild-project-schematic` skill as visible chat turns. The wizard opens with blueprint questions — project archetype (SaaS, game, CLI, library, app, …), team size (solo dev vs N people), stage — and applies archetype-appropriate, real-world-blueprint questioning. Users answer in simple words; a per-section **Enhance** action turns plain words into agentic-optimized descriptions, approval-gated with a shown diff.
- **Blueprint and End goals in the schematic.** The template gains `## Blueprint` (archetype, team size, stage) and `## End goals` — time-boxed goals like `End goal of 2026: …` / `End goal of July 2026: …`. Nudge UI: when a year-end or month-end goal is missing or its period has passed, the app shows "Set a year-end and a month-end goal to keep things on track."
- **Schematic inspector.** Deterministic Rust parsing + validation of the schematic into template sections (per-section `filled` / `placeholder` / `missing`; overall health `complete` / `partial` / `missing`). The schematic tab renders **structured section cards by default** (raw markdown as a toggle); health badges surface in the schematic tab and planning inspector.
- **Skill-driven generation (pillar 2).** Planning generation turns derive their instructions from the bundled skills read at request time — the same contract that runs in any harness — replacing hardcoded prompt strings. Planning Settings overrides still win.
- **No hardcoded categories.** **BREAKING (behavioral):** default category seeding is removed. Categories are project-derived (schematic blueprint, Vision, priorities); the empty state offers "Generate categories from project" and manual add — never generic seeds.
- **Agentic context gathering.** Generation runs as a real agent turn with tool access (including MCP tools through the existing gateway): the model reads the schematic, conventions, manifests, and existing catalog before proposing; reads are visible in the transcript.
- **Grounding anchors.** Every captured idea carries `grounding` (evidence) and an optional `anchor` (the Vision element, End goal, or Current priority it serves). No anchor ⇒ flagged **outside current focus**. Anti-feature-creep becomes a property of the data.
- **Right panel loses its input boxes.** **BREAKING (UI):** the `Generate plans` modal (`GeneratePlanModal.tsx` — goal input, mode picker, file-context picker) and the panel's "Generate plans" buttons are removed. The planning inspector is a catalog: it views and acts on plans/ideas/categories via buttons that launch chat turns; free-text generation inputs live only in the chat composer.

## Capabilities

### New Capabilities

- `schematic-inspector` — parsing, completeness validation, health surfacing, structured default view with raw toggle.
- `schematic-wizard` — guided create/edit/re-align flows, blueprint questionnaire, end goals with nudges, AI-enhanced descriptions.
- `grounded-generation` — skill-sourced instructions, agentic context gathering, grounding anchors, focus directive and soft gating.

### Modified Capabilities

- `plan-pipeline` — remove `Default category seeding`; categories become project-derived.
- `planning-prompt-settings` — compiled defaults for planning kinds become skill-derived at read time; override/reset semantics unchanged.
- `chat-idea-generation` — generation turns are agentic; idea capture requires grounding; categorical direction references project-derived categories.
- `plan-pipeline-ui` — remove the Generate-plans modal/input requirements (`Generate From Context Opens Chat`, `Context Prompt Composition`, `Generate Plans with File Context`, proposal-card requirements superseded by the ideas catalog); auditability restated for agentic turns; inspector becomes input-free with health/anchor visibility.

## Impact

- **Rust services:** `schematic_service.rs` (parse/validate/health), `planning_prompt_service.rs` (skill-derived defaults), `pipeline_service.rs` + `native_chat_service.rs` (skill-sourced agentic turns), `session_service.rs` (remove seeding).
- **Rust commands/models:** new `schematic_inspect` command; `models/idea.rs` + additive `ideas.grounding` / `ideas.anchor` migration; `lib.rs` registration.
- **TS:** `ProjectSchematicTab.tsx` (structured view, wizard entry, nudges), `PlanningInspector.tsx` (health badge, anchors, input-free), remove `GeneratePlanModal.tsx` and `PlanPanel.tsx`/`SidePanel.tsx` generate buttons, `ChatPanel.tsx` (menu nudge), `lib/schematic.ts`, `lib/ideas.ts`, `state/schematic.ts`; Settings copy referencing "Generate from context".
- **Skills (bundled, this repo):** `basebuild-project-schematic` template/interview gains Blueprint + End goals + enhance guidance; `basebuild-planning` focus rules include End goals and blueprint context.
- **DB:** additive idea columns only. Existing seeded categories in old sessions are user data and are kept.
- **Docs:** `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md`, `DESIGN.md` + `docs/agents/design-system.md` (schematic cards, wizard, badges, removed modal).
- **Ordering:** after `unified-planning-workspace` (builds on its catalog, prompts, menu, inspector). Uses the skills shipped by `basebuild-planning-skill`. Independent of `harness-context-files` (general session context injection stays there; planning turns are owned here).
