# Tasks: planning-command-center

Gate: archive `parallel-plan-workspaces` first (its `plan-chat-assignment` /
`run-concurrency-limits` / `parallel-workspaces` deltas are this change's
bases). Phases 1–2, 3–4, 5–6, 7–8, and 9 are intended PR boundaries.

## 1. Planning event bus (Phase A)

- [x] 1.1 Add `src-tauri/src/models/planning_event.rs`: event kind enum
      (plan/idea/category/schematic/stage/run/integration variants), payload
      struct (kind, entityId, projectPath, sessionId?, title, detail?, seq,
      ts), camelCase serde; `planning_events::emit(app, …)` helper with a
      process-wide atomic seq in a new `src-tauri/src/services/planning_events.rs`.
- [x] 1.2 Emit at mutation points: `plan_service.rs` (create/update/status),
      storage ideas+categories paths used by `pipeline_service.rs`
      (`create_idea`, idea status changes, category create),
      `schematic_service.rs::write`, `pipeline_service.rs` stage transitions,
      `plan_runner_service.rs` run start/finish/fail (alongside existing
      `PLAN_RUN_EVENT`). Unit-test emission per service (kind + seq ordering).
- [x] 1.3 Add `src/state/planningEvents.ts`: one `listen("planning://event")`
      subscription hook with seq-gap detection → catalog refetch callback;
      wire `src/state/ideas.ts` + `src/state/plans.ts` to refresh from it.
- [x] 1.4 Planning inspector consumes events: live Plans/Ideas/Categories
      refresh in `PlanningInspector.tsx`, no manual refetch buttons added.

## 2. Notifications (Phase A)

- [ ] 2.1 Migration: `notifications` table (id, kind, entity_id, entity_kind,
      project_path, title, detail, read, created_at) + prune-oldest-read cap
      in `storage_service.rs`; `notification_service.rs` (insert-from-event
      with per-turn generation summarization, list, mark-read, mark-all,
      unread-count); commands + thin `src/lib/notifications.ts`.
- [ ] 2.2 Per-kind delivery settings (toast+center / center-only / off) with
      conservative defaults in `settings_service.rs` + Settings →
      Notifications section in `SettingsModal.tsx`.
- [ ] 2.3 `ToastStack.tsx` mounted in `AppShell.tsx`: stacking, 6s
      auto-dismiss, hover pause, manual dismiss, click-to-navigate (inspector
      tab / chat panel focus / plan view), 0px radius + tooltips; styles in
      `globals.css`.
- [ ] 2.4 `NotificationCenter.tsx` + bell with unread badge in the top-right
      environment block (`ChatEnvironmentPanel.tsx`): newest-first list,
      per-kind filter, mark-read/mark-all, click-to-navigate; unread badge on
      the Planning inspector entry point, cleared on open.
- [ ] 2.5 Playwright e2e (mocked commands): event → toast render → center
      unread → mark-read → badge clears; per-kind mute suppresses toast.

## 3. Interactive elements — backend (Phase B)

- [ ] 3.1 Migration: `pending_interactions` table (id, session_id, run_id,
      questions_json, status pending/answered/cancelled, answers_json,
      created_at, resolved_at); `interaction_service.rs` (create, resolve,
      cancel, list-pending-for-session); startup orphan sweep cancels stale
      pending rows alongside the existing interrupted-run sweep.
- [ ] 3.2 Register `ask_user` in `tool_runtime_service.rs` (questions schema:
      id, prompt, kind options|multi|confirm|text, options[{label,
      description?}], recommended?, allowFreeText?); validation rejects
      malformed calls with a typed error.
- [ ] 3.3 `agent_loop_service.rs`: on `ask_user`, persist the interaction,
      emit `native-chat://interactive-request`, park the iteration on the
      approval-wait substrate, resume with answers as the tool result;
      cancellation resolves `cancelled` and unblocks. Unit-test
      park/resume/cancel/restart paths.
- [ ] 3.4 Commands `native_interaction_resolve` / `native_interaction_pending`
      + thin `src/lib/interactions.ts`; pending question emits a planning
      event (→ toast "agent is asking").

## 4. Interactive elements — frontend + skills (Phase B)

- [ ] 4.1 `QuestionCard.tsx` rendered from tool events in `ChatPanel.tsx`:
      options as buttons (recommended marked), multi-select with confirm,
      confirm kind as two buttons, text kind as inline input; answered and
      cancelled states render compactly; all text escaped; tooltips + 0px
      radius; styles in `globals.css`.
- [ ] 4.2 Composer answer routing in `ChatPanel.tsx`: single pending
      text/free-text question captures the next send with a visible
      "answering" indicator + send-as-message escape.
- [ ] 4.3 Persist question/answer as tool-event rows so history reloads
      answered cards; provider history carries answers as tool results only.
- [ ] 4.4 Update `skills/basebuild-planning/SKILL.md` (+ templates if needed)
      and `skills/basebuild-project-schematic/SKILL.md` with the interactive
      surfaces contract: use `ask_user` when available for category
      confirmation, idea picking, promote gates, wizard sections, re-align
      approvals; prose fallback otherwise.
- [ ] 4.5 Pipeline turns (`pipeline_service.rs`) expose `ask_user` to
      generation/wizard turns so skill-driven picking loops work in-app.
- [ ] 4.6 Playwright e2e: agent asks → card renders → click option → loop
      resumes → answered state persists across reload; cancel resolves
      pending card.

## 5. Repair pass — make existing specs true (Phase C)

- [ ] 5.1 Reproduce and diagnose the schematic wizard flow end to end
      (create/update turn, section cards, health badge) against
      `schematic-wizard` / `schematic-skill-workflow` specs; fix root causes;
      record findings in the PR description.
- [ ] 5.2 Reproduce and diagnose "Generate categories from project"
      (`plan-pipeline` project-derived categories) and category-directed idea
      generation (`grounded-generation`, `chat-idea-generation`); fix root
      causes (provider gating, prompt assembly, tool exposure, capture
      wiring).
- [ ] 5.3 Wire the repaired flows to interactive cards: wizard section
      confirmations and idea picking run through `ask_user` end to end.
- [ ] 5.4 Add Playwright e2e (mocked provider) covering: wizard create path,
      category generation empty-state path, idea generation → card capture →
      promote; these lock the repairs in CI.

## 6. Flow board + batch operations (Phase C)

- [ ] 6.1 Batch backend: `plan_service.rs` batch-promote (per-idea error
      capture, batch summary event) + batch-launch command dispatching
      through the existing assignment path; unit tests incl. partial failure.
- [ ] 6.2 `PlanningFlowBoard.tsx` as a new `Flow` tab in
      `PlanningInspector.tsx`: five stages with live counts, status colors,
      activity pulse from planning events; stage drill-down lists with
      navigation; schematic stage shows health + drift indicator.
- [ ] 6.3 Multi-select + "Approve selected" on Ideas (tab + board) → batch
      promote; summary toast.
- [ ] 6.4 "Launch selected" on ready plans → confirmation enumerating chats/
      worktrees/branches/providers → per-plan chat spawn via assignment;
      queued-beyond-cap state visible on the board.
- [ ] 6.5 Playwright e2e: select 3 ideas → approve → 3 plans; launch 2 plans
      → 2 chats with badges (mocked git/provider); board counts update live.

## 7. Feedback loop (Phase D)

- [ ] 7.1 Decision digest assembly in `planning_prompt_service.rs`: bounded
      recent picked/rejected ideas + plans finished since schematic mtime,
      injected after the focus directive; unit tests for bounds and absence.
- [ ] 7.2 Preferences file support: inject `.basebuild/preferences.md` into
      generation instructions when present; "Suggest preference update" action
      after batch decisions launches an approval-gated turn (writes go through
      the existing file-modification gateway); planning skill documents the
      preferences contract.
- [ ] 7.3 Re-align nudge: on plan `finished` where schematic mtime predates
      run start, emit `schematic_drift_suspected` (once per plan, dismissal
      persisted); notification + flow-board indicator; accept launches the
      schematic re-align turn with interactive per-section approvals.
- [ ] 7.4 Unit tests: digest windows, nudge once-per-plan, dismissal
      persistence.

## 8. Integration queue + milestone auto-commit (Phase D)

- [ ] 8.1 `integration_service.rs`: list finished worktree runs with branch,
      ahead/behind vs fetched default, merged state, PR state via `gh` when
      available (hidden spawn); confirm-gated actions — update default branch
      (ff), merge with conflict-abort restore, post-merge verification
      command with recorded outcome, prune worktree + delete branch (merged
      only unless force-confirmed), batch clean-up-merged. Commands + thin
      `src/lib/integration.ts`. Unit tests: merged-detection, conflict abort,
      force gating.
- [ ] 8.2 `IntegrationQueue.tsx` reachable from the flow board Integration
      stage: per-run rows, actions with confirmations, batch cleanup; outcome
      notifications.
- [ ] 8.3 Milestone auto-commit: per-project setting (default off) in
      `settings_service.rs` + Settings; `plan_runner_service.rs` commits in
      the run worktree after each completed task milestone with
      `bb(<plan-ref>): milestone <n> — <task>`; never primary checkout, never
      push; commits recorded on the run timeline. Unit tests: gating, message
      format, worktree-only.
- [ ] 8.4 Playwright e2e: finished run appears in queue → merge (mocked git)
      → cleanup; auto-commit setting toggles visible behavior flag.

## 9. OMP RPC bridge + shared skill registry (Phase E)

- [ ] 9.1 Protocol verification spike against installed OMP: enumerate RPC
      frame kinds with sessions/tools/skills enabled (text, reasoning, tool
      events, user-input/ask frames, cancel semantics, skill discovery
      mechanism for spawned processes); record the frame map in
      `docs/agents/agent-runtime.md`. If no ask-style frame exists, descope
      question forwarding to "blocked upstream" and note it in the roadmap
      entry.
- [ ] 9.2 `skill_registry_service.rs`: resolve bundled `skills/` + user dir
      with user-wins precedence; `planning_prompt_service.rs` +
      `commands/skills.rs` read through it; provision app-launched OMP
      sessions to discover the same set (per 9.1 mechanism); commands + thin
      `src/lib/skillRegistry.ts`; Settings → Skills listing (name,
      description, source, runtimes).
- [ ] 9.3 `omp_rpc_session_service.rs`: persistent hidden `omp --mode rpc`
      child per session (session+tools enabled), line-JSON reader
      generalized from `OmpCodexRpcClient`, prompt/cancel/shutdown writes,
      exit → session-ended state; tolerant parsing with unknown-frame debug
      rows; version probe gates the `omp-rpc` runtime profile.
- [ ] 9.4 Frame → native transcript mapping: text/reasoning deltas over
      `native-chat://chunk`, tool frames → tool cards, user-input frames →
      `pending_interactions` question cards with answers serialized back over
      stdin; cancel resolves both sides. Unit tests: frame parser fixtures
      (valid, malformed, unknown), question round-trip.
- [ ] 9.5 Plan runs target the `omp-rpc` profile: assignment/seeding/status/
      integration handoff parity with native runs.
- [ ] 9.6 Playwright e2e (mocked RPC child): stream → transcript; question
      frame → card → answer round-trip; process exit → ended state.

## 10. Verification

- [ ] 10.1 `npx tsc --noEmit` and `npm run build` pass.
- [ ] 10.2 `cargo check` and `cargo test` pass in `src-tauri/`.
- [ ] 10.3 `npm run test:e2e` passes with the new planning/notification/
      interaction/board/integration/RPC specs.
- [ ] 10.4 UI smoke on a live dev build: generate → question card → answer →
      ideas → batch approve → batch launch (2 plans) → toasts + center →
      finish → integration merge + cleanup → re-align nudge. Tooltips, 0px
      radius, single stylesheet audited on all new surfaces.

## 11. Docs + roadmap

- [ ] 11.1 Update `docs/agents/agent-runtime.md` (ask_user contract,
      planning events, notifications, RPC bridge frame map, skill registry),
      `docs/agents/desktop-shell.md` (flow board, notification center,
      integration queue), and `DESIGN.md` (toast/card/board visual
      conventions).
- [ ] 11.2 Refresh roadmap: `node scripts/openspec-status.mjs --write` plus
      ROADMAP narrative pass (this change's entry, phase progress, and the
      `parallel-plan-workspaces` archive gate).
