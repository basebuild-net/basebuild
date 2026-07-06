## MODIFIED Requirements

### Requirement: Chat As Default Workspace Target
The system SHALL treat chat as a first-class panel type in the project grid alongside terminal, file, schematic, and debug surfaces. Any workflow requesting an agent conversation SHALL create or focus a chat panel in the active project's grid.

#### Scenario: Workflow opens chat
- **WHEN** any workflow requests an agent conversation
- **THEN** the center workspace creates or focuses a chat panel in the project grid

#### Scenario: Reuse active chat panel
- **WHEN** the currently focused panel is already a chat panel
- **THEN** workflow prompt injection uses that panel rather than creating a new one

#### Scenario: Reuse existing non-focused chat panel
- **WHEN** a chat panel exists in the grid but is not focused
- **THEN** workflow prompt injection focuses the most recently created chat panel unless the workflow requests a specific chat panel

### Requirement: Tab Creation
**REMOVED** — replaced by panel creation in `panel-grid`. The "+" menu is replaced by the panel grid's "Add panel" affordance and the more-actions "split" commands. The system SHALL create new panels via the grid's empty-state affordance or the more-actions menu's "Split right" / "Split down" actions, offering Terminal, Schematic, Chat, and (gated on OMP detection) Oh My Pi.

#### Scenario: Create terminal panel
- **WHEN** the user picks "Terminal" from the grid's add-panel menu
- **THEN** a terminal panel is created in the grid, a PTY is spawned, the panel receives focus, and the terminal is displayed

#### Scenario: Create chat panel
- **WHEN** the user picks "Chat" from the grid's add-panel menu
- **THEN** a chat panel is created in the grid and receives focus

### Requirement: Center Workspace Rendering
The system SHALL render the center workspace as a single panel grid per project. The grid holds any mix of panel types (chat, terminal, file, schematic) as leaves in a split tree. The tab bar is removed; panels are created, focused, and closed via the grid's header menus and drag interactions.

#### Scenario: Project with grid
- **WHEN** a project is opened
- **THEN** the center workspace renders the project's panel grid, restoring the saved split tree and panel sizes

#### Scenario: Empty project
- **WHEN** a project is opened with no saved grid state
- **THEN** the center workspace shows the grid's empty state with an "Add panel" affordance

### Requirement: Left Sidebar Activity List
The system SHALL render a left sidebar showing the active project's live panel status (title, type icon, progress indicator) instead of a chat-session list. Clicking a row focuses the corresponding panel in the grid. The sidebar includes a "History" button to open the workspace-history drawer.

#### Scenario: Panels visible in sidebar
- **WHEN** the grid has 3 panels open (chat, terminal, file)
- **THEN** the sidebar shows 3 rows with their titles, type icons, and status indicators

#### Scenario: No panels
- **WHEN** the grid is empty
- **THEN** the sidebar shows no panel rows and a muted "History" button
