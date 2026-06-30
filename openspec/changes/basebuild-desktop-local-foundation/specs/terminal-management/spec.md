## ADDED Requirements

### Requirement: Local Terminal Panes
The system SHALL provide local terminal panes for project commands independent of OMP RPC.

#### Scenario: Open terminal in project
- **WHEN** the user opens a terminal for the active project
- **THEN** the app starts a PTY-backed shell in the project working directory
- **AND** renders it through an embedded terminal component

### Requirement: Windows Shell Default
The system SHALL default to a useful Windows shell when running on Windows.

#### Scenario: Start Windows terminal
- **WHEN** a terminal pane is opened on Windows
- **THEN** the app starts PowerShell by default unless the user has configured another shell

### Requirement: Terminal Resize and Input
The system SHALL pass terminal input and resize events between the frontend terminal component and the backend PTY.

#### Scenario: Resize terminal pane
- **WHEN** the user resizes the terminal pane
- **THEN** the backend PTY size is updated
- **AND** terminal output remains aligned with the visible terminal dimensions

#### Scenario: Type into terminal
- **WHEN** the user types into a focused terminal pane
- **THEN** input is sent to the PTY process
- **AND** process output is streamed back into the terminal view
