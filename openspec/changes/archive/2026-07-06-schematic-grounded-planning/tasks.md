# Tasks: Schematic-Grounded Planning

## 1. Schematic Service & Skills

- [x] 1.1 Extend `schematic_service.rs`: parse template sections, per-section `filled/placeholder/missing`, overall health, end-goal period parsing (`<year>`, `<month> <year>`) with stale detection — pure functions + unit tests
- [x] 1.2 Add `schematic_inspect` Tauri command (+ `lib.rs` registration) and `src/lib/schematic.ts` wrapper + `state/schematic.ts` health state
- [x] 1.3 Update `skills/basebuild-project-schematic/SKILL.md`: template v2.1 (`## Blueprint`, `## End goals`), blueprint-first interview with archetype-appropriate questioning (SaaS, game, CLI, library, app, site; team size; stage), end-goal questions, enhance guidance
- [x] 1.4 Update `skills/basebuild-planning/SKILL.md` + `references/schema.md`: focus rules include Blueprint constraints and End goals as anchor targets
- [x] 1.5 Verify: `cargo test` (parse/validate/health/stale-goal cases), skill frontmatter still single-line `name`/`description`

## 2. Schematic Wizard & Structured View

- [x] 2.1 `ProjectSchematicTab.tsx`: structured section cards by default (Blueprint facts, End goals rows, ranked priorities, core rules), per-section fill states, raw-view toggle, edit retained
- [x] 2.2 Wizard entry points: `Start wizard` (toolbar, whole doc) + per-section `Fill` + empty-state action + End-goal `Fix` nudge inject a guided chat turn driven by the `basebuild-project-schematic` skill (repo-fact prefill, one question at a time, approval-gated write). Matches the schematic-wizard spec's "visible chat turn" flow — no separate modal component required. Non-tool-capable models are guarded with an in-composer notice.
- [ ] 2.3 Per-section Enhance action: plain words → agentic-optimized rewrite as before/after diff, approve/discard (**not shipped**; skill guidance landed in 1.3 but no per-section UI action exists — tracked as `schematic-enhance-ui` in ROADMAP Proposed)
- [x] 2.4 End-goal nudges ("Set a year-end and a month-end goal…") in schematic tab and planning inspector, linking into the wizard; health badge in both surfaces, recomputed on open/write/wizard-finish
- [x] 2.5 Verify: e2e (BASEBUILD_E2E) — structured default view, raw toggle, health badge states, nudge visibility; `npx tsc --noEmit` + `npm run build`

## 3. Grounded Generation

- [x] 3.1 `planning_prompt_service.rs`: planning-kind defaults derived from bundled skill content at read time (LazyLock-cached); Settings labels source skill; `chat_system` unchanged; unit tests for derivation + override precedence
- [x] 3.2 `pipeline_service.rs` + `native_chat_service.rs`: generation turns assembled from skill-derived instructions + focus directive (Vision, End goals, priorities, Blueprint); remove hardcoded prompt strings; turns run with tool access and required context reads
- [x] 3.3 Idea capture tool: require `grounding`, accept `anchor`; additive `ideas.grounding`/`ideas.anchor` migration; reject captures without grounding; persistence tests
- [x] 3.4 Remove default category seeding (`session_service.rs`); Categories empty state offers "Generate categories from project" + "Add category"; dedupe on regeneration (case-insensitive)
- [x] 3.5 Soft gate: generation invocation checks schematic health, warns with incomplete sections, offers wizard, allows proceed (recorded in the turn)
- [x] 3.6 Verify: `cargo test` (capture rejection, migration, dedupe, prompt assembly contains focus directive), manual generation run shows context reads before captures

## 4. Input-Free Inspector & Menu

- [x] 4.1 Delete `GeneratePlanModal.tsx`; remove "Generate plans" buttons/affordances from `PlanPanel.tsx` and `SidePanel.tsx`; update Settings copy referencing "Generate from context"; remove now-dead wiring
- [x] 4.2 Planning inspector: health badge + wizard action; idea rows render `anchor` or `outside current focus` flag with tooltips; plan CRUD editing untouched
- [x] 4.3 Chat planning menu: `By category…` lists project-derived categories, empty list offers "Generate categories from project", health nudge when not `complete`
- [x] 4.4 Chat idea cards render anchor / outside-focus flag
- [x] 4.5 Verify: repo-wide grep shows no `GeneratePlanModal` / generate-plans entry points; e2e — menu empty-state, inspector has no generation inputs; `npx tsc --noEmit` + `npm run build`

## 5. Verification & Docs

- [x] 5.1 Full pass: `npx tsc --noEmit`, `npm run build`, `cargo check`, `cargo test`, `BASEBUILD_E2E=1 npm run test:e2e`
- [ ] 5.2 UI smoke with screenshots: structured schematic view, wizard turn, health badge + nudges, generation turn with visible reads, idea card with anchor/outside-focus flag (deferred — live-only, requires running desktop app)
- [x] 5.3 Docs: `docs/agents/agent-runtime.md` (skill-sourced prompts, grounded turns, capture schema) + `docs/agents/desktop-shell.md` (schematic tab, wizard, inspector) landed in PR #22; `DESIGN.md` (Planning Inspector tabs, schematic tab, idea grounding/anchor flags) + `docs/agents/design-system.md` (schematic classes, health badge, section fill-states, flags) landed in the roadmap-truth pass
- [x] 5.4 `node scripts/openspec-status.mjs --write` + ROADMAP narrative pass in the same commit (Invariant 12)

## Deferred to follow-up

- **2.3** (per-section Enhance diff action): **not shipped.** The `basebuild-project-schematic` skill carries Enhance guidance (task 1.3), but there is no per-section UI action that proposes a before/after rewrite. The schematic-wizard spec's "AI-enhanced descriptions" requirement is therefore **unmet** by this change — tracked as `schematic-enhance-ui` in `openspec/ROADMAP.md` (Proposed). Acknowledge this spec gap before archiving.
- **5.2** (UI smoke): live-only, requires running desktop app with a connected provider.
