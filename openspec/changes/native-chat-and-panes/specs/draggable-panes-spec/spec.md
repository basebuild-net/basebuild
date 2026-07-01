## ADDED Requirements

### Requirement: Draggable Split Panes
The system SHALL support splitting a workspace tab into multiple panes arranged side-by-side or stacked, with draggable dividers for resizing.

#### Scenario: User drags a tab to split
- **WHEN** the user drags a workspace tab and drops it on the edge of another tab's pane
- **THEN** the target pane splits into two panes (side-by-side or stacked based on drop zone) and the dragged tab fills the new pane

#### Scenario: User resizes a pane
- **WHEN** the user drags the divider between two panes
- **THEN** the panes resize proportionally to the drag position

#### Scenario: User closes a pane
- **WHEN** the user closes a tab within a split pane
- **THEN** the pane is removed and the remaining pane expands to fill the space

### Requirement: Terminal Debug Mode
The system SHALL provide a "Terminal Debug" mode that shows a terminal and a chat side-by-side in a single tab, both connected to the same OMP PTY.

#### Scenario: User enables debug mode
- **WHEN** the user clicks "Debug" in the chat tab view toggle
- **THEN** the tab splits into two panes: terminal on the left, chat on the right

#### Scenario: Terminal and chat are synced
- **WHEN** the OMP PTY emits output in debug mode
- **THEN** both the terminal pane and the chat pane receive the output simultaneously

#### Scenario: User interacts with terminal in debug mode
- **WHEN** the user types in the terminal pane in debug mode
- **THEN** the input is sent to the OMP PTY and the chat pane reflects the interaction

### Requirement: Pane Layout Persistence
The system SHALL persist the pane layout for each session tab and restore it on app restart.

#### Scenario: Pane layout saved
- **WHEN** the user creates or modifies a split pane layout
- **THEN** the layout tree is saved to the database as part of the session tab metadata

#### Scenario: Pane layout restored
- **WHEN** the app restarts and tabs are restored
- **THEN** the pane layout is reconstructed from the saved layout tree
