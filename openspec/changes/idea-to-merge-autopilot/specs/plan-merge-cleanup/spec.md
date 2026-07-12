## ADDED Requirements

### Requirement: Merge review session entry
The integration queue SHALL support multi-selecting finished worktree runs
and offer a **Review & merge** action that starts a `workspace-merge-review`
session over the selection. Single-run actions (merge, verify, prune) SHALL
remain available unchanged outside sessions. Runs flagged merge-ready by the
post-finish policy SHALL be pre-selectable as a group.

#### Scenario: Start a session from the queue
- **WHEN** the user selects two finished runs in the integration queue and
  clicks Review & merge
- **THEN** a merge review session starts over exactly those runs in
  dependency-aware order

#### Scenario: Merge-ready group selection
- **WHEN** three runs were flagged merge-ready by the `queue_merge_review`
  policy
- **THEN** the queue offers selecting the merge-ready group in one action and
  starting the session over it
