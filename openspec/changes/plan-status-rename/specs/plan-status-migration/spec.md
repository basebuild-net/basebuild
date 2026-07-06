# plan-status-migration Specification (delta)

## ADDED Requirements

### Requirement: One-time status migration
The system SHALL migrate existing plan rows with status `openspec` to `planned`
exactly once on first startup after upgrade, alongside the existing
`waiting → ready` and `in_progress → running` migrations, preserving every other
plan field.

#### Scenario: Legacy openspec rows migrated
- **WHEN** the app starts with plans stored as `openspec`
- **THEN** each is rewritten to `planned` exactly once, and re-running startup does not modify them again

#### Scenario: Other fields preserved
- **WHEN** an `openspec` plan is migrated
- **THEN** only its status changes; title, idea link, change name, timestamps, and tags are untouched

### Requirement: Backward-compatible status parsing
The status parser SHALL accept the legacy `openspec` value on read and normalize
it to `planned`, so stale data or an external writer never yields an unknown
status.

#### Scenario: Legacy value on read
- **WHEN** a stored or incoming status is `openspec`
- **THEN** it is normalized to `planned` rather than rejected or shown as unknown

### Requirement: UI and vocabulary alignment
Status labels, filters, and badges SHALL use `planned` (display label "Planned"),
and the project's status vocabulary in AGENTS.md Invariant 9 and
`openspec/config.yaml` SHALL read `draft → planned → ready → running → finished`
to match the `.basebuild` planning-file schema.

#### Scenario: Planned label shown
- **WHEN** a plan is in the post-draft, artifacts-generated state
- **THEN** the UI shows the "Planned" label/badge and status filters offer "Planned", with no "OpenSpec" status option

#### Scenario: Docs match the schema
- **WHEN** AGENTS.md Invariant 9 and `openspec/config.yaml` describe the plan lifecycle
- **THEN** they read `draft → planned → ready → running → finished`, matching planning-file-schema
