# plan-merge-cleanup Specification

## Requirements

### Requirement: Integration queue for finished runs
The system SHALL present an integration queue listing finished plan runs that
have a dedicated worktree/branch, showing per-run branch name, ahead/behind
counts against the fetched default branch, merged state, and PR state when
`gh` is available. The queue SHALL update live from planning events and SHALL
be reachable from the flow board's Integration stage.

#### Scenario: Finished runs appear in the queue
- **WHEN** two worktree runs finish
- **THEN** the integration queue lists both with branch, ahead/behind, and
  merged state; runs without a dedicated branch do not appear

### Requirement: Confirm-gated merge and post-merge verification
The queue SHALL offer per-run integration actions, each confirm-gated and
never automatic: update the local default branch (fetch + fast-forward),
merge the run branch into the default branch (aborting cleanly on conflicts
with the repository left in its pre-merge state and conflicts reported), and
run a configured post-merge verification command whose pass/fail is recorded
and notified. Remote pushes remain owned by the existing PR flow.

#### Scenario: Merge requires confirmation
- **WHEN** the user clicks "Merge" on a finished run
- **THEN** a confirmation names the source branch, target branch, and
  resulting action; nothing executes until confirmed

#### Scenario: Conflict aborts safely
- **WHEN** a confirmed merge hits conflicts
- **THEN** the merge is aborted, the working tree is restored to its pre-merge
  state, and the queue entry shows the conflict outcome with the conflicting
  paths

#### Scenario: Post-merge verification runs and reports
- **WHEN** a merge completes and a post-merge command is configured
- **THEN** the command runs, its outcome is recorded on the run and emitted as
  a notification, and a failure marks the entry as needing attention without
  reverting the merge

### Requirement: Worktree cleanup
The queue SHALL offer confirm-gated cleanup: prune a run's worktree and delete
its branch only when the branch is merged (or the user explicitly confirms
force-cleanup of an unmerged branch with a distinct warning), plus a batch
"clean up merged" action that prunes all merged runs in one confirmed step.
Cleanup SHALL never delete uncommitted work without the explicit force
confirmation naming what will be lost.

#### Scenario: Batch cleanup of merged branches
- **WHEN** three integrated runs have merged branches and the user confirms
  "Clean up merged"
- **THEN** the three worktrees are pruned and branches deleted, the queue
  empties accordingly, and one summary notification reports the cleanup

#### Scenario: Unmerged cleanup requires force confirmation
- **WHEN** the user requests cleanup of an unmerged run branch
- **THEN** a distinct warning states the branch is unmerged and what will be
  lost; without that explicit confirmation nothing is deleted
