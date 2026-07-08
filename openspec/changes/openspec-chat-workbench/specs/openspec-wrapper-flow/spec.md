## ADDED Requirements

### Requirement: Chat-led idea generation with OpenSpec-owned planning
The system SHALL use chat to gather context, ask clarifying questions, generate categories/ideas, and capture user selections. Once an idea is promoted, the system SHALL delegate artifact generation, implementation planning, apply instructions, verification, archive/sync, and completion tracking to OpenSpec instead of maintaining a parallel native implementation-plan format.

#### Scenario: Generate ideas first
- **WHEN** the user asks for project ideas from chat
- **THEN** the agent asks only the missing scoping questions, generates grounded ideas, and renders them as selectable cards in the conversation

#### Scenario: Selected idea becomes OpenSpec change
- **WHEN** the user promotes one or more ideas
- **THEN** the plan records `engine: openspec`, derives a change slug, and generates `openspec/changes/<slug>/` artifacts through the OpenSpec workflow

#### Scenario: Native planning does not duplicate OpenSpec
- **WHEN** artifacts are generated for an OpenSpec plan
- **THEN** Basebuild stores pointers, validation state, progress, and execution profile, but does not create a second implementation-plan document with duplicated tasks

### Requirement: MVP flow is explicit and queue-driven
The MVP flow SHALL be presented as `generate ideas → generate OpenSpec artifacts/full implementation plans → process queue → final touches/merge/archive`. Each step SHALL have a visible state, next action, and blocker reason. Worktrees SHALL be used for execution when the project is a git repository and the user has configured worktree execution.

#### Scenario: User sees the full flow
- **WHEN** a project has ideas, plans, queued runs, or finished runs
- **THEN** the chat and planning modal expose the current stage and next action without requiring the user to inspect files manually

#### Scenario: Worktree policy is honored
- **WHEN** the user configured isolated worktrees and launches two ready plans
- **THEN** each run provisions or reuses its assigned worktree/branch according to policy and displays that workspace under the chat input

#### Scenario: Sequential fallback is explicit
- **WHEN** worktrees are unavailable or disabled
- **THEN** the queue runs sequentially in the primary checkout and labels the chat/workspace as `primary checkout` instead of implying isolation

### Requirement: Final touches complete the OpenSpec loop
Finished OpenSpec-backed runs SHALL surface review, validation, commit, pull request, merge, prune, sync, and archive actions as explicit confirmed steps. Completing every task in a linked OpenSpec change SHALL lead to archive/sync guidance instead of leaving completed change folders stranded.

#### Scenario: Run finishes with incomplete tasks
- **WHEN** a run ends but linked `tasks.md` still has unchecked tasks
- **THEN** the chat and flow board show `awaiting_review`, list remaining task count, and offer continue/review actions

#### Scenario: Run finishes with all tasks complete
- **WHEN** all linked OpenSpec tasks are checked and verification passes
- **THEN** the final-touches card offers commit/PR/merge/prune and OpenSpec archive/sync actions, each confirm-gated where it writes remotely or destructively

#### Scenario: Archive is never silent
- **WHEN** the user chooses to archive or sync an OpenSpec change
- **THEN** the action previews affected specs and roadmap updates before applying
