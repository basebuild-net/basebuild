# file-explorer-modal Specification (delta)

## ADDED Requirements

### Requirement: Modal file browser
The system SHALL provide a full-window modal file browser for the active
project, opened from the environment block's Files control. The modal SHALL
present a navigable directory tree and a preview/detail area, replacing the
always-visible inline file list. It SHALL follow the design contract (0px
radius, `src/styles/globals.css`, tooltips on interactive elements) and the
shared modal overlay contract.

#### Scenario: Open the modal
- **WHEN** the user activates the Files control
- **THEN** a modal opens showing the project's directory tree and a
  preview/detail area

#### Scenario: Dismiss the modal
- **WHEN** the user dismisses the modal (close control or overlay click)
- **THEN** the modal closes and returns focus to the chat surface

### Requirement: Path search
The modal SHALL provide a fuzzy path search that filters the tree to matching
files and directories as the user types.

#### Scenario: Filter by query
- **WHEN** the user types a query in the modal's search field
- **THEN** the tree filters to files and directories whose paths match the query

### Requirement: Open file into a workspace tab
Selecting a file to open in the modal SHALL create (or focus) a file workspace
tab in the center for that file and close the modal.

#### Scenario: Open a file
- **WHEN** the user chooses to open a file from the modal
- **THEN** a file workspace tab for that file becomes active and the modal closes

#### Scenario: Reopen an already-open file
- **WHEN** the user opens a file that already has a workspace tab
- **THEN** the existing tab is focused instead of creating a duplicate
