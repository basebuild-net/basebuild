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
Ideas SHALL use snake_case statuses `concept → picked | rejected | archived`.
Picking an idea SHALL create a linked draft plan (`idea_id` on the plan); the
plan owns all further lifecycle. Rejecting an idea SHALL move it to `rejected`
without creating a plan. Legacy idea statuses SHALL be migrated
(`planReady`/`inProgress`/`finished` → `picked`, `paused`/`cancelled` →
`archived`, `concept` → `concept`); unknown values fall back to `concept`.
Ideas are the single catalog of generated suggestions; there is no separate
proposals store.

#### Scenario: Pick an idea
- **WHEN** the user picks an idea (single or multi-select) in the Ideas panel
- **THEN** for each picked idea a draft plan is created carrying the idea's
  title, description, and category as a tag, the idea moves to `picked`, and the
  idea card links to its plan

#### Scenario: Reject an idea
- **WHEN** the user rejects an idea
- **THEN** the idea moves to `rejected`, no plan is created, and the idea
  remains queryable in history filtered by status

#### Scenario: Idea does not duplicate plan state
- **WHEN** a promoted plan changes status
- **THEN** the idea's stored status remains `picked`; any progress shown on the
  idea card is derived from the linked plan at read time

### Requirement: Recorded pipeline stages
Every AI pipeline stage (generate idea categories, generate ideas, enhance idea
into draft plan, draft plan into OpenSpec artifacts) SHALL be recorded as a run
row with stage kind, input summary, session id, status
(`pending → running → succeeded | failed | cancelled`), timestamps, and output
references, and SHALL be cancellable while running. Generate-ideas stages SHALL
carry the target category id (or freeform) in the input summary.

#### Scenario: Generate idea categories
- **WHEN** the user triggers "Generate idea categories" for a session
- **THEN** a stage run is recorded, the harness produces categories using the
  project schematic as context, results appear as category chips, and the run
  row shows `succeeded` with the created category ids

#### Scenario: Generate ideas within a category
- **WHEN** the user triggers idea generation for a category (or freeform)
- **THEN** generated ideas are appended as `concept` ideas tagged with that
  category, and the stage run records how many were created and the category id

#### Scenario: Cancel a running stage
- **WHEN** the user cancels a stage run that is `running`
- **THEN** the underlying harness request is aborted, the run row becomes
  `cancelled`, and no partial rows are left outside the run record

#### Scenario: Crash does not orphan state
- **WHEN** the app restarts while a stage run was `running`
- **THEN** the run is marked `failed` with a restart note, and the plan/idea it
  targeted remains in its pre-stage status

### Requirement: Planning history and catalog access
The system SHALL make the full planning catalog accessible and durable: every
category, every idea (with its status), and each idea's linked plan SHALL be
queryable per session and reload after restart. Idea status SHALL serve as the
history signal — `picked` = accepted, `rejected` = rejected, `concept` = no
change yet, `archived` = archived.

#### Scenario: History reloads after restart
- **WHEN** ideas and categories exist for a session and the app is reopened
- **THEN** all categories and ideas reload with their statuses intact and are
  browsable by status and by category

#### Scenario: Category drill-down
- **WHEN** the user opens a category in the inspector
- **THEN** the system lists every idea tagged with that category and their
  statuses, and offers a "Suggest more ideas" action for that category

### Requirement: Project-derived categories
The system SHALL NOT seed or hardcode default idea categories. When category-directed planning is used for a session with no categories, the system SHALL present an empty state offering "Generate categories from project" (a recorded, skill-grounded generation stage) and manual "Add category" — and SHALL NOT silently create categories. Generated categories SHALL derive from project analysis (schematic Blueprint, Vision, End goals, Current priorities, and repository facts) so they reflect the project's actual domain. Re-running category generation SHALL append without duplicating existing categories (case-insensitive name match).

#### Scenario: Empty state instead of seeds
- **WHEN** the Categories view or category-directed generation is opened for a session with no categories
- **THEN** no categories are auto-created; the user sees "Generate categories from project" and "Add category" actions

#### Scenario: Generated categories reflect the project
- **WHEN** the user runs "Generate categories from project" for a niche project with a filled schematic
- **THEN** the created categories reflect that project's domain and priorities rather than a generic taxonomy, and the stage run records the created category ids

#### Scenario: Regeneration does not duplicate
- **WHEN** category generation runs for a session that already has categories
- **THEN** existing categories are preserved and no case-insensitive duplicate names are created

#### Scenario: Manual add always available
- **WHEN** the user adds a category manually in the empty state or alongside generated ones
- **THEN** the category is created immediately without any generation run

<!-- Removed: Default category seeding — **Reason**: Hardcoded seed categories (SEO, Optimization, Design, New Features) ignore the project's domain and niche — exactly the generic drift the schematic exists to prevent. Categories become project-derived; see `Project-derived categories` below. Existing seeded categories in old sessions are -->
