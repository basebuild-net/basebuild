## ADDED Requirements

### Requirement: Configurable post-finish policy
The system SHALL support a per-project post-finish policy selecting what
happens when an assigned plan run reaches `finished`:

- `hold` (default) — current behavior: the completion card renders and every
  follow-up action stays manual.
- `auto_commit` — the run worktree's changes are committed on the run branch
  with a generated message referencing the plan; never the primary checkout.
- `auto_commit_pr` — `auto_commit`, then push the run branch and create the
  pull request through the existing `plan-final-touches` path.
- `queue_merge_review` — `auto_commit`, then flag the run merge-ready in the
  integration queue.

The policy SHALL be explicit user configuration: it is surfaced (with its
effective value) in the launch confirmation, and selecting a policy that
touches the remote (`auto_commit_pr`) SHALL require a distinct one-time
acknowledgment naming the push. Every automated action SHALL emit a
notification and a log entry naming the run, branch, and result. Merging into
the default branch SHALL NEVER be automatic under any policy. Runs without a
dedicated worktree/branch (non-git projects, primary-checkout runs) SHALL
behave as `hold` regardless of the configured policy. Policy application
failures SHALL surface on the completion card and notification without
retry loops.

#### Scenario: Default hold preserves current behavior
- **WHEN** a run finishes with no policy configured
- **THEN** the completion card renders with manual commit/PR actions exactly
  as today, and no git command runs automatically

#### Scenario: Auto-commit commits only the worktree
- **WHEN** the policy is `auto_commit` and a worktree run finishes
- **THEN** exactly the run worktree's changes are committed on the run branch
  with a plan-referencing message, a notification reports the commit, no push
  occurs, and the primary checkout is untouched

#### Scenario: Auto PR requires the remote acknowledgment
- **WHEN** the user selects `auto_commit_pr` for the first time in a project
- **THEN** a distinct acknowledgment names that finished runs will push their
  branch and open a PR; without it the policy is not saved

#### Scenario: Queue for merge review
- **WHEN** the policy is `queue_merge_review` and a worktree run finishes
- **THEN** the run is committed, flagged merge-ready in the integration queue,
  and a notification links to the queue — no merge into the default branch
  occurs

#### Scenario: Non-git run ignores commit policies
- **WHEN** the policy is `auto_commit` and a run finishes in the primary
  checkout of a non-git project
- **THEN** no commit is attempted, the completion card renders per `hold`,
  and the card notes the policy did not apply

#### Scenario: Policy visible at launch
- **WHEN** the user opens the launch confirmation for a batch of ready plans
- **THEN** the confirmation states the effective post-finish policy alongside
  workers, worktrees, and concurrency
