## ADDED Requirements

### Requirement: First-Run Foundation Setup
The system SHALL guide new users through essential local-first defaults before agent chat, terminal, or analytics features perform sensitive actions.

#### Scenario: First run opens setup
- **WHEN** a user opens Basebuild for the first time
- **THEN** the app presents a compact setup flow for default terminal, default chat adapter, privacy/analytics posture, and permission behavior

#### Scenario: User skips setup
- **WHEN** the user skips first-run setup
- **THEN** the app uses conservative defaults: OMP chat adapter, platform terminal, analytics disabled, auto-send disabled, and ask-before-sensitive-action permissions

#### Scenario: Setup can be revisited
- **WHEN** the user opens settings later
- **THEN** every first-run default can be reviewed and changed

### Requirement: Capability Health Checks
The system SHALL show health and readiness for foundational integrations required by plan/chat workflows.

#### Scenario: OMP missing
- **WHEN** OMP is not installed or not on PATH
- **THEN** the app shows a clear readiness issue with the failing command/profile and setup guidance

#### Scenario: Git unavailable
- **WHEN** Git is unavailable for a project feature that requires it
- **THEN** the app disables or warns on that feature without breaking chat, terminal, or plan UI

#### Scenario: Profile health refresh
- **WHEN** the user refreshes settings health checks
- **THEN** terminal, OMP, Basebuild CLI profile, Git, storage, and permissions status are revalidated

### Requirement: Action Registry
The system SHALL centralize user-triggered app actions so menu items, buttons, chat commands, and future command palette entries use the same permission and availability checks.

#### Scenario: Action invoked from button
- **WHEN** a UI button invokes a registered action
- **THEN** the action uses the same validation and permission gates as any other entry point

#### Scenario: Action unavailable
- **WHEN** an action is unavailable due to missing project, missing adapter, denied permission, or failed health check
- **THEN** the UI can show a consistent disabled state or actionable error message

#### Scenario: Future command palette
- **WHEN** a command palette or chat slash command is added later
- **THEN** it can invoke existing registered actions without duplicating business logic

### Requirement: Local Data Controls
The system SHALL provide user-visible controls for local Basebuild state created by plans, sessions, settings, permissions, analytics, and agent runtime metadata.

#### Scenario: Export local state
- **WHEN** the user exports local state for a project
- **THEN** the export includes project-local Basebuild data in a documented format without secrets unless explicitly requested

#### Scenario: Delete project state
- **WHEN** the user deletes Basebuild state for a project
- **THEN** plans, sessions, tabs, local analytics events, and project-scoped permission rules for that project are removed after confirmation

#### Scenario: Reset global defaults
- **WHEN** the user resets global app defaults
- **THEN** default profiles, permissions, analytics consent, and settings return to conservative defaults without deleting project plans unless separately requested
