## ADDED Requirements

### Requirement: Shared Updates and Requirements UI
The system SHALL provide one shared UI for missing dependencies, app updates, config-pack updates, and future skill/plugin updates.

#### Scenario: Show badge count
- **WHEN** one or more requirements or updates need attention
- **THEN** the app displays an attention count such as `[1]` on the Updates & Requirements entry point

#### Scenario: Open updates panel
- **WHEN** the user opens Updates & Requirements
- **THEN** the app displays requirement cards and update cards grouped by category

### Requirement: Dependency Requirement Cards
The system SHALL represent missing local dependencies as actionable requirement cards.

#### Scenario: Missing Git requirement
- **WHEN** Git is required and not detected
- **THEN** the panel displays Git as a missing requirement
- **AND** provides install/help actions appropriate for Windows first
- **AND** provides a re-check action after installation

### Requirement: App Update Readiness
The system SHALL be designed for Tauri updater-compatible app updates while allowing manual update checks first.

#### Scenario: Check app update status
- **WHEN** the user manually checks for app updates
- **THEN** the app queries the configured release/update service
- **AND** displays whether the current version is up to date or a newer version is available

#### Scenario: One-click app update not yet configured
- **WHEN** an update is available but updater signing or artifact hosting is not configured
- **THEN** the UI offers a download/open-release action instead of showing a broken install action

### Requirement: Config Update Readiness
The system SHALL use the same Updates & Requirements UI for config-pack updates.

#### Scenario: Config pack update card
- **WHEN** a config pack has a newer available version
- **THEN** the panel shows installed version, available version, source, and review/update actions
