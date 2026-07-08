## MODIFIED Requirements

### Requirement: OpenSpec change generation
Moving a selected idea or draft plan from `draft` to `openspec` SHALL run a recorded pipeline stage that generates `openspec/changes/<change-name>/` in the target project containing `proposal.md`, `specs/<capability>/spec.md`, optional `design.md`, `tasks.md`, and `.openspec.yaml`, following the OpenSpec spec-driven schema (scenarios use exactly four hashtags). The change name SHALL derive from the selected idea/plan title (kebab-case), SHALL be stored on the plan alongside the reference id, and SHALL be the single implementation-plan source of truth for OpenSpec-backed plans.

#### Scenario: Draft to openspec
- **WHEN** the user advances a draft plan to `openspec`
- **THEN** artifacts are generated using the plan's goal/description/context and the project schematic as context, the plan stores the change path, and the plan status becomes `openspec` only after all files are written

#### Scenario: Existing change name collision
- **WHEN** the derived change name already exists in the project
- **THEN** a numeric suffix is appended (`-2`, `-3`, …) rather than overwriting

#### Scenario: No duplicate native task list
- **WHEN** an OpenSpec-backed plan has generated artifacts
- **THEN** Basebuild stores only metadata, validation state, execution settings, and a pointer to the change; task checkboxes are read from `tasks.md`

### Requirement: Task progress from tasks.md
The system SHALL parse the linked change's `tasks.md` checkboxes and display completed/total per plan, per chat context strip, and per run board node, refreshing when the file changes on disk or when the plan/chat is opened. Progress SHALL include the active phase when it can be derived from headings.

#### Scenario: Progress display
- **WHEN** a run marks `- [x] 2.1 ...` in `tasks.md`
- **THEN** the plan card, chat context strip, and run board show updated progress (e.g. `5/12 tasks`) without manual refresh actions beyond reopening or file-change detection

#### Scenario: Phase progress display
- **WHEN** `tasks.md` contains phase headings and task checkboxes
- **THEN** the context strip MAY show `Core implementation 3/7` or equivalent derived phase progress, and the tooltip shows total completed/total

### Requirement: Ready gate and run handoff
A plan SHALL move `openspec → ready` only after the user reviews generated artifacts, OpenSpec runtime health is ready, and artifact validation passes. When a run starts, the run session's opening context SHALL reference the change directory and instruct the standard OpenSpec apply workflow: work `tasks.md` top-to-bottom, mark checkboxes immediately, verify, update docs/design/mvp where specified, refresh roadmap, then archive/sync when complete.

#### Scenario: Review before ready
- **WHEN** artifacts finish generating
- **THEN** the plan shows a review affordance opening the artifacts in the file viewer, and only an explicit user action advances the plan to `ready`

#### Scenario: Run references the change
- **WHEN** a `ready` plan with a linked change starts running
- **THEN** the session context names `openspec/changes/<change-name>/` and its tasks, so the agent picks up exactly that work

#### Scenario: OpenSpec runtime blocks ready
- **WHEN** artifact validation is requested but OpenSpec runtime health is missing/error
- **THEN** the plan stays `openspec`, the validation result links to Settings → OpenSpec, and no run is queued

#### Scenario: Lower-intelligence model instructions are explicit
- **WHEN** artifact generation creates `design.md` or `tasks.md`
- **THEN** the artifacts include concrete file paths, required snippets/pseudocode, verification commands, and negative instructions that prevent building a second non-OpenSpec planning engine
