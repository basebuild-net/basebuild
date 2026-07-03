## ADDED Requirements

### Requirement: Injected-context inspection
Each native chat session SHALL expose an inspector listing every injected context part: source path, token size, truncation state, staleness (file changed since injection), and enabled/disabled state. All interactive elements SHALL have tooltips and follow the single-stylesheet, 0px-radius design contract.

#### Scenario: Inspect session context
- **WHEN** the user opens the context inspector on an active session
- **THEN** it lists base prompt, schematic, each context file, and the skills list with per-part token counts and total

#### Scenario: Staleness indicator
- **WHEN** a context file changes on disk after the session started
- **THEN** the inspector marks that part stale and offers a refresh that applies from the next turn

### Requirement: Refresh action
The inspector SHALL provide a refresh action that re-runs discovery and assembly for subsequent turns in the session, recording a system row in the transcript noting the context change.

#### Scenario: Manual refresh
- **WHEN** the user triggers context refresh mid-session
- **THEN** the next turn uses the re-assembled context and the transcript shows a "context refreshed" system row
