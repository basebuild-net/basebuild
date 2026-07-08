## MODIFIED Requirements

### Requirement: Assign a plan to a chat
The system SHALL let the user assign a `ready` plan to a chat column. Assignment binds at most one active plan to a chat at a time. Assigning a plan to an empty or free-form chat SHALL be allowed. A chat without an assigned plan SHALL remain a normal free-form chat. Re-assigning a different plan to a chat that already has an active run SHALL require explicit confirmation and SHALL start a fresh run. Selecting a plan in the assignment picker SHALL take effect immediately: the plan binds to that chat's existing session and the run starts or queues (per `run-concurrency-limits`) — an assignment that only records UI state without dispatching a run is PROHIBITED.

#### Scenario: Assign a ready plan to an empty chat
- **WHEN** the user selects "Assign plan" in an empty chat's header menu and picks a `ready` plan
- **THEN** the plan is bound to that chat, the chat header shows the plan badge (reference id + title + status), and (subject to concurrency) the run starts in that chat

#### Scenario: Assignment dispatches, not just decorates
- **WHEN** the user picks a plan in the assignment picker and concurrency allows
- **THEN** within the same action the run is created and starts streaming into that chat's existing session — the same session id the chat had before assignment — and the plan moves to `running`

#### Scenario: At most one active plan per chat
- **WHEN** a chat already has an active assigned plan and the user attempts to assign a second plan
- **THEN** the system prompts to confirm replacing the current plan; on confirm the current run is stopped and the new plan is assigned and run; on cancel the current plan remains

#### Scenario: Free-form chat unaffected
- **WHEN** a chat has no assigned plan
- **THEN** it behaves as a normal free-form chat with no plan badge and no worktree provisioning

#### Scenario: Only ready plans are assignable
- **WHEN** the assign-plan picker is opened
- **THEN** it lists plans in `ready` status for the current project; `draft`/`openspec`/`running`/`finished`/`cancelled` plans are not offered for a new assignment

## ADDED Requirements

### Requirement: Batch launch destinations
Batch launch of ready plans SHALL include a destination mapping step: each
selected plan maps to **a new chat panel** (default) or **an open, unassigned
chat window/tab** chosen by the user, with one destination per plan. The
confirmation SHALL enumerate the final mapping (plan → destination, plus
worktrees/branches/providers to be created) before anything runs. On confirm,
every mapped plan SHALL dispatch through the assignment path above — a launch
that changes plan statuses without creating runs is PROHIBITED. Plans beyond
concurrency caps SHALL queue with visible queued state.

#### Scenario: Mixed destinations launch together
- **WHEN** the user selects three ready plans, maps one to the open idle
  "Chat 2" tab and leaves two on "New panel", and confirms the summary
- **THEN** one run starts in Chat 2's existing session and two new chat panels
  spawn with their own runs, each on its own worktree/branch, subject to
  concurrency caps

#### Scenario: Busy tabs are not offered
- **WHEN** the destination picker lists open tabs while one chat is already
  running an assigned plan
- **THEN** that chat is shown disabled with its plan badge, and cannot be
  chosen without the replace-confirmation flow

#### Scenario: Cancel maps to nothing
- **WHEN** the user dismisses the mapping confirmation
- **THEN** no run, chat, worktree, branch, or status change occurs
