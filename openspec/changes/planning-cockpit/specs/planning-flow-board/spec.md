<!-- Base: `planning-flow-board` delta in `planning-command-center` (archive
     that change first). "Batch launch of ready plans" is restated MODIFIED in
     full; the other requirements here are additive. -->

## ADDED Requirements

### Requirement: Persistent command strip
The shell SHALL show a persistent, compact planning command strip (at the
"Plans & Ideas" entry surface) without opening any modal: per-stage counts
(Schematic health, Ideas, Plans, Running, Finished/Integration), status
colors, an activity pulse while any planning turn or run is executing, the
unread planning badge, and task progress for running plans (aggregate `n/m`).
The strip SHALL update live from planning events, each element SHALL carry a
`title=` tooltip, and clicking an element SHALL open the full planning surface
on that stage. The strip SHALL be collapsible to a single badge and its state
SHALL persist per project.

#### Scenario: Strip reflects a running pipeline
- **WHEN** two plans run (7/10 and 2/8 tasks) while ideas generate
- **THEN** the strip shows Running `2` with a pulse and `9/18`, Ideas with an
  active indicator, and colors matching each stage's status — without any
  modal open

#### Scenario: Click-through to a stage
- **WHEN** the user clicks the strip's Plans count
- **THEN** the full planning surface opens directly on the Plans view

#### Scenario: Badge clears on open
- **WHEN** unread planning events exist and the user opens the planning
  surface from the strip
- **THEN** the unread badge clears

### Requirement: Wide-layout planning surface
The planning surface (board, plans/ideas/categories tabs, change catalog) and
the source-control surface SHALL fill their host container and adapt layout to
its width: at wide sizes they SHALL use multi-column master–detail layouts
(list + detail side by side; board stages as columns) instead of a single
narrow column; no fixed pixel canvas is permitted. Both surfaces SHALL remain
fully usable at narrow widths by stacking.

#### Scenario: Wide window uses columns
- **WHEN** the planning surface opens in a ≥1600px window
- **THEN** stages/lists and the selected entity's detail render side by side
  with no horizontal cramping, and resizing the window reflows the layout

#### Scenario: Narrow window stacks
- **WHEN** the same surface renders at ~800px width
- **THEN** content stacks vertically with all controls reachable — no
  overflowed run-on chips or clipped tabs

## MODIFIED Requirements

### Requirement: Batch launch of ready plans
The board SHALL offer a confirm-gated batch launch: select multiple `ready`
plans and start them together via the plan-chat assignment path (own
worktree/branch, per-provider concurrency caps), with a destination mapping
step per `plan-chat-assignment`'s batch-launch-destinations requirement (new
panel by default, or a chosen open unassigned tab). The confirmation SHALL
state exactly what will be created (plan → destination mapping, number of
chats, worktrees, branches, and target provider/model) before anything runs.
On confirm every mapped plan SHALL dispatch a real run — changing plan
statuses without creating runs is PROHIBITED. Plans beyond concurrency caps
SHALL queue with visible queued state, not fail.

#### Scenario: Launch three plans in parallel
- **WHEN** the user selects three ready plans, clicks "Launch selected",
  keeps the default mapping, and confirms the summary (3 chats, 3 worktrees,
  provider caps shown)
- **THEN** three chat panels spawn, each assigned one plan on its own
  branch/worktree, runs start subject to concurrency caps, and the Runs stage
  shows all three

#### Scenario: Launch is never a status flip
- **WHEN** a batch launch is confirmed
- **THEN** every plan that moves to `running` has a corresponding run row and
  streaming chat; if run creation fails for a plan, that plan reverts to
  `ready` with the error reported per plan

#### Scenario: Cancel at the confirmation
- **WHEN** the user dismisses the batch-launch confirmation
- **THEN** no chat, worktree, branch, or run is created
