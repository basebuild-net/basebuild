## ADDED Requirements

### Requirement: Installed Git CLI Requirement
The system SHALL use the installed `git` CLI for source-control operations and SHALL NOT require git2 or another embedded Git library for the first implementation.

#### Scenario: Git is installed
- **WHEN** the active project is a Git repository and `git --version` succeeds
- **THEN** the Source Control tab is enabled
- **AND** the detected Git version is available to the requirements status model

#### Scenario: Git is missing
- **WHEN** `git --version` fails
- **THEN** the app shows a missing Git requirement in the Updates & Requirements UI
- **AND** the Source Control tab provides install/re-check actions instead of failing silently

### Requirement: Source Control Status
The system SHALL show a simple VS Code-like source-control view for the active Git repository.

#### Scenario: Display changed files
- **WHEN** the active project has changed files
- **THEN** the Source Control tab lists changed files grouped by unstaged and staged state

#### Scenario: Display branch summary
- **WHEN** the active project is a Git repository
- **THEN** the Source Control tab displays the current branch name and basic ahead/behind state when available

### Requirement: Source Control Actions
The system SHALL support common local Git actions through the installed Git CLI.

#### Scenario: Stage and unstage file
- **WHEN** the user stages or unstages a file
- **THEN** the app runs the corresponding Git command
- **AND** refreshes the source-control status after completion

#### Scenario: Commit staged changes
- **WHEN** the user enters a commit message and commits staged changes
- **THEN** the app runs Git commit through the installed Git CLI
- **AND** shows success or actionable Git error output

#### Scenario: Discard changes with confirmation
- **WHEN** the user chooses to discard local changes
- **THEN** the app asks for confirmation before running the destructive Git restore operation

### Requirement: Diff and History Views
The system SHALL provide simple diff and history views for local source-control work.

#### Scenario: Open file diff
- **WHEN** the user selects a changed file
- **THEN** the main pane displays the file diff for staged or unstaged content

#### Scenario: Show basic history
- **WHEN** the user opens repository history
- **THEN** the app displays a simple recent commit list or graph derived from Git log output
