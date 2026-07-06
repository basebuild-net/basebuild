# planning-file-ingestion Specification (delta)

## ADDED Requirements

### Requirement: Ingest planning files into the workspace
The app SHALL scan the project's `.basebuild/` directory and ingest
`categories.md`, `ideas/<slug>.md`, and `plans/<slug>/` records into the SQLite
planning workspace so they appear in the `Plans / Ideas / Categories` inspector.
Ingestion SHALL run on project open and on explicit user demand.

#### Scenario: Fresh ingestion on open
- **WHEN** a project containing `.basebuild/` planning files is opened
- **THEN** categories, ideas, and plans from the files appear in the inspector with their titles, categories, and statuses

#### Scenario: On-demand rescan
- **WHEN** the user triggers a rescan
- **THEN** newly added or edited planning files are reflected without restarting the app

#### Scenario: No planning files
- **WHEN** a project has no `.basebuild/` planning files
- **THEN** ingestion is a no-op and the workspace shows the project's existing app-created records unchanged

### Requirement: Field and status mapping
Frontmatter fields SHALL map to workspace records — ideas map
`title`/`category`/`status`/`created`/`plan`; plans map
`title`/`status`/`created`/`ideas`/`engine`/`external` — and the file status
vocabulary (e.g. `planned`) SHALL map to the app's plan/idea status vocabulary.

#### Scenario: Idea frontmatter mapped
- **WHEN** an `ideas/<slug>.md` file has valid frontmatter
- **THEN** a workspace idea is created or updated with the mapped fields and the file body as its description

#### Scenario: External-engine plan mapped
- **WHEN** a `plans/<slug>/plan.md` records `engine: openspec` and `external: openspec/changes/<slug>/`
- **THEN** the workspace plan links to the external path, records the mapped status, and does not synthesize a duplicate task list

### Requirement: Non-destructive idempotent reconciliation
Ingestion SHALL detect external edits (content hash or mtime) and reconcile the
workspace to match without clobbering user file edits; the files remain the
source of truth. Malformed or missing-required-frontmatter files SHALL be skipped
with a surfaced warning, and re-scanning SHALL NOT create duplicate records.

#### Scenario: External edit reflected
- **WHEN** an idea file is edited outside the app and the project is rescanned
- **THEN** the workspace record updates to match the file, and the file is not overwritten by stale app state

#### Scenario: Malformed file skipped
- **WHEN** an idea or plan file has invalid or missing required frontmatter
- **THEN** that file is skipped, a warning names it, and the remaining valid files still ingest

#### Scenario: Idempotent rescan
- **WHEN** the same planning files are scanned twice with no changes
- **THEN** no duplicate categories, ideas, or plans are created and no records are needlessly rewritten
