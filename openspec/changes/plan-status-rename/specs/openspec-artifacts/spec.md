# openspec-artifacts Specification (delta)

## MODIFIED Requirements

### Requirement: OpenSpec change generation
Moving a plan from `draft` to `planned` SHALL run a recorded pipeline stage that
generates `openspec/changes/<change-name>/` in the target project containing
`proposal.md`, `specs/<capability>/spec.md`, optional `design.md`, `tasks.md`,
and `.openspec.yaml`, following the OpenSpec spec-driven schema (scenarios use
exactly four hashtags). The change name SHALL derive from the plan title
(kebab-case) and be stored on the plan alongside the reference id.

#### Scenario: Draft to planned
- **WHEN** the user advances a draft plan to `planned`
- **THEN** artifacts are generated using the plan's goal/description/context and the project schematic as context, the plan stores the change path, and the plan status becomes `planned` only after all files are written

#### Scenario: Existing change name collision
- **WHEN** the derived change name already exists in the project
- **THEN** a numeric suffix is appended (`-2`, `-3`, …) rather than overwriting

### Requirement: Ready gate and run handoff
A plan SHALL move `planned → ready` only after the user reviews the generated
artifacts (open-in-viewer affordance). When a run starts, the run session's
opening context SHALL reference the change directory and instruct the standard
OpenSpec apply workflow (work tasks.md top-to-bottom, mark checkboxes).

#### Scenario: Review before ready
- **WHEN** artifacts finish generating
- **THEN** the plan shows a review affordance opening the artifacts in the file viewer, and only an explicit user action advances the plan to `ready`

#### Scenario: Run references the change
- **WHEN** a `ready` plan with a linked change starts running
- **THEN** the session context names `openspec/changes/<change-name>/` and its tasks, so the agent (native or OMP) picks up exactly that work
