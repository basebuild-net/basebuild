## ADDED Requirements

### Requirement: Activity sidebar shows live panel status
The system SHALL render a left sidebar showing the active project's current grid panels as an ordered list. Each row shows: the panel title (truncated), a type icon (chat, terminal, file, schematic), a live status indicator, and click-to-focus. The list order matches the grid's reading order (row-major: left-to-right, top-to-bottom).

#### Scenario: Chat panel streaming
- **WHEN** a chat panel in the grid is actively streaming a response
- **THEN** its activity-sidebar row shows a pulsing colored dot (blue for active streaming) and the panel title

#### Scenario: Terminal panel idle
- **WHEN** a terminal panel is open but no command is running
- **THEN** its activity-sidebar row shows a muted dot and the panel title

#### Scenario: Click to focus
- **WHEN** the user clicks an activity-sidebar row
- **THEN** the corresponding panel in the grid receives focus (outline + keyboard input)

### Requirement: Progress and status indicators
Each activity-sidebar row SHALL show a status indicator that reflects the panel's current state: idle (muted dot), streaming/thinking (pulsing blue dot), running command (spinner), error (red dot), finished/succeeded (green dot, fades after 5s). The indicator uses color + animation so the user can see panel activity at a glance without looking at the grid.

#### Scenario: Chat thinking
- **WHEN** a chat panel's provider is processing a request (time to first token > 500ms)
- **THEN** the activity-sidebar row shows a pulsing amber dot with a "thinking" tooltip

#### Scenario: Chat error
- **WHEN** a chat panel's last request failed
- **THEN** the activity-sidebar row shows a red dot with the error message in its tooltip

#### Scenario: Terminal command running
- **WHEN** a terminal panel has a foreground process running
- **THEN** the activity-sidebar row shows a spinner and the panel title

### Requirement: Per-project grouping
The sidebar SHALL group panels by project. When the user switches projects, the sidebar shows the new project's panels. Panels from other projects are not visible. The sidebar's panel list updates live as panels are added, removed, or reordered in the grid.

#### Scenario: Switch projects
- **WHEN** the user switches from project A to project B
- **THEN** the sidebar shows project B's panels (or empty if none) and project A's panels are retained in its grid state

#### Scenario: Panel added
- **WHEN** a new panel is created in the grid
- **THEN** the sidebar immediately shows the new panel's row

### Requirement: History access from sidebar
The sidebar SHALL include a "History" button at the bottom that opens the workspace-history drawer for the active project. The button shows a count of closed panels when non-zero.

#### Scenario: History button with count
- **WHEN** the active project has 3 closed panels in history
- **THEN** the sidebar's History button shows "History (3)" and a tooltip

#### Scenario: History button empty
- **WHEN** the active project has no closed panels
- **THEN** the History button shows "History" with a muted icon and is still clickable (opens an empty drawer)
