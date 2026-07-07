## ADDED Requirements

### Requirement: Change enumeration
The system SHALL enumerate `openspec/changes/` for the open project and return,
per change: name, artifact presence (`proposal.md`, `specs/` count,
`design.md`, `tasks.md`, `.openspec.yaml`), task progress (completed/total),
linked plan (via `plans.change_name`, when any), created date, and whether the
change lives under `changes/archive/`. Enumeration SHALL include changes not
created by the app (hand-written or agent-written) and SHALL tolerate missing
or malformed artifacts without failing the listing.

#### Scenario: Catalog lists app and foreign changes
- **WHEN** `openspec/changes/` contains one app-generated change and one
  hand-created change directory missing `design.md`
- **THEN** both appear in the catalog, the hand-created one shows its absent
  artifacts and `0/0` tasks if it has no tasks.md, and no error is raised

#### Scenario: Malformed change does not poison the list
- **WHEN** a change directory contains an unreadable or empty tasks.md
- **THEN** the catalog renders that change with unknown progress and the other
  changes normally

### Requirement: Structured task checklist
The system SHALL parse a change's `tasks.md` into an ordered structure of
phases (`## N. <name>` headings) and tasks (`- [ ] / - [x] <id> <text>` lines,
id when present), preserving raw line fidelity, and SHALL render it as a
checklist grouped by phase with per-phase and total progress. The user SHALL
be able to toggle a task's checkbox from the checklist; a toggle SHALL rewrite
only that task's checkbox marker in `tasks.md` (atomic write, original
formatting preserved) and SHALL be rejected for paths outside the project's
`openspec/changes/` tree.

#### Scenario: Checklist renders phases and tasks
- **WHEN** the user opens a change with `## 1. Setup` (2 tasks, 1 done) and
  `## 2. Core` (3 tasks, 0 done)
- **THEN** the checklist shows both phases with 1/2 and 0/3 progress and 1/5
  total

#### Scenario: Manual toggle persists
- **WHEN** the user ticks task `2.1` in the checklist
- **THEN** `tasks.md` on disk changes only that line's `- [ ]` to `- [x]`,
  the checklist and any progress indicators update, and a planning event is
  emitted

#### Scenario: Toggle outside the tree is rejected
- **WHEN** a toggle request names a path outside `openspec/changes/`
- **THEN** the command fails with a typed error and nothing is written

### Requirement: Live task progress
Task progress SHALL update without manual refresh: when an app-managed agent
run writes a file whose path ends in `tasks.md` under `openspec/changes/`
(through the native tool runtime or an app-driven OMP session), the system
SHALL re-parse that change and emit a task-progress planning event; while any
plan run is active, the system SHALL additionally poll the linked change's
tasks.md at a bounded interval so external editors and terminal-driven agents
are detected. Catalog surfaces, plan rows, and the command strip SHALL consume
these events.

#### Scenario: Agent tick updates the UI live
- **WHEN** a running agent marks `- [x] 2.1` via the file-edit tool
- **THEN** the checklist, the plan's progress indicator, and the command strip
  update within the same turn without the user reopening anything

#### Scenario: External edit detected during a run
- **WHEN** the user edits tasks.md in an external editor while the linked plan
  is running
- **THEN** the progress refreshes within the polling interval and the change
  is reflected in the catalog

### Requirement: Manual plan linking
The system SHALL let the user link an existing change directory to a plan
(setting `plans.change_name`) and unlink it, both confirm-gated. Linking SHALL
refuse a change already linked to another non-cancelled plan.

#### Scenario: Link an imported change
- **WHEN** the user links hand-written change `add-dark-mode` to a draft plan
- **THEN** the plan stores `add-dark-mode`, its progress reflects that
  tasks.md, and the catalog row shows the plan back-link

#### Scenario: Double-link refused
- **WHEN** the user attempts to link a change already linked to an active plan
- **THEN** the action fails with a message naming the owning plan and nothing
  changes

### Requirement: Archive action
The catalog SHALL offer a confirm-gated archive action for a change whose
linked plan is `finished` or `cancelled` (or which has no linked plan): the
change directory moves to `openspec/changes/archive/<date>-<name>/`. The
confirmation SHALL state that spec merging into `openspec/specs/` is a
separate agent workflow and is not performed by this action. Archived changes
SHALL remain enumerable under an archived filter.

#### Scenario: Archive a finished change
- **WHEN** the user archives `add-dark-mode` whose plan is `finished` and
  confirms
- **THEN** the directory moves to `openspec/changes/archive/<today>-add-dark-mode/`,
  the catalog moves the row under Archived, and a planning event is emitted

#### Scenario: Active plan blocks archive
- **WHEN** the user attempts to archive a change whose linked plan is `running`
- **THEN** the action is refused with the plan's status named
