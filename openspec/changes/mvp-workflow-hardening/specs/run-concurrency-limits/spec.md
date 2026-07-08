# run-concurrency-limits Specification

## MODIFIED Requirements

### Requirement: Launch-time worker and workspace controls
The system SHALL expose worker count, effective per-provider concurrency, subagent allowance, and workspace policy at launch. `isolated_worktrees` SHALL provision one worktree/branch per concurrent plan; `sequential_primary` SHALL cap execution in the primary checkout at one. Values beyond effective limits SHALL queue and SHALL be explained before confirmation.

#### Scenario: Primary workspace policy is selected
- **WHEN** the user selects three plans and `sequential_primary`
- **THEN** the confirmation states that one worker runs at a time in the primary checkout, no worktrees are created, and the remaining plans queue
