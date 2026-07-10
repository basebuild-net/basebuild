# openspec-artifacts Specification (delta)

## ADDED Requirements

### Requirement: Artifact Quality Gate
Generated OpenSpec artifacts SHALL be validated after the atomic write and
before the linked plan advances beyond `draft`. Validation SHALL require:
a non-empty `proposal.md` containing Why and What-Changes sections; at
least one `specs/*/spec.md` containing at least one requirement heading
and at least one scenario heading; a parseable `tasks.md` with at least
one task, none checked at generation time. On failure the plan SHALL stay
in `draft`, the stage SHALL record an actionable error, the written
artifacts SHALL remain on disk for inspection, and the plan card SHALL
surface the failure with access to the raw generation output.

#### Scenario: Valid artifacts advance the plan
- **WHEN** artifact generation produces a valid proposal, at least one spec with a requirement and scenario, and a parseable non-empty task list
- **THEN** the plan advances to the planned/openspec status and the change directory is linked via its change name

#### Scenario: Missing tasks keep the plan in draft
- **WHEN** generation produces artifacts whose tasks.md has zero parseable tasks
- **THEN** the plan remains in draft, the plan card shows the validation error, and the raw generation output is accessible for inspection

#### Scenario: Structural check, not length check
- **WHEN** generation produces a minimal but structurally complete change (short proposal, one spec with one requirement and one scenario, one task)
- **THEN** validation passes, with at most warnings about thin content

### Requirement: Task Progress Fidelity
Task progress parsing SHALL count nested and indented checkbox tasks,
tolerate mixed list markers, and report identical progress everywhere it
is displayed (plan cards, context strip, run completion checks).

#### Scenario: Nested tasks counted
- **WHEN** a tasks.md contains indented sub-tasks under a parent checkbox
- **THEN** progress counts include the sub-tasks and match across the plan card, context strip, and run completion evaluation

#### Scenario: Progress consistency at completion
- **WHEN** all checkboxes in a linked tasks.md are checked
- **THEN** the plan run completion check, the plan card, and the context strip all report full completion in the same refresh cycle
