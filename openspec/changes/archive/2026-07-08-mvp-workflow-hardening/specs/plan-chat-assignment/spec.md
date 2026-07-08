# plan-chat-assignment Specification

## ADDED Requirements

### Requirement: Assignment carries validated execution context
Assigning a ready plan to a chat SHALL bind an immutable validated artifact bundle plus the selected engine, provider/model/effort, skill, worker/workspace policy, priority, prerequisites, and affected paths. The action SHALL create a queued or running run; changing status without dispatch SHALL be an error.

#### Scenario: Ready plan is assigned to an existing chat
- **WHEN** the user assigns a validated ready plan to an idle existing chat
- **THEN** the chat header shows the plan and execution context, the artifacts are delivered exactly once, and a run is queued or started according to dependency/concurrency policy
