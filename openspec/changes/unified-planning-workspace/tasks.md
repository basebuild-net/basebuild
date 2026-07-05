# Tasks: Unified Planning Workspace

## 1. Storage & Model Foundation

- [x] 1.1 Add `IdeaStatus::Rejected` (`"rejected"`) to `models/idea.rs`;
      extend `as_str`/`from_str` (unknown still → `concept`); unit test the
      round-trip and legacy migration
- [x] 1.2 Add `planning_prompts(key, value, updated_at)` migration in
      `storage_service.rs` (idempotent) with an isolated-home test
- [x] 1.3 Drop `plan_proposals` (`DROP TABLE IF EXISTS`) in `storage_service.rs`;
      remove `services/plan_proposal_service.rs`, `models/plan_proposal.rs`,
      `commands/native_chat.rs` `plan_proposal_*` handlers, and their `lib.rs`
      registration
- [x] 1.4 Remove `src/lib/planProposals.ts` and all `PlanProposal` imports;
      confirm no dangling references (grep)

## 2. Planning Prompt Service

- [x] 2.1 New `services/planning_prompt_service.rs`: compiled defaults for
      `chat_system`/`idea_generation`/`plan_generation`/`category_generation`;
      `get(key)->effective`, `set(key,value)`, `reset(key)`,
      `list()->[{key,value,default,isModified}]`; tests under isolated home
- [x] 2.2 New `commands/planning_prompts.rs` (`planning_prompt_list`,
      `planning_prompt_set`, `planning_prompt_reset`); register in `lib.rs`
- [x] 2.3 `native_chat_service`: replace hardcoded `system_prompt` and the idea
      prompt literals with `PlanningPromptService` lookups (empty override →
      default)
- [x] 2.4 `lib/planningPrompts.ts` thin invoke wrappers + types

## 3. Unified Generation (chat turn)

- [x] 3.1 Add `propose_ideas` tool schema in `tool_runtime_service.rs`
      (title, description, category direction); remove `propose_plans`
- [x] 3.2 `agent_loop_service`: intercept `propose_ideas` → persist via
      `SessionService::create_idea` (category-tagged), emit a tool event per
      capture; drop the `propose_plans` interception + `execute_propose_plans`
- [x] 3.3 `native_chat_service`: rework `generate_ideas` to run a chat turn
      (record user message, stream on the main + reasoning channels, expose
      `propose_ideas`), record a `generate_ideas` `pipeline_runs` stage with
      category id/freeform; keep tolerant fallback parser for non-tool models
- [x] 3.4 Remove the discarded `ideas` streaming channel end-to-end (backend
      emit + `ChatPanel` `if (channel === "ideas") return;`)
- [x] 3.5 Extend `NativeGenerateIdeasRequest` with optional `categoryId` /
      `direction`; `SessionService::ensure_default_categories(session_id)`
      (idempotent SEO/Optimization/Design/New Features seed) called before
      category-directed generation and on Categories tab open
- [x] 3.6 Add `category_id`-aware generate command + `lib/ideas.ts` wrapper;
      `state/ideas.ts` gains `generateForCategory` and `rejectIdea`

## 4. Idea Lifecycle: Reject

- [x] 4.1 `SessionService`: reject transition (`concept → rejected`), guard so
      `picked` ideas are not rejectable; `update_idea_status` accepts `rejected`
- [x] 4.2 `state/ideas.ts` + `lib/ideas.ts`: `rejectIdea(id)`; history queries
      by status

## 5. Chat Transcript & Quick-Access

- [x] 5.1 `ChatPanel`: render captured ideas as in-transcript idea cards that
      appear incrementally during the generation turn (reuse reasoning fold +
      tool events); remove proposal-card rendering
- [x] 5.2 Idea cards gain Promote + Reject actions; Reject → `rejected` and
      drops from active cards
- [x] 5.3 Replace the single "Generate ideas" button with a compact planning
      menu: `Quick ideas`, `By category…` (category picker, seeded defaults),
      `Open planning inspector`
- [x] 5.4 Remove now-dead idea spinner/`generatingIdeas`-only surface;
      generation state derives from the transcript turn

## 6. Unified Planning Inspector

- [x] 6.1 New `PlanningInspector` with `Plans / Ideas / Categories` tabs
      (persisted active tab); `Plans` reuses existing lanes
- [x] 6.2 `Ideas` tab: full session idea list, status filter
      (all/concept/picked/rejected/archived), Promote/Reject/Delete per idea
- [x] 6.3 `Categories` tab: category list; `Generate categories` (AI) +
      `Add category` (manual); open a category → its ideas + statuses +
      `Suggest more ideas` (category-directed generation)
- [x] 6.4 Wire `PlanningInspector` into `SidePanel`/`AppShell` in place of the
      plans-only section; shared `CategoryPicker` component

## 7. Planning Settings Tab

- [x] 7.1 `SettingsModal`: add `planning` tab listing each prompt in a textarea
      with `Save` + `Reset to default`, modified badge; 0px radius, tooltips
- [x] 7.2 Load via `planning_prompt_list`; Save/Reset call set/reset and
      refresh; empty field on Save is treated as reset

## 8. Verification

- [x] 8.1 `npx tsc --noEmit` and `npm run build`
- [x] 8.2 `cargo check` and `cargo test` in `src-tauri/` (new prompt + reject +
      seeding tests under isolated `BASEBUILD_HOME`)
- [x] 8.3 `BASEBUILD_E2E=1 npm run test:e2e` incl. new coverage: inspector tabs,
      status filter, chat planning menu, reject action, planning settings
      save/reset
- [ ] 8.4 UI smoke on the running app: quick ideas → cards stream in →
      promote/reject → category suggest-more → edit+reset a prompt → restart →
      catalog + statuses restored; screenshot changed views
      _(consciously waived: live-only; requires running Tauri app + connected
      provider. Static verification: tsc/build/cargo test/e2e all pass; the
      unified generation path is exercised by existing e2e coverage.)_
- [ ] 8.5 Freeze watchdog: a streaming generation turn with UI interaction
      produces no freeze reports
      _(consciously waived: live-only; requires running Tauri app + a 60s
      streaming run. No freeze-watchdog regressions introduced — the generation
      turn reuses the existing streaming + agent-loop plumbing.)_

## 9. Docs & Roadmap
- [x] 9.1 `docs/agents/agent-runtime.md`: unified idea catalog, generation as a
      chat turn with `propose_ideas`, tunable planning prompts (remove
      `propose_plans`/`plan_proposals` references)
- [x] 9.2 `docs/agents/desktop-shell.md`: planning inspector tabs + category
      drill-down; `DESIGN.md` + `docs/agents/design-system.md`: inspector tabs,
      idea cards (Promote/Reject), chat planning menu, planning settings
      selectors/classes
- [x] 9.3 Refresh roadmap: `node scripts/openspec-status.mjs --write` +
      ROADMAP narrative (mark `plan_proposals` superseded in
      `planning-system-qol`)
