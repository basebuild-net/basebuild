# plan-import Specification (delta)

## ADDED Requirements

### Requirement: Detect importable external plans
The app SHALL detect pre-existing external plan artifacts in the project that
predate app tracking — notably unexecuted OpenSpec changes under
`openspec/changes/<slug>/` — and present them as import candidates without
modifying them.

#### Scenario: Discover openspec changes
- **WHEN** the user opens the import view for a project containing `openspec/changes/<slug>/` folders not linked to any plan
- **THEN** each is listed as an import candidate with its title (from `proposal.md`) and a detected status

#### Scenario: Already-linked skipped
- **WHEN** a change folder is already linked to a `.basebuild` plan record
- **THEN** it is not offered again as a candidate

### Requirement: Import into .basebuild plan records
For each confirmed candidate the app SHALL create a `.basebuild/plans/<slug>/plan.md`
record with `engine` set to the detected engine (e.g. `openspec`), `external` set
to the source path, a derived `status`, and a title from the source, and SHALL
NOT synthesize a duplicate task list for external-engine plans. Imported plans
SHALL appear in the app planning workspace.

#### Scenario: OpenSpec change imported
- **WHEN** the user confirms importing an `openspec/changes/<slug>/` change
- **THEN** `.basebuild/plans/<slug>/plan.md` is written with `engine: openspec`, `external: openspec/changes/<slug>/`, a derived status, and the proposal title, and the plan appears in the workspace

#### Scenario: Status derived from artifacts
- **WHEN** a candidate's artifacts are complete (proposal + specs + tasks present)
- **THEN** the imported plan's status is `planned`, and where `tasks.md` progress indicates work underway or complete a more advanced status is derived when inferable

#### Scenario: No duplicate task list
- **WHEN** an external-engine change is imported
- **THEN** the record points at `external` and does not copy the change's tasks into a native `tasks.md`

### Requirement: Safe, idempotent, confirmed import
Import SHALL require an explicit confirm step (no silent writes), SHALL be
idempotent (re-import skips already-linked sources and never overwrites user
edits), and SHALL report and skip ambiguous or malformed sources rather than
guessing.

#### Scenario: Confirmation before write
- **WHEN** candidates are detected
- **THEN** nothing is written until the user confirms the selection

#### Scenario: Idempotent re-import
- **WHEN** import runs again over the same sources
- **THEN** already-imported plans are skipped and existing records are not overwritten

#### Scenario: Malformed source skipped
- **WHEN** a candidate folder lacks a parseable proposal/title or is otherwise malformed
- **THEN** it is reported and skipped, and the valid candidates still import
