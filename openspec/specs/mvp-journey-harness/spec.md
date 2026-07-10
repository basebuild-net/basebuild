# mvp-journey-harness Specification

## Purpose
TBD - created by archiving change mvp-workflow-hardening. Update Purpose after archive.
## Requirements
### Requirement: Golden path is a release gate
The workflow checklist in `mvp.md` SHALL be represented by an executable release-gate suite and a live desktop smoke checklist. A release SHALL NOT claim MVP readiness while a golden-path stage is skipped, prose-only where a managed interaction is required, or dependent on stale state from another project.

#### Scenario: Release candidate is evaluated
- **WHEN** a release candidate runs the MVP gate
- **THEN** every golden-path stage reports pass/fail with screenshots/logs for failures and the release is blocked on any P0/P1 regression

### Requirement: Deterministic planning fixture
The harness SHALL provide a local fixture repository with observable schematic facts, deterministic interactive provider responses, generated categories/ideas, validated native/OpenSpec plans, prerequisite and collision cases, and mock Git/worktree outcomes. It SHALL make no data-uploading network call.

#### Scenario: Fixture runs offline
- **WHEN** the test machine has no external network
- **THEN** the complete MVP journey remains deterministic using local mocks and artifacts

