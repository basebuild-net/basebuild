## ADDED Requirements

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
