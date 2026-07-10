## ADDED Requirements

### Requirement: Merge review session over multiple runs
The system SHALL let the user select one or more finished worktree runs from
the integration queue and start a guided merge review session. The session
SHALL order the selected runs dependency-aware — prerequisites first, with
collision analysis per `plan-dependency-scheduling` informing the order — and
SHALL present runs one at a time with a per-run summary (branch, ahead/behind
against the fetched default branch, changed-file count, linked plan and
artifacts) and actions: **Review diff** (opens the per-run diff surface;
pairs with `diff-review-workflow`), **Merge** (confirm-gated, with the
conflict-abort semantics of `plan-merge-cleanup` — a conflicted merge aborts
cleanly, restores the pre-merge state, and records the conflicting paths),
**Skip** (leaves the run untouched and advances), and **Stop session**.
A conflict or failure on one run SHALL NOT abort the session — the session
records the outcome and advances to the next run.

#### Scenario: Two-run session merges in dependency order
- **WHEN** the user selects two finished runs where run B's plan depends on
  run A's, and starts a session
- **THEN** the session presents A first; after A merges, B is presented with
  refreshed ahead/behind counts, and merging B proceeds per the same
  confirm-gated semantics

#### Scenario: Conflict aborts one run, session continues
- **WHEN** a confirmed merge in the session hits conflicts
- **THEN** that merge is aborted with the working tree restored, the session
  records the conflict with its paths, and the next run is presented

#### Scenario: Skip preserves the run
- **WHEN** the user skips a run in the session
- **THEN** the run's branch, worktree, and queue entry are unchanged, and the
  session advances

### Requirement: Session summary and batch cleanup
The system SHALL present a session summary when a merge review session ends
(all runs visited or the user stops), listing each visited run's outcome —
merged (with post-merge verification result when configured), skipped, or
failed/conflicted — and SHALL offer the existing confirm-gated batch
"clean up merged" action scoped to the session's merged runs. Cleanup SHALL
follow `plan-merge-cleanup` semantics: prune worktrees and delete branches
only for merged runs, never deleting uncommitted work without the distinct
force confirmation.

#### Scenario: Summary reflects mixed outcomes
- **WHEN** a session ends with one merged run (verification passed), one
  skipped, and one conflicted
- **THEN** the summary lists all three with their outcomes and the conflicted
  run's paths, and only the merged run is offered for cleanup

#### Scenario: Batch cleanup after the session
- **WHEN** the user confirms "clean up merged" on the session summary with two
  merged runs
- **THEN** exactly those two worktrees are pruned and their branches deleted,
  and one notification summarizes the cleanup
