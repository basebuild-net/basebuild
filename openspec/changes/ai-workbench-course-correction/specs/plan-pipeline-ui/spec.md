# plan-pipeline-ui Specification

## MODIFIED Requirements

### Requirement: Plan Generation Auditability
The system SHALL run AI planning generation as a visible managed activity: its
context reads, reasoning availability, tool calls, questions, structured
captures, artifact writes, validation, feedback, and completion SHALL render in
order. No plan SHALL become `ready` until required artifacts validate and the
user explicitly approves them.

#### Scenario: Generation gathers repository context
- **WHEN** a promoted idea starts plan generation
- **THEN** the user sees the current operation and tool activity, can answer any
  question inline, previews the artifacts, and receives validation results

### Requirement: Plan CRUD
The system SHALL allow viewing and editing metadata on existing plans but SHALL
NOT expose blank or manual plan creation. New plans SHALL originate only from
promoted structured ideas or imported artifacts, and legacy blank drafts SHALL
remain recoverable without being silently deleted.

#### Scenario: Plans catalog is empty
- **WHEN** the user opens Plans with no plan records
- **THEN** the surface explains how to generate ideas and contains no Create
  plan button, blank-plan form, or equivalent shortcut

#### Scenario: Existing plan metadata is edited
- **WHEN** the user edits the title or description of an existing plan
- **THEN** the metadata is saved without bypassing artifact validation or
  changing readiness automatically

### Requirement: Unified planning inspector
The planning modal SHALL present Plans, Ideas, Categories, Flow, and Changes as
explicit tabs over one project-scoped catalog. Opening from a command-strip
stage SHALL select the requested tab deterministically, and modal content SHALL
fill the available container at wide and compact sizes.

#### Scenario: Ideas stage opens the inspector
- **WHEN** the user clicks the top-level Ideas stage
- **THEN** the modal opens with Ideas visibly active and its filter/actions
  rendered, without first showing Plans or a blank body

