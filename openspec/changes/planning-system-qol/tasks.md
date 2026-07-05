# Tasks: Planning System QoL & End-to-End Completion

## 1. Storage & Migrations

- [ ] 1.1 Add `plan_proposals` table (id, session_id, run_id, title,
      description, goal, suggested_change_name, state
      `proposed|accepted|dismissed`, plan_id NULL, created_at) in
      `storage_service.rs` with migration + tests (isolated BASEBUILD_HOME)
- [ ] 1.2 Add `native_chat_messages.reasoning` TEXT NULL migration; readers/
      writers in `native_chat_service.rs`
- [ ] 1.3 Add `sessions.title_locked` INTEGER DEFAULT 0 migration
- [ ] 1.4 Test DB isolation: audit `src-tauri` tests for real-profile writes;
      route all storage tests through a `test_util` isolated
      `BASEBUILD_HOME`; remove `/test/project-*` leak paths

## 2. Reasoning & Transcript Integrity

- [ ] 2.1 `provider_client.rs`: stop folding `{reasoning}\n\n---\n\n{content}`
      (both OpenAI-compatible sites); return reasoning separately on
      `ProviderResponse`
- [ ] 2.2 Persist reasoning to the new column; strip stray
      `<think>`/`</think>` markers from content
- [ ] 2.3 Exclude reasoning from provider request assembly (history replay)
- [ ] 2.4 ChatPanel: collapsed "thinking" section per message with visually
      distinct muted/labelled styling — never confusable with reply text
      (0px radius, tooltip); live reasoning channel keeps streaming into it
- [ ] 2.5 Persist tool events at call start and update on completion in the
      agent loop (`agent_loop_service.rs` / `native_chat_service.rs`);
      never append raw tool-call JSON to assistant content
- [ ] 2.6 ChatPanel: render tool cards live in message order from the event
      stream (matches `tool-transcript-rendering` canonical spec)
- [ ] 2.7 Group consecutive tool calls into one collapsed activity row
      (count + status + latest call summary, live-updating); expansion is a
      height-capped scrollable list that auto-follows the newest call until
      the user scrolls up

## 3. run_command Approval UI

- [ ] 3.1 Backend: pending-approval state + approve/deny commands wired to
      the existing approval gateway (allow once / allow for session by
      command prefix / deny; timeout denial)
- [ ] 3.2 ChatPanel: inline approval card with exact command text and
      actions; denial feeds a denial result back to the loop
- [ ] 3.3 Remove the hardcoded "Pending UI integration" auto-deny

## 4. Structured Plan Proposals

- [ ] 4.1 Add `propose_plans` tool schema + runtime handler persisting
      `plan_proposals` rows tied to session + run
- [ ] 4.2 Generate-plans system prompt: mandate `propose_plans`; fallback
      parse of final message when the tool is never called; surface "no
      proposals captured" otherwise
- [ ] 4.3 Record generate/suggest runs as `pipeline_runs` stage rows
      (matches `plan-pipeline` canonical spec)
- [ ] 4.4 lib wrappers + `state/` hook for proposals (list, accept, dismiss)
- [ ] 4.5 ChatPanel/PlanPanel: proposal cards (accept → draft plan links
      `plan_id`; dismissed persists); reload with session; append-only
      across regenerations
- [ ] 4.6 GeneratePlanModal: preserve goal through the schematic-creation
      detour and auto-resume generation; delete stale "placeholder plans"
      copy

## 5. OpenSpec Stage & Run Handoff

- [ ] 5.1 `draft → openspec`: recorded pipeline stage generates artifact
      content, validates format, writes via `write_artifacts_atomic`, sets
      `plans.change_name`, flips status only on success (failure → stays
      `draft` with surfaced error)
- [ ] 5.2 Plan cards + FocusPlanModal: show `openspec_task_progress`
      (completed/total) with file-change or open-triggered refresh
- [ ] 5.3 Review affordance: open generated artifacts in the file viewer;
      explicit action advances `openspec → ready`
- [ ] 5.4 Native plan run: opening context references
      `openspec/changes/<name>/` and the apply workflow; run start sends the
      opening instruction (run start is the explicit user action)

## 6. Session Lifecycle & Shell QoL

- [ ] 6.1 Launch/restore reuses the most recent session; session creation
      only via explicit "New Session"
- [ ] 6.2 Auto-title sessions from first user message / generate goal
      (local truncation); inline rename sets `title_locked`; placeholder
      title until then
- [ ] 6.3 Sidebar: stable ordering (created_at DESC); selection no longer
      touches `updated_at` (audit readers; add `last_selected_at` if needed)
- [ ] 6.4 Single-instance guard via `tauri-plugin-single-instance` with
      focus callback
- [ ] 6.5 De-duplicate default chat tab titles (Chat 1, Chat 2, …) on
      restore; friendly provider/model labels in the chat empty state
- [ ] 6.6 Effort clamping: catalog-aware resolution in
      `native_chat_service` for send/create/default-restore; composer
      filters selector to `supportedEfforts`

## 7. Verification

- [ ] 7.1 `npx tsc --noEmit` and `npm run build`
- [ ] 7.2 `cargo check` and `cargo test` in `src-tauri/` (all storage tests
      under isolated BASEBUILD_HOME; user `state.db` byte-identical after
      run)
- [ ] 7.3 `BASEBUILD_E2E=1 npm run test:e2e` including new coverage:
      proposal cards, approval card, reasoning fold, session reuse
- [ ] 7.4 UI smoke on the running app: generate → accept 2/5 proposals →
      Start OpenSpec writes artifacts → restart → proposals, plans, model
      default, and progress all restored; screenshot changed views
- [ ] 7.5 Freeze watchdog: 60s streaming run with UI interaction produces no
      freeze reports

## 8. Docs & Roadmap

- [ ] 8.1 Update `docs/agents/agent-runtime.md` (reasoning storage, approval
      flow, propose_plans tool) and `docs/agents/desktop-shell.md` (session
      lifecycle, single instance)
- [ ] 8.2 Update `DESIGN.md` (proposal cards, thinking fold — visual
      language only) and `docs/agents/design-system.md` (selectors/classes)
- [ ] 8.3 Refresh roadmap: `node scripts/openspec-status.mjs --write` +
      ROADMAP narrative update in the same commit
