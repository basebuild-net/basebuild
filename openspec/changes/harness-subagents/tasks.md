# Tasks: Harness Subagents

## 1. Delegation Tool & Orchestration

- [ ] 1.1 Add `src-tauri/src/services/subagent_service.rs` orchestrating scoped child sessions (create, run, collect result) via `session_service.rs` + `agent_loop_service.rs`.
- [ ] 1.2 Register a delegation (`task`) tool in `src-tauri/src/services/tool_runtime_service.rs` that accepts a scoped instruction/context and one-or-many subtasks.
- [ ] 1.3 Add a child-run record (reuse/extend `src-tauri/src/models/plan_run.rs` or add a subagent-run model) capturing parent id, prompt summary, status, and output references.

## 2. Concurrency & Isolation

- [ ] 2.1 Bound parallel subagents by the run-queue concurrency limit via `plan_runner_service.rs`; queue the excess.
- [ ] 2.2 Run each subagent in its own worktree via `worktree_service.rs` when git-backed; fall back to sequential in-place with a visible notice otherwise.

## 3. Safety: Cancellation, Approval, Recursion

- [ ] 3.1 Propagate parent cancellation to all child sessions; record children as cancelled.
- [ ] 3.2 Route child tool calls through the existing approval broker (`tool-approval-gateway`) using the parent's rules/modes.
- [ ] 3.3 Enforce a depth + fan-out cap; the delegation tool refuses with a clear error when exceeded.

## 4. Result Return & Transcript

- [ ] 4.1 Return a concise summary + references (files, plan/run ids) to the parent turn as the tool result; never inline the full child transcript.
- [ ] 4.2 Surface child runs in the UI (`src/lib/agent.ts` + transcript state) with a link to inspect each, reusing `tool-transcript-rendering` grouping.

## 5. Verification

- [ ] 5.1 `cargo test` in `src-tauri`: concurrency limit respected, depth/fan-out cap enforced, cancellation propagates, child tool approval routed, non-git sequential fallback.
- [ ] 5.2 `npx tsc --noEmit`
- [ ] 5.3 `npm run build`
- [ ] 5.4 UI smoke: a parent turn delegates two subtasks; results fold back; a child transcript is inspectable.
- [ ] 5.5 Update `docs/agents/agent-runtime.md` documenting the delegation tool, caps, and isolation.

## 6. Docs & Roadmap

- [ ] 6.1 Refresh `openspec/ROADMAP.md` via `node scripts/openspec-status.mjs --write`.
