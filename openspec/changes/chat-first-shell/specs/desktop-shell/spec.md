# desktop-shell Specification (delta)

## ADDED Requirements

### Requirement: Single-column shell layout
The shell SHALL be a two-region layout: the global left column
(`project-chat-sidebar`) and the center chat surface. The system SHALL NOT
render a right side panel; source, plans/ideas, and files are surfaced by the
`chat-environment-panel` (floating block) and `file-explorer-modal` instead.

#### Scenario: No right side panel
- **WHEN** the shell renders
- **THEN** there is no persistent right accordion column; the center chat
  surface fills the width beside the left column

#### Scenario: Environment surfaces relocated
- **WHEN** the user needs source, plans/ideas, or files
- **THEN** those are reached through the floating environment block and the file
  modal, not a right column

### Requirement: Native window chrome and application menu
The application window SHALL use native operating-system window decorations
(title bar, minimize / maximize / close) and SHALL provide a standard
application menu with `File`, `Edit`, and `View`. The in-app custom top bar
SHALL be removed; global account and update controls live in the left column's
bottom account row.

#### Scenario: Native decorations
- **WHEN** the app window is shown
- **THEN** it renders with native OS window decorations rather than a custom
  in-app title bar

#### Scenario: Application menu present
- **WHEN** the window is focused
- **THEN** a `File / Edit / View` application menu is available

#### Scenario: No in-app top bar
- **WHEN** the shell renders
- **THEN** no in-app top bar is shown; account and update controls are in the
  left column's bottom row

## MODIFIED Requirements

### Requirement: File Opening
The system SHALL open files chosen in the file-explorer modal as workspace tabs.

#### Scenario: Open a file from the modal
- **WHEN** the user opens a file from the file-explorer modal
- **THEN** a file tab is created with the file name, the content is displayed in
  the FileViewer, and the tab becomes active

#### Scenario: Reopen an already-open file
- **WHEN** the user opens a file that is already open in a tab
- **THEN** the existing tab is focused instead of creating a duplicate
