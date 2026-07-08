# plan-chat-assignment Specification

<!-- Merges: ADDED from 'parallel-plan-workspaces' (archived 2026-07-06). -->

## Requirements

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
- **THEN** it lists plans in `ready` status for the current project; `draft`/`openspec`/`running`/`finished`/`cancelled` plans are not offered for a new assignment### Requirement: Assignment provisions worktree and runs
When a plan is assigned to a chat and the run is allowed to start (per `run-concurrency-limits`), the system SHALL provision the worktree on run start (per `parallel-workspaces` — fresh branch from the fetched default branch), seed the chat session from the plan (goal, description, focus context, linked OpenSpec change path, and project schematic, per `plan-run-queue` auto-provisioned run sessions), bind the chat to a single model, move the plan to `running`, and stream the run in that chat column.

#### Scenario: Assignment starts a run in a worktree
- **WHEN** a `ready` plan is assigned to a chat on a git project and concurrency allows
- **THEN** a worktree + branch `bb/<ref>-<slug>` is created from the fetched default branch, the chat session is seeded from the plan, the plan moves to `running`, and the chat header shows `[worktree] [bb/<ref>-<slug>]` plus the plan badge

#### Scenario: Concurrency-limited assignment queues
- **WHEN** a plan is assigned but the provider's concurrency limit is already reached
- **THEN** the plan is queued (not run immediately), the chat header shows a "queued" state, and the run starts automatically when a slot frees

#### Scenario: Non-git assignment runs in place
- **WHEN** a plan is assigned on a non-git project
- **THEN** no worktree is created, the run executes in the primary checkout, and the chat header shows the plan badge but no worktree/branch indicator

### Requirement: Concurrent assigned runs
The system SHALL support multiple chats each running their own assigned plan concurrently, subject to `run-concurrency-limits`. Each concurrent run operates in its own worktree/branch and streams in its own chat column, and completes independently.

#### Scenario: Two chats run two plans concurrently
- **WHEN** two `ready` plans are assigned to two chat columns and the provider concurrency limit is ≥ 2
- **THEN** both runs execute at the same time, each in its own worktree on its own branch, streaming into its own chat column, without interfering with each other

#### Scenario: Third assignment queues at the cap
- **WHEN** a third plan is assigned while two runs already occupy the provider's concurrency limit of 2
- **THEN** the third run is queued and starts only when one of the two active runs finishes

#### Scenario: Independent completion
- **WHEN** one of two concurrent runs finishes while the other continues
- **THEN** the finished chat surfaces its pull-request recommendation while the other run keeps streaming, unaffected

### Requirement: Pull-request recommendation on finish
When an assigned plan run finishes on its own worktree branch, the system SHALL surface a pull-request recommendation in that chat: the branch name, ahead/behind counts, and changed-file summary, with an explicit, confirm-gated action to create the pull request (per `plan-final-touches`). The system SHALL NOT push or open a pull request without explicit user confirmation.

#### Scenario: Finish recommends a pull request
- **WHEN** an assigned plan run on branch `bb/x7k2p1-add-dark-mode` reaches `finished` with committed changes
- **THEN** the chat shows a recommendation card with the branch, ahead/behind, and changed-file count, and a "Create pull request" button that is inert until the user clicks and confirms

#### Scenario: No worktree, no recommendation
- **WHEN** a plan run finishes but the project is non-git or the run was in the primary checkout (no dedicated branch)
- **THEN** no pull-request recommendation is shown

#### Scenario: Declining leaves the branch intact
- **WHEN** the user dismisses the pull-request recommendation
- **THEN** the branch and worktree remain on disk for later action, and the plan stays `finished`

### Requirement: Batch launch into parallel chats
The system SHALL support launching multiple selected `ready` plans in one
confirm-gated action: for each plan, a chat panel is created (or an idle
existing assigned chat reused) and the plan is assigned through the existing
single-assignment semantics (own worktree/branch on run start, per-provider
concurrency caps, queued state beyond caps). The confirmation SHALL enumerate
what will be created — chats, worktrees, branches, provider/model per run —
before anything is provisioned, and declining SHALL create nothing. Each
launched run SHALL emit run-started planning events; runs queued at the cap
SHALL be visibly queued, not failed.

#### Scenario: Batch launch provisions per-plan chats
- **WHEN** the user batch-launches three ready plans and confirms
- **THEN** three chats exist, each with one plan assigned, each run on its own
  branch/worktree subject to concurrency caps

#### Scenario: Beyond-cap plans queue visibly
- **WHEN** five plans are batch-launched with a provider cap of 2
- **THEN** two runs start and three show queued state, starting automatically
  as slots free

#### Scenario: Decline creates nothing
- **WHEN** the user declines the batch-launch confirmation
- **THEN** no chat, worktree, branch, run, or status change occurs

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
