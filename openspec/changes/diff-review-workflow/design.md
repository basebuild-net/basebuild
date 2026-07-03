# Design: Diff Review Workflow

## Context

`git_service.rs` already does status/diff/stage/commit via git CLI. `SourcePanel.tsx` renders working-tree diffs. `plan_runner_service.rs` (planned, `plan-pipeline-harness`) owns run lifecycle + final touches; runs may execute in worktrees. Review must work for native runs and OMP terminal runs — both just mutate a git worktree.

## Goals / Non-Goals

**Goals**: per-run changeset, one-click file review, write-side final touches never ship unreviewed queue work.

**Non-Goals**: hunk-level revert (file-level only, per user decision); code-review comments/threads; multi-user review; non-git projects (explicit degradation).

## Decisions

**Decision**: Baseline = hidden ref `refs/basebuild/run-<id>` built like `git stash create` (temp index commit of tracked state) plus a stored list of untracked paths at start. Diffing = `git diff <baseline>` scoped to the run's worktree; new-at-baseline untracked files that changed are attributed via the stored list. — **Rationale**: zero working-tree disturbance, survives restarts, works identically for OMP runs. **Alternatives**: file-hash manifests (reinvents git); auto-commit checkpoints (pollutes user history).

**Decision**: File revert = restore blob from baseline (`git cat-file` → write), delete run-added files, restore run-deleted files. Guard: if disk mtime/hash differs from run-end snapshot, warn before clobbering post-run edits. — **Rationale**: file-level is deterministic; the post-run-edit guard is the one real footgun.

**Decision**: Gate lives in `plan_runner_service` final-touches executor: write-kind steps (`commit`, `pull_request`) check review state; non-write steps (`shell`, `validate`) run regardless. Skip is a recorded run event. — **Rationale**: gating at the executor means no UI path can bypass it.

**Decision**: Review UI is run-scoped (opened from run card / queue), reusing `SourcePanel` diff rendering components rather than a second diff implementation.

## Risks / Trade-offs

- Baseline refs accumulate → cleanup on terminal review state + startup prune of orphans.
- Send-back-to-chat can loop (agent re-edits, review resets) → file re-entering `pending` is correct; the gate simply waits again.
- Two runs touching the same file in the primary checkout (no worktrees) → concurrency is already capped to 1 without worktrees (`plan-pipeline-harness` decision); document as the protecting invariant.
- OMP runs have no run-end hook → changeset computed on demand when review opens; run-end snapshot hash taken lazily.

## Migration Plan

Additive: `run_changesets` table + review-state columns on run records. Rollback: gate feature-flag (`review.gateEnabled`, default on for queue runs) — disabling reverts to pre-review final-touch behavior without schema changes.

## Open Questions

- Rename detection (`git diff -M`) in the changeset list — nice-to-have, decide during implementation.
- Should `validate` final-touch see review states (e.g. only validate approved files)? Default: validate full changeset.
