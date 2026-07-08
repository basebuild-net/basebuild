## ADDED Requirements

### Requirement: Milestone auto-commit during runs
The system SHALL support an opt-in, per-project setting (default off) that
commits automatically inside a plan run's dedicated worktree after each
completed task milestone, with a deterministic message carrying the plan
reference and milestone. Milestone auto-commit SHALL apply only to run
worktrees — never the primary checkout — SHALL never push, and SHALL record
each commit on the run's timeline. Disabling the setting mid-run stops further
auto-commits without touching existing ones.

#### Scenario: Milestone commit in the run worktree
- **WHEN** milestone auto-commit is enabled and a run completes a task
  milestone with file changes in its worktree
- **THEN** a commit is created in that worktree referencing the plan and
  milestone, recorded on the run timeline, and nothing is pushed

#### Scenario: Default off means no commits
- **WHEN** a project has never enabled milestone auto-commit
- **THEN** plan runs create no automatic commits (existing final-touch commit
  steps remain governed by their own explicit configuration)

#### Scenario: Primary checkout is never auto-committed
- **WHEN** milestone auto-commit is enabled and a run executes in the primary
  checkout (non-git-worktree run)
- **THEN** no auto-commit occurs and the run timeline notes that milestone
  commits were skipped
