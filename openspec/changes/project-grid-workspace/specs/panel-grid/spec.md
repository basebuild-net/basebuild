## ADDED Requirements

### Requirement: Unified panel grid container
The system SHALL render a project's center workspace as a single panel grid holding zero or more panels of any type (chat, terminal, file, schematic). Each panel is a leaf in a split tree. The grid SHALL support `1×N` (single row, N panels), `M×1` (single column, M panels), and arbitrary `M×N` splits with no fixed maximum beyond available viewport space. Every panel type renders through the same grid leaf contract — there are no special-case rendering paths for chat vs terminal vs file.

#### Scenario: Single panel in a project
- **WHEN** a project is opened with no prior grid state and the user creates a chat
- **THEN** the grid renders one panel filling the workspace, with no splitters visible

#### Scenario: Mixed panel types side by side
- **WHEN** the user has a chat panel open and splits a terminal beside it
- **THEN** the grid renders a `1×2` layout with a chat panel on the left and a terminal panel on the right, separated by a draggable splitter

#### Scenario: Empty grid
- **WHEN** a project has no panels open
- **THEN** the grid shows an empty state with a "Start a panel" affordance offering chat, terminal, schematic, or file

### Requirement: Panel resize via splitters
The system SHALL provide draggable splitters between adjacent panels in both horizontal and vertical directions. Splitters SHALL enforce a minimum panel size (chat: 320px width / 200px height; terminal: 240px width / 120px height; file/schematic: 300px width / 200px height) and SHALL persist resized dimensions to the project's grid state.

#### Scenario: Drag a horizontal splitter
- **WHEN** the user drags the vertical splitter between two side-by-side panels
- **THEN** the left panel grows and the right panel shrinks by the drag delta, neither dropping below its minimum width

#### Scenario: Drag a vertical splitter
- **WHEN** the user drags the horizontal splitter between two stacked panels
- **THEN** the top panel grows and the bottom panel shrinks by the drag delta, neither dropping below its minimum height

### Requirement: Panel header
Each panel in the grid SHALL render a compact header showing the panel title (inline-editable on double-click), a type icon, a streaming/progress indicator when the panel is active, and a more-actions menu (close, split right, split down, duplicate). The header is a sibling of the panel content, never scrolls out of view, uses 0px radius, and has `title=` tooltips on every interactive element.

#### Scenario: Chat panel header shows streaming state
- **WHEN** a chat panel is actively streaming a response
- **THEN** the header shows a pulsing indicator and the panel's activity-sidebar row shows the same indicator

#### Scenario: Terminal panel header shows exit state
- **WHEN** a terminal panel's shell has exited
- **THEN** the header shows a "shell exited" indicator with a restart affordance

#### Scenario: Inline rename
- **WHEN** the user double-clicks a panel's title in the header
- **THEN** the title becomes editable; on Enter or blur the new title is saved; on Escape the rename is cancelled

### Requirement: Panel creation
The system SHALL let the user create new panels via an "Add panel" affordance in the empty grid state or the more-actions menu. The menu offers Chat, Terminal, Schematic, and (gated on OMP detection) Oh My Pi. Creating a panel when the grid is empty places it as the sole panel; creating via "split right" or "split down" from a header menu splits the active panel.

#### Scenario: Create first panel from empty state
- **WHEN** the grid is empty and the user clicks "Start a panel" → Chat
- **THEN** a chat panel is created as the sole grid leaf and receives focus

#### Scenario: Split right from header menu
- **WHEN** the user opens a panel's more-actions menu and picks "Split right"
- **THEN** the active panel splits into a `1×2` layout with the original on the left and a new empty panel placeholder on the right

#### Scenario: File panel from Files panel
- **WHEN** the user clicks a file in the Files panel
- **THEN** a file panel is added to the grid (split right of the focused panel, or replacing the empty state if no panels are open)
