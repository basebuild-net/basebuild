# Proposal: Idea-to-Merge Autopilot

## Why

The MVP golden path (`generate ideas → plans → queue → merge/archive`) exists
piecewise across canonical capabilities, but the 2026-07-08 live audit and the
still-unchecked course-correction items in `mvp.md` show the loop still
demands manual typing and manual invocation at every stage. Owner direction
(2026-07-10): focus on one project and run the loop nearly hands-free —
generate ideas from the schematic and prior plan outcomes without writing
prompts, deploy many ideas to parallel chats in one action, watch progress
and completion estimates on a premium board, clean up through a guided
multi-run merge review, and let the user configure what happens when a plan
finishes instead of hardcoding one flow.

## What Changes

- **Idea rounds**: a one-click, zero-input generation round grounded in the
  schematic, decision digest (picked/rejected ideas, finished plans), and
  preferences — followed by a round review where selected ideas deploy
  (promote + batch-launch into chats) behind a single confirmation.
- **Run mission control**: a project-scoped board with one card per run —
  plan, owner chat, branch/worktree, task progress, blockers, attention
  states, elapsed time, and a task-velocity completion estimate ("when it
  will be done", labeled as an estimate).
- **Workspace merge review**: a guided session over multiple finished
  worktree runs — dependency-aware ordering, per-run review/merge/skip with
  conflict-safe aborts, a session summary, and batch cleanup of merged
  worktrees.
- **Configurable post-finish policy**: per-project choice of what happens
  when an assigned run finishes — hold (default, current behavior),
  auto-commit in the run worktree, auto-commit + PR, or auto-commit + flag
  merge-ready. Merging to the default branch is never automatic.
- **Workspace support hardening**: end-to-end verification of the worktree
  lifecycle (provision → run → finish → policy → queue → merge → prune) and
  its non-git fallbacks.

## Capabilities

### New Capabilities

- `idea-rounds` — zero-input generation rounds with round review and bulk
  deploy.
- `run-mission-control` — per-run progress cards with completion estimates
  and attention states.
- `workspace-merge-review` — multi-run guided merge session over the
  integration queue.

### Modified Capabilities

- `plan-completion-flow` — adds the configurable post-finish policy applied
  when a run reaches `finished`.
- `plan-merge-cleanup` — adds the merge-review session entry point on the
  integration queue.

## Impact

- **Frontend**: planning surface + command strip (round entry), new round
  review surface, new mission control board (lazy modal or planning tab),
  integration queue selection + session flow, launch confirmation gains the
  effective finish policy, completion card becomes policy-aware.
- **Backend**: finish-policy storage (launch profile / project settings row),
  policy application on run finish in the plan run service, round batch
  metadata reuse (generation batch ids already persist on ideas), merge
  session orchestration over existing `GitService` merge/cleanup commands —
  no new git plumbing.
- **Non-goals**: cross-project orchestration, ML-based estimation, automatic
  merges into the default branch, replacing `diff-review-workflow` (its
  per-run diff surface is the review affordance this change links to).
- **Dependencies / overlap**: pairs with `diff-review-workflow` (0/16, per-run
  file review) and reuses `plan-chat-assignment` batch-launch destinations,
  `plan-dependency-scheduling` collision analysis, `plan-merge-cleanup`
  queue actions, and the `grounded-generation` decision digest. No overlap
  with in-flight shell changes.
