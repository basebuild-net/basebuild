## ADDED Requirements

### Requirement: Lifecycle flow board
The planning surface SHALL include a flow board presenting the pipeline as
ordered stages — Schematic, Ideas, Plans, Runs, Integration — each stage
showing a live count, a status color, and an activity indicator (pulse/spinner)
while a related turn, run, or integration action is executing. Stages SHALL be
drillable: opening a stage shows its entities with per-entity status and
navigation (idea → inspector, plan → plan view, run → its chat panel). The
board SHALL update live from planning events. All interactive elements SHALL
have `title=` tooltips and 0px radius.

#### Scenario: Board reflects a running generation
- **WHEN** an idea generation turn is streaming
- **THEN** the Ideas stage shows an active indicator, and the count increments
  as ideas are captured, without manual refresh

#### Scenario: Drill into runs
- **WHEN** the user opens the Runs stage while two plans run in parallel
- **THEN** both runs are listed with plan reference, status, and branch, and
  clicking one focuses its chat panel

#### Scenario: Schematic stage reflects health
- **WHEN** the schematic health is `partial`
- **THEN** the Schematic stage shows the degraded state with a tooltip naming
  incomplete sections and an action that opens the wizard

### Requirement: Batch idea approval
The board and the Ideas tab SHALL support multi-selecting `concept` ideas and
approving them in one action: each approved idea is promoted through the
existing promotion path (idea → `picked`, linked plan created). The action
SHALL report per-idea results and SHALL NOT stop at the first failure.

#### Scenario: Approve five ideas at once
- **WHEN** the user selects five concept ideas and clicks "Approve selected"
- **THEN** five plans are created, each idea moves to `picked` with a plan
  back-link, one summary toast reports "5 plans created", and the board's
  Plans count reflects them

#### Scenario: Partial failure is reported per idea
- **WHEN** one of the selected ideas fails to promote (e.g. row deleted
  concurrently)
- **THEN** the other promotions still complete and the summary names the
  failed idea and reason

### Requirement: Batch launch of ready plans
The board SHALL offer a confirm-gated batch launch: select multiple `ready`
plans and start them together, each in its own chat panel via the existing
plan-chat assignment path (own worktree/branch, per-provider concurrency
caps). The confirmation SHALL state exactly what will be created (number of
chats, worktrees, branches, and target provider/model) before anything runs.
Plans beyond concurrency caps SHALL queue with visible queued state, not fail.

#### Scenario: Launch three plans in parallel
- **WHEN** the user selects three ready plans, clicks "Launch selected", and
  confirms the summary (3 chats, 3 worktrees, provider caps shown)
- **THEN** three chat panels spawn, each assigned one plan on its own
  branch/worktree, runs start subject to concurrency caps, and the Runs stage
  shows all three

#### Scenario: Cancel at the confirmation
- **WHEN** the user dismisses the batch-launch confirmation
- **THEN** no chat, worktree, branch, or run is created
