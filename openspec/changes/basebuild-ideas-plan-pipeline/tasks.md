# Tasks: Basebuild Ideas and Plan Pipeline

## Phase 1 — Data Model and Rust API

- [ ] Update `Plan` Rust model with new fields (reference_id, goal, priority, tags JSON, context JSON, status enum, ai_enhanced, finished_at).
- [ ] Update SQLite schema and migrations for plans table.
- [ ] Add Rust commands: create_plan, update_plan, delete_plan, list_plans, get_plan, set_plan_status, generate_reference_id.
- [ ] Add Rust commands for plan generation: generate_plans, suggest_more_plans, enhance_plan. These prepare prompts and call OMP with the configured model.

## Phase 2 — Frontend State and Layout

- [ ] Remove OMP tool button from `ToolRail`; keep Terminal, Source, Ideas (mapped to Plans view).
- [ ] Move OMP status/context UI into `DebugPanel`.
- [ ] Create `PlanPanel` right-side component: minimizable, lanes by status, compact design.
- [ ] Update `AppShell` to render `PlanPanel` as a fixed right column instead of an Ideas tool tab.
- [ ] Create `usePlans` state hook with optimistic updates for status changes.

## Phase 3 — Plan UI Interactions

- [ ] Render plan lanes: `draft`, `openspec`, `waiting`, `in_progress`, `finished` (collapsed), `cancelled` (folded into finished).
- [ ] Plan card with title, reference id, priority dots, hover actions, status dropdown.
- [ ] Add plan modal for create/edit/focus with fields: title, description, goal, status, priority, tags, notes.
- [ ] Add "AI Enhance" button inside plan modal.
- [ ] Add generate-plans modal with goal input and model selector.
- [ ] Add "Suggest More Plans" button that reuses generation flow with existing plan context.
- [ ] Add focus actions: Copy reference, Open in terminal, Mark finished, Cancel.
- [ ] Animate lane counts and card add/remove with CSS transitions.

## Phase 4 — Skills and Prompts

- [ ] Create `basebuild-plan-generator` skill for MVP plan generation from project goal + context.
- [ ] Create `basebuild-plan-suggester` skill for suggesting more plans from existing plans + goal.
- [ ] Create `basebuild-plan-enhancer` skill for rewriting a single plan.
- [ ] Add skill resources to app bundle.

## Phase 5 — Visual Verification and Cleanup

- [ ] Ensure layout still collapses cleanly to icon-only modes.
- [ ] Verify no broken TypeScript (`npm run build`).
- [ ] Verify Rust compiles (`cargo check`).
- [ ] Run `npm run tauri dev` and screenshot the new layout.
- [ ] Update DESIGN.md / AGENTS.md references to plan panel terminology.
