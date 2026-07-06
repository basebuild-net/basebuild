## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Default category seeding
A session SHALL have a usable set of idea categories without manual setup. On
first use of category-directed planning for a session, the system SHALL seed a
default set of category directions (SEO, Optimization, Design, New Features) if
the session has no categories. Seeding SHALL be idempotent and SHALL NOT
duplicate categories a user or a prior AI run already created.

#### Scenario: First categorical use seeds defaults
- **WHEN** the Categories view or category-directed generation is used for a
  session that has no categories
- **THEN** the default categories are created once for that session and appear
  as selectable directions

#### Scenario: Seeding does not clobber existing categories
- **WHEN** a session already has one or more categories
- **THEN** no default categories are added and the existing set is preserved

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
