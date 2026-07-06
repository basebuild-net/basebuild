# Proposal: Harness Subagents

## Why

The native harness runs one session per turn loop. OMP's task tool lets an agent
delegate a scoped subtask to a fresh sub-session; the native harness has no
parity. With the run queue and worktree-backed workspaces already shipped
(`plan-pipeline-harness`, PR #15), we can add scoped subagent delegation on top
of that substrate: a parent session spawns bounded, isolated sub-sessions and
folds their results back into its turn.

## What Changes

- Add a **delegation (`task`) tool**: a parent native session spawns one or more
  scoped sub-sessions, each with its own prompt and isolated context, to run a
  bounded subtask.
- Reuse the **run-queue concurrency limit** for parallel subagents and, when the
  project is git-backed, run each subagent in its own **worktree** (reusing
  `parallel-workspaces`), falling back to sequential in-place on non-git.
- Return each subagent's outcome to the parent as a **tool result** (summary +
  references), keeping the full child transcript inspectable as its own run.
- Enforce **cancellation propagation** (parent cancel → children cancel),
  **approval-gateway passthrough** for child tool calls, and a **depth/fan-out
  cap** to prevent unbounded recursion (task-tool parity).

## Capabilities

### New Capabilities
- `harness-subagents`: scoped delegation tool, bounded concurrency + worktree
  isolation, result return, and cancellation/recursion bounds.

### Modified Capabilities
- (none canonical) — integrates with `agent-tool-loop`, `core-tool-runtime`,
  `plan-run-queue`, `parallel-workspaces`, and `tool-approval-gateway` without
  changing their existing requirements; the delegation tool is registered as a
  new tool in the existing runtime.

## Impact

- **Rust:** add subagent orchestration (new `src-tauri/src/services/subagent_service.rs`
  or an extension of `agent_service.rs`/`agent_loop_service.rs`) that registers a
  delegation tool in `tool_runtime_service.rs`, spawns child sessions via
  `session_service.rs`, bounds concurrency via `plan_runner_service.rs`, and
  isolates via `worktree_service.rs`; child tool calls flow through the existing
  approval broker; record child runs (reuse/extend `models/plan_run.rs` or a
  subagent-run model).
- **Frontend:** surface the delegation tool result and a link to inspect each
  child run in the transcript (`src/lib/agent.ts`, session/transcript state);
  reuse `tool-transcript-rendering` grouping.
- **Tests/verification:** `cargo test` for concurrency limit, depth/fan-out cap,
  cancellation propagation, and approval passthrough; `npx tsc --noEmit`;
  `npm run build`; UI smoke of a parent turn delegating and folding results.
