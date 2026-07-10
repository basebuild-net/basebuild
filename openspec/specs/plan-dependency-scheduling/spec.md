# plan-dependency-scheduling Specification

## Purpose
TBD - created by archiving change mvp-workflow-hardening. Update Purpose after archive.
## Requirements
### Requirement: Dependency and collision graph
The system SHALL build a project-scoped graph of approved plans using explicit prerequisites, priority, declared affected paths, and live file claims. It SHALL reject dependency cycles, explain inferred overlaps, and recompute readiness when plans or claims change.

#### Scenario: Two plans overlap the same source file
- **WHEN** two ready plans declare or claim the same source file without an ordering edge
- **THEN** both nodes show the collision evidence and safe scheduling prevents simultaneous execution until the conflict is resolved or explicitly overridden

### Requirement: Safe scheduling is the default
Safe scheduling SHALL start only plans whose prerequisites are finished and whose affected paths do not conflict with running workers. Blocked plans SHALL remain queued with an actionable reason and SHALL be reconsidered automatically after relevant state changes.

#### Scenario: Prerequisite finishes
- **WHEN** plan B waits on plan A and A becomes finished with no remaining collision
- **THEN** B becomes dispatchable and starts or remains queued only because of the visible provider concurrency limit

### Requirement: Explicit YOLO override
YOLO scheduling MAY run conflicting dependency-ready plans only after a managed confirmation enumerates collisions, worktrees, branches, and mandatory merge-review consequences. It SHALL NOT bypass confirmation for commit, push, PR, merge, or prune actions.

#### Scenario: User confirms a conflicting YOLO launch
- **WHEN** the user confirms two overlapping plans in YOLO mode
- **THEN** both may dispatch in isolated worktrees, both are marked collision-review-required, and the merge queue blocks integration until the overlapping diff is reviewed

### Requirement: Structured worker coordination ledger
Workers SHALL publish progress, blockers, affected-path claims, artifact revisions, and completion to an append-only coordination ledger. Scheduling and merge review SHALL consume this ledger; free-form cross-agent messaging SHALL NOT be required for correctness.

#### Scenario: Worker becomes blocked
- **WHEN** a worker records a blocker and releases an unmodified path claim
- **THEN** the run board shows the blocker, the released path is available to other eligible plans, and the event remains auditable

