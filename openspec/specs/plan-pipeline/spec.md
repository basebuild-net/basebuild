# plan-pipeline Specification

## Requirements
### Requirement: Plan lifecycle statuses
The system SHALL store plan statuses as snake_case values with the lifecycle `draft → openspec → ready → running → finished`, where `cancelled` is reachable from any non-terminal status. The legacy values `waiting` and `in_progress` SHALL be migrated to `ready` and `running` on first startup after upgrade.

#### Scenario: Status rename migration
- **WHEN** the app starts with a database containing plans in `waiting` or `in_progress`
- **THEN** those rows are rewritten to `ready` and `running` respectively, exactly once, and all APIs accept and return only the new values

#### Scenario: Cancel from any active stage
- **WHEN** the user cancels a plan in `draft`, `openspec`, `ready`, or `running`
- **THEN** the plan moves to `cancelled`, any in-flight pipeline or run for it is aborted, and already-written artifacts are preserved

### Requirement: Idea lifecycle and promotion
Ideas SHALL use snake_case statuses `concept → picked → archived`. Picking an idea SHALL create a linked draft plan (`idea_id` on the plan); the plan owns all further lifecycle. Legacy idea statuses SHALL be migrated (`planReady`/`inProgress`/`finished` → `picked`, `paused`/`cancelled` → `archived`, `concept` → `concept`).

#### Scenario: Pick an idea
- **WHEN** the user picks an idea (single or multi-select) in the Ideas panel
- **THEN** for each picked idea a draft plan is created carrying the idea's title, description, and category as a tag, the idea moves to `picked`, and the idea card links to its plan

#### Scenario: Idea does not duplicate plan state
- **WHEN** a promoted plan changes status
- **THEN** the idea's stored status remains `picked`; any progress shown on the idea card is derived from the linked plan at read time

### Requirement: Recorded pipeline stages
Every AI pipeline stage (generate idea categories, generate ideas, enhance idea into draft plan, draft plan into OpenSpec artifacts) SHALL be recorded as a run row with stage kind, input summary, session id, status (`pending → running → succeeded | failed | cancelled`), timestamps, and output references, and SHALL be cancellable while running.

#### Scenario: Generate idea categories
- **WHEN** the user triggers "Generate idea categories" for a session
- **THEN** a stage run is recorded, the harness produces categories using the project schematic as context, results appear as category chips, and the run row shows `succeeded` with the created category ids

#### Scenario: Generate ideas within a category
- **WHEN** the user triggers idea generation for a category (or freeform)
- **THEN** generated ideas are appended as `concept` ideas tagged with that category, and the stage run records how many were created

#### Scenario: Cancel a running stage
- **WHEN** the user cancels a stage run that is `running`
- **THEN** the underlying harness request is aborted, the run row becomes `cancelled`, and no partial rows are left outside the run record

#### Scenario: Crash does not orphan state
- **WHEN** the app restarts while a stage run was `running`
- **THEN** the run is marked `failed` with a restart note, and the plan/idea it targeted remains in its pre-stage status
