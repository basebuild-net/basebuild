## MODIFIED Requirements

### Requirement: Assignment carries validated execution context
Assigning a ready plan to a chat SHALL bind an immutable validated OpenSpec artifact bundle plus selected engine, provider/model/effort, skill, worker/workspace policy, priority, prerequisites, affected paths, OpenSpec change path, task progress, and queue policy. The action SHALL create a queued or running run; changing status without dispatch SHALL be an error. The chat header and context strip SHALL immediately show the assigned plan, OpenSpec change, progress, branch/worktree policy, and queue/run state.

#### Scenario: Ready plan is assigned to an existing chat
- **WHEN** the user assigns a validated ready OpenSpec plan to an idle existing chat
- **THEN** the chat header shows the plan/change badge, the context strip shows execution context and progress, the artifacts are delivered exactly once, and a run is queued or started according to dependency/concurrency policy

#### Scenario: Assignment does not duplicate artifacts
- **WHEN** an OpenSpec-backed plan is assigned
- **THEN** the opening prompt references `openspec/changes/<slug>/` and does not paste duplicate copies of every artifact into the chat when a path reference is sufficient

#### Scenario: Worktree policy is visible before dispatch
- **WHEN** the assignment picker is confirming a run
- **THEN** it enumerates destination chat, OpenSpec change, workspace policy, branch/worktree name, provider/model/effort, prerequisites, affected paths, and queue reason before anything is provisioned

#### Scenario: Queue state persists
- **WHEN** a plan assignment queues instead of starting immediately
- **THEN** the chat remains assigned, shows `queued` with blocker reason, and starts automatically when dependency/provider slots allow

### Requirement: Batch launch destinations
Batch launch of ready OpenSpec plans SHALL include a destination mapping step: each selected plan maps to a new chat panel (default) or an open, unassigned chat window/tab chosen by the user, with one destination per plan. The confirmation SHALL enumerate the final mapping (plan → destination, OpenSpec change, worktrees/branches/providers to be created) before anything runs. On confirm, every mapped plan SHALL dispatch through the assignment path above — a launch that changes plan statuses without creating runs is PROHIBITED. Plans beyond concurrency caps SHALL queue with visible queued state.

#### Scenario: Mixed destinations launch together
- **WHEN** the user selects three ready plans, maps one to the open idle `Chat 2` tab and leaves two on `New panel`, and confirms the summary
- **THEN** one run starts in Chat 2's existing session and two new chat panels spawn with their own runs, each on its own worktree/branch subject to concurrency caps

#### Scenario: Busy tabs are not offered
- **WHEN** the destination picker lists open tabs while one chat is already running an assigned plan
- **THEN** that chat is shown disabled with its plan badge, and cannot be chosen without the replace-confirmation flow

#### Scenario: Cancel maps to nothing
- **WHEN** the user dismisses the mapping confirmation
- **THEN** no run, chat, worktree, branch, or status change occurs
