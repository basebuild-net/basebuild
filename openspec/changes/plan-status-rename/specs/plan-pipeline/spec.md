# plan-pipeline Specification (delta)

## MODIFIED Requirements

### Requirement: Plan lifecycle statuses
The system SHALL store plan statuses as snake_case values with the lifecycle
`draft → planned → ready → running → finished`, where `cancelled` is reachable
from any non-terminal status. The legacy values `waiting` and `in_progress` SHALL
be migrated to `ready` and `running`, and the legacy value `openspec` SHALL be
migrated to `planned`, on first startup after upgrade.

#### Scenario: Status rename migration
- **WHEN** the app starts with a database containing plans in `waiting`, `in_progress`, or `openspec`
- **THEN** those rows are rewritten to `ready`, `running`, and `planned` respectively, exactly once, and all APIs accept and return only the new values

#### Scenario: Cancel from any active stage
- **WHEN** the user cancels a plan in `draft`, `planned`, `ready`, or `running`
- **THEN** the plan moves to `cancelled`, any in-flight pipeline or run for it is aborted, and already-written artifacts are preserved
