## MODIFIED Requirements

### Requirement: Panel Creation Affordances
The global `+` menu, activity-sidebar new-panel controls, panel-header split controls, file-open actions, schematic actions, history re-open, prompt routing, and plan-run events SHALL use the same checked panel insertion behavior. Each interactive action SHALL either create/focus the requested visible panel exactly once or show an actionable error; closing a menu without a visible result SHALL NOT be treated as success.

#### Scenario: Header menu and sidebar are consistent
- **WHEN** the user creates the same panel type from the header `+` menu or the activity sidebar
- **THEN** both affordances apply the same anchor resolution, pending state, focus, error, and cleanup behavior

#### Scenario: Process-backed option cannot disappear silently
- **WHEN** the user chooses Terminal or Oh My Pi and panel insertion or process startup fails
- **THEN** the shell shows the failure, leaves the existing workspace usable, and does not retain an unreachable process-backed tab

#### Scenario: Schematic and file use checked insertion
- **WHEN** the user opens the project schematic or a file while the stored active panel id is stale
- **THEN** the shell repairs/falls back to a live anchor and makes the requested panel visible and focused

