## ADDED Requirements

### Requirement: Run progress visibility
Every surface that lists a running plan (flow board, plans tab, command strip,
chat header plan badge) SHALL show live progress: task completion (`n/m` from
the linked change), an activity indicator while the run's turn is executing,
and a distinct queued state for runs waiting on concurrency. Progress SHALL
update from planning events, not manual refresh.

#### Scenario: Running plan shows ticking progress
- **WHEN** a plan run marks tasks 3 and 4 of 10 done during a turn
- **THEN** the plan's row and badge show `4/10` with an active indicator,
  without the user reopening the surface

#### Scenario: Queued run is distinguishable
- **WHEN** a launched plan is waiting on a concurrency slot
- **THEN** its indicator shows queued (not running, not failed), with the
  provider cap named in the tooltip

### Requirement: Mark-as-complete prompt
When a run ends its final turn with the linked checklist incomplete, or when
completion cannot be inferred (no linked change or `0/0` tasks), the system
SHALL surface a "Mark as complete?" card in the run's chat and a notification
— stating tasks remaining (`n/m`) — with actions: mark complete (confirm-gated,
moves plan to `finished` and records manual completion), keep running (resume
or leave `ready`), or open the checklist. When all tasks complete and the run
auto-finishes, the completion card SHALL render without the prompt (already
complete). The system SHALL NOT mark a plan `finished` from an incomplete
checklist without this explicit user action.

#### Scenario: Agent stops early
- **WHEN** a run's loop ends with `7/10` tasks done
- **THEN** the chat shows "Mark as complete? 7/10 tasks" with mark-complete /
  keep-running / open-checklist actions, and the plan is not `finished` until
  the user chooses

#### Scenario: Full checklist auto-completes into the card
- **WHEN** the checklist reaches `10/10` during a run
- **THEN** the run auto-finishes (existing behavior preserved) and the
  completion card renders in its completed state with follow-up actions

### Requirement: Completion card commit and PR actions
The completion card SHALL offer confirm-gated follow-up actions wired to the
existing services: **Commit** (stages and commits the run's worktree changes
with an editable message; worktree-scoped, never the primary checkout when a
worktree exists) and **Create pull request** (existing recommend/create path,
including the no-`gh` browser fallback). Both SHALL enumerate exactly what
will happen (branch, file count, target) in the confirmation, SHALL never run
without an explicit click, and SHALL report success or failure as a
notification and on the card.

#### Scenario: Commit from the card
- **WHEN** the user clicks Commit on a finished run's card, edits the message,
  and confirms
- **THEN** exactly the run worktree's changes are committed on the run branch,
  the card shows the new commit, and no push occurs

#### Scenario: PR from the card
- **WHEN** the user clicks Create pull request and confirms
- **THEN** the branch is pushed and a PR is created via `gh` (or the compare
  URL opens when `gh` is unavailable), and the card links the result

#### Scenario: Declining does nothing
- **WHEN** the user dismisses either confirmation
- **THEN** no git command runs and the card state is unchanged

### Requirement: Source-control context on completion surfaces
The completion card and finished-run rows SHALL show source-control context:
branch name, ahead/behind vs the fetched default branch, changed-file count,
and worktree path when applicable. When the context is unavailable (non-git
project, unborn HEAD, detached state), the card SHALL render without the
context block — never an error body.

#### Scenario: Context on a worktree run
- **WHEN** a run finishes on `bb/x7k2p1-dark-mode` with 12 changed files,
  3 ahead
- **THEN** the card shows the branch, `3 ahead`, `12 files`, and the worktree
  path with a reveal action

#### Scenario: Non-git degrades gracefully
- **WHEN** a run finishes in a non-git project
- **THEN** the card shows completion state and actions that apply (no commit/
  PR), with no raw git error text anywhere
