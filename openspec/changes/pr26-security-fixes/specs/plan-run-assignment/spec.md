# plan-run-assignment Security Specification (delta)

## MODIFIED Requirements

### Requirement: Same-Project Assignment Enforcement
The system SHALL reject plan-to-chat-session assignment when the plan's
project and the chat session's project differ. Both the plan's session
project path and the chat session's project path SHALL be compared before
creating a run or provisioning a worktree.

#### Scenario: Same-project assignment succeeds
- **WHEN** a plan belongs to project A and the chat session belongs to project A
- **AND** the plan status is ready, draft, or openspec
- **THEN** the assignment creates a plan run and provisions a worktree in project A

#### Scenario: Cross-project assignment rejected
- **WHEN** a plan belongs to project A and the chat session belongs to project B
- **THEN** the system rejects the assignment with an error naming both projects
- **AND** no plan run is created and no worktree is provisioned

#### Scenario: Plan session missing
- **WHEN** a plan's session cannot be loaded
- **THEN** the system rejects the assignment with a "Plan's session not found" error

#### Scenario: Chat session missing
- **WHEN** the chat session cannot be loaded
- **THEN** the system rejects the assignment with a "Chat session not found" error
