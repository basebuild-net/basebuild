## ADDED Requirements

### Requirement: Open Local Project
The system SHALL allow users to open a local folder as a Basebuild project.

#### Scenario: Select project folder
- **WHEN** the user chooses Open Project
- **THEN** the app displays a native folder picker
- **AND** opening a folder records it as the active project

#### Scenario: Reopen recent project
- **WHEN** the user selects a recent project
- **THEN** the app restores that project as the active workspace without requiring a new folder picker selection

### Requirement: Project Detection
The system SHALL inspect opened projects for Git, OpenSpec, and Basebuild configuration.

#### Scenario: Detect project capabilities
- **WHEN** a folder is opened
- **THEN** the app detects whether it is inside a Git repository
- **AND** detects whether `openspec/` exists
- **AND** detects whether `<project>/.basebuild/` exists

### Requirement: Basebuild Storage Locations
The system SHALL use separate global and project Basebuild storage locations.

#### Scenario: Store global app state
- **WHEN** the app needs to persist global user settings, recent projects, installed packs, or local runtime state
- **THEN** it stores them under `~/.basebuild/` or the platform-equivalent user Basebuild data location

#### Scenario: Store project configuration
- **WHEN** a project needs project-specific Basebuild configuration or prompt/workflow overrides
- **THEN** the app stores editable project files under `<project>/.basebuild/`

#### Scenario: Avoid tracking runtime cache by default
- **WHEN** the app creates project runtime cache, logs, run state, or local databases
- **THEN** those files are placed in ignored subpaths or otherwise marked as non-source configuration
