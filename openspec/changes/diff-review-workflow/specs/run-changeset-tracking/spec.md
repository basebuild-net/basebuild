## ADDED Requirements

### Requirement: Baseline snapshot at run start
When a plan run starts in a git project, the system SHALL record a baseline snapshot as a git ref (`refs/basebuild/run-<run-id>`) capturing tracked content and the list of untracked files, without modifying the working tree, index, or user-visible refs. Baseline creation failure SHALL fail the run start with a clear error, never start an untracked run silently.

#### Scenario: Baseline created
- **WHEN** a queued plan run starts
- **THEN** a baseline ref exists for the run and `git status` output for the user is unchanged by its creation

#### Scenario: Non-git project
- **WHEN** a run starts in a non-git project
- **THEN** the run proceeds with changeset tracking disabled, the run card shows tracking unavailable, and the review gate auto-skips

### Requirement: Changeset attribution
The system SHALL compute the run's changeset (added, modified, deleted files vs baseline, including files untracked at baseline) on demand and at run completion, persisting per-file state on the run record.

#### Scenario: Agent creates and edits files
- **WHEN** a run edits two files and creates one new file
- **THEN** the changeset lists two `modified` and one `added` entry with correct paths

#### Scenario: Concurrent runs in worktrees
- **WHEN** two runs execute in separate worktrees
- **THEN** each changeset is computed against its own worktree and baseline; files never cross-attribute

### Requirement: Baseline cleanup
Baseline refs SHALL be deleted when their run's changeset reaches a terminal review state (all approved/reverted, skipped, or run cancelled with changes discarded), and orphaned baseline refs SHALL be pruned on startup.

#### Scenario: Cleanup after review
- **WHEN** every file in a changeset is approved
- **THEN** the baseline ref is removed and no `refs/basebuild/*` litter remains for that run
