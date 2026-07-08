# planning-flow-board Specification

## ADDED Requirements

### Requirement: MVP planning controls are in the workflow
The flow board SHALL expose the effective planning engine, provider/model/effort, skill, worker count, workspace policy, and scheduling mode at the promotion or launch step. Project defaults MAY prefill these values, but the launch confirmation SHALL show the effective values, provider concurrency cap, queued overflow, branches/worktrees, prerequisites, and collisions.

#### Scenario: User launches more workers than the provider cap
- **WHEN** the user selects four ready plans, chooses four isolated workers, and the provider cap is two
- **THEN** the confirmation states that two start and two queue, enumerates their worktrees/branches, and dispatch preserves that bound

### Requirement: Planning counts share one source of truth
Header, command strip, flow board, idea browser, plan list, and change catalog counts SHALL derive from the same project-scoped snapshot/event stream and SHALL update atomically after generation, status transition, archive, or project switch.

#### Scenario: Schematic and ideas refresh
- **WHEN** a schematic becomes complete and a category generation turn creates five ideas
- **THEN** every visible schematic/idea count updates to the same values without reopen, polling races, or a contradictory attention badge

### Requirement: Shared run board
The flow board SHALL provide a project-scoped run board showing each worker's plan, priority, prerequisites, owner chat, provider/model/skill, project, branch/worktree, affected-path claims, progress, blockers, collision state, and merge readiness. The board SHALL be the coordination source of truth for workers and users.

#### Scenario: Worker reports a new file claim
- **WHEN** a running worker claims a path that overlaps another ready or running plan
- **THEN** the board updates both nodes, the scheduler applies the configured collision policy, and the reason is visible and debug-logged
