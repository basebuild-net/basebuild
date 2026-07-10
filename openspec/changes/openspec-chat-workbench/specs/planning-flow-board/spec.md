## MODIFIED Requirements

### Requirement: Lifecycle flow board
The planning surface SHALL include a highly visual flow board presenting the pipeline as ordered stages — Schematic, Ideas, OpenSpec, Ready, Running, Review/Integration — each stage showing a live count, status color, activity indicator, and primary action. Stages SHALL be drillable: opening a stage shows visual cards with per-entity status, progress, owner chat, branch/worktree, current blocker, and navigation (idea → OpenSpec generation, plan → artifact view, run → chat panel). The board SHALL update live from planning events. All interactive elements SHALL have `title=` tooltips and 0px radius.

#### Scenario: Board reflects a running generation
- **WHEN** an idea generation turn is streaming
- **THEN** the Ideas stage shows an active indicator, its count increments as ideas are captured, and a visible `Generating ideas…` row appears without manual refresh

#### Scenario: Drill into runs
- **WHEN** the user opens the Running stage while two plans run in parallel
- **THEN** both runs are listed as visual cards with plan reference, model, status word, branch/worktree, task progress, and a click action that focuses the owning chat panel

#### Scenario: Schematic stage reflects health
- **WHEN** the schematic health is `partial`
- **THEN** the Schematic stage shows the degraded state with a tooltip naming incomplete sections and an action that opens the wizard

#### Scenario: Add more from the board
- **WHEN** the user is in the Ideas, OpenSpec, Ready, or Running stage
- **THEN** a visible `+` action offers the next sensible add action: generate more ideas, run selected idea through OpenSpec, assign ready plans, or add another worker/chat

### Requirement: Visual planning command center
The planning command center SHALL be the visual cockpit for the MVP loop. It SHALL show how many ideas, OpenSpec drafts, ready plans, queued runs, running workers, blocked runs, review items, and finished items exist. Counts SHALL use both words and color. Primary actions SHALL be clickable cards/buttons: `Generate ideas`, `Run through OpenSpec`, `Assign to chat`, `Start queue`, `Add worker`, `Review`, `Merge`, and `Archive/Sync`. The user SHALL NOT need to infer state from raw plan rows or file names.

#### Scenario: Counts show current workload
- **WHEN** a project has 6 ideas, 2 OpenSpec plans, 1 ready plan, 3 queued runs, and 2 running workers
- **THEN** the command center shows those counts with labels and status colors in one glance

#### Scenario: Idea can be sent to OpenSpec by click
- **WHEN** the user selects an idea card and clicks `Run through OpenSpec`
- **THEN** the app starts the OpenSpec artifact generation flow, updates the idea/plan status visibly, and adds or updates the OpenSpec stage count

#### Scenario: User can add more work easily
- **WHEN** a user wants more ideas or workers
- **THEN** the command center exposes visible `+ Generate ideas` and `+ Add worker/chat` actions without hiding them in a text-only menu

#### Scenario: Status color always has words
- **WHEN** a card is `queued`, `running`, `blocked`, `review`, `finished`, or `failed`
- **THEN** the card shows that word next to its color/icon so color is never the only signal

### Requirement: Shared run board
The flow board SHALL provide a project-scoped run board showing each worker's plan, priority, prerequisites, owner chat, provider/model/skill, project, branch/worktree, affected-path claims, progress, blockers, collision state, and merge readiness. The board SHALL be visual first: cards/nodes SHALL show status words, vibrant colors, progress bars, current activity, and clickable navigation to the owning chat/timeline. The board SHALL be the coordination source of truth for workers and users.

#### Scenario: Worker reports a new file claim
- **WHEN** a running worker claims a path that overlaps another ready or running plan
- **THEN** the board updates both nodes, the scheduler applies the configured collision policy, and the reason is visible and debug-logged

#### Scenario: Running workers are obvious
- **WHEN** multiple workers are running or queued
- **THEN** the run board shows total running/queued/blocked counts, progress bars for each worker, and the currently executing tool/thinking/question summary where available
