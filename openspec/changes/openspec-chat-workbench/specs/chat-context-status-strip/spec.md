## ADDED Requirements

### Requirement: Per-chat context strip under the composer
Each chat window SHALL show a compact context strip adjacent to or under the chat input. The strip SHALL show workspace id, branch, worktree path/policy, assigned plan/change, plan status, task progress, queue/run state, provider/model/effort, and context-window usage. Narrow layouts MAY collapse labels, but the information SHALL remain reachable through tooltips or expansion.

#### Scenario: Assigned OpenSpec plan is visible at the input
- **WHEN** a chat has an assigned OpenSpec plan
- **THEN** the context strip shows the plan reference, OpenSpec change slug, status, and `completed/total` task progress under the input

#### Scenario: Worktree context is visible
- **WHEN** a run executes in an isolated worktree
- **THEN** the context strip shows the worktree indicator, branch name, and workspace id with the full path in a tooltip

#### Scenario: Queue state is visible
- **WHEN** a plan is queued due to dependency or provider concurrency limits
- **THEN** the context strip shows `queued`, the blocker reason, and the expected next unlock condition when known

#### Scenario: Free-form chat remains simple
- **WHEN** a chat has no assigned plan
- **THEN** the strip still shows provider/model/context usage but omits plan/worktree rows that do not apply

### Requirement: Context window progress visualization
The composer SHALL show context-window utilization as a progress circle or equivalent compact meter. The meter SHALL use local estimates/metrics only and SHALL distinguish healthy, warning, and critical ranges with color plus text.

#### Scenario: Context usage is healthy
- **WHEN** estimated context usage is below the warning threshold
- **THEN** the meter shows the percentage and exact token estimate in its tooltip

#### Scenario: Context usage is near limit
- **WHEN** estimated context usage crosses the warning threshold
- **THEN** the meter changes to warning state and links to compaction/summary actions when available

#### Scenario: Unknown context is explicit
- **WHEN** the selected model has no known context window
- **THEN** the meter shows `unknown` rather than fabricating a limit

### Requirement: Context strip updates are live
The context strip SHALL update when branch/worktree, selected model/effort, assigned plan, OpenSpec task progress, run state, or context usage changes. Updates SHALL not require closing and reopening the chat.

#### Scenario: Task progress updates after file change
- **WHEN** linked OpenSpec `tasks.md` progress changes
- **THEN** the chat context strip updates its progress count and status color after the existing progress refresh/file-change detection

#### Scenario: Model switch updates context meter
- **WHEN** the user changes the model in a chat
- **THEN** the context limit and usage display update for that chat only
