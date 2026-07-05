# Design: Harness Subagents

## Context

The native harness (`agent_loop_service.rs` + `tool_runtime_service.rs`) runs a
single session's tool loop. `plan-pipeline-harness` (PR #15) shipped the run
queue (`plan_runner_service.rs`, bounded concurrency) and worktree-backed
workspaces (`worktree_service.rs`, `parallel-workspaces`). Tool approval flows
through the merged broker (`tool-approval-gateway`). Subagent delegation is the
missing OMP task-tool parity: a scoped child session spawned by a parent turn.

## Goals / Non-Goals

**Goals**:
- A delegation tool that spawns scoped, isolated sub-sessions and returns their
  results to the parent turn.
- Reuse existing substrate: run-queue concurrency, worktrees, approval gateway.
- Bound recursion and fan-out; propagate cancellation.

**Non-Goals**:
- A general multi-agent planner or inter-agent chat.
- New provider plumbing — subagents use the same harness/tool runtime.
- Changing the run queue or worktree contracts (reuse, don't fork).

## Decisions

- **Decision**: Register delegation as a first-class tool in
  `tool_runtime_service.rs`; orchestration lives in a dedicated
  `subagent_service.rs`. — **Rationale**: keeps the tool loop uniform and the
  orchestration testable in isolation. **Alternatives**: inline in
  `agent_loop_service.rs` (couples orchestration to the loop; hard to test).
- **Decision**: Subagents are run-queue jobs bounded by the existing concurrency
  limit, each optionally in a worktree. — **Rationale**: one scheduler, one
  isolation model; no second concurrency source. **Alternatives**: a separate
  thread pool (double-books CPU, ignores worktree isolation).
- **Decision**: Return a summary + references as the tool result; persist the
  full child transcript as its own run. — **Rationale**: keeps the parent context
  small (respects the budget guard) while remaining auditable. **Alternatives**:
  inline the full child transcript (blows the parent budget immediately).
- **Decision**: Enforce a depth + fan-out cap and propagate parent cancellation
  to children. — **Rationale**: prevents runaway recursion and orphaned work;
  matches task-tool safety. **Alternatives**: unbounded delegation (resource and
  cost blowups).

## Risks / Trade-offs

- Resource contention from many parallel subagents → Mitigation: hard concurrency
  limit + fan-out cap; excess queues.
- Worktree churn → Mitigation: reuse `parallel-workspaces` prune semantics; child
  worktrees are pruned on terminal state.
- Approval fatigue for child tool calls → Mitigation: children inherit the
  parent's approval rules/modes via the existing broker.

## Migration Plan

Additive: a new tool + service + child-run records. Existing single-session turns
are unaffected when the delegation tool is unused.

## Open Questions

- Whether child runs should be prunable independently or only with the parent —
  default to parent-scoped pruning; revisit if inspection needs diverge.
