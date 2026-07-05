# harness-subagents Specification (delta)

## ADDED Requirements

### Requirement: Scoped subagent delegation
The system SHALL provide a delegation tool by which a parent native session
spawns one or more scoped sub-sessions, each with its own prompt and isolated
context, to execute a bounded subtask. Sub-sessions SHALL run under the native
agent harness with the same tool runtime and approval gateway as top-level
sessions.

#### Scenario: Delegate one subtask
- **WHEN** a parent turn calls the delegation tool with a scoped instruction
- **THEN** a sub-session is created with only the provided context, runs the harness loop, and its result is returned to the parent turn

#### Scenario: Parallel subagents
- **WHEN** a parent turn delegates multiple independent subtasks at once
- **THEN** they execute concurrently up to the configured concurrency limit and the parent turn resumes once all have reached a terminal state

### Requirement: Bounded concurrency and isolation
Subagent runs SHALL reuse the run-queue concurrency limit, and when the project
is a git repository each subagent MAY execute in its own worktree (reusing
`parallel-workspaces`), falling back to sequential in-place execution on non-git
projects or when workspaces are disabled.

#### Scenario: Concurrency limit respected
- **WHEN** more subagents are requested than the concurrency limit allows
- **THEN** the excess queue and start as slots free, never exceeding the limit

#### Scenario: Non-git fallback
- **WHEN** subagents are requested in a non-git project
- **THEN** they run sequentially in the primary checkout with a visible notice, rather than failing

### Requirement: Result return and inspectable runs
A subagent's outcome SHALL be returned to the parent turn as a tool result — a
concise summary plus references (files, plan/run ids) — not the full child
transcript, which SHALL remain inspectable as its own run.

#### Scenario: Summary returned, transcript preserved
- **WHEN** a subagent finishes
- **THEN** the parent turn receives a summary + references as the tool result, and the full child transcript is retrievable as a distinct run

#### Scenario: Subagent failure surfaced
- **WHEN** a subagent fails
- **THEN** the failure and its reason are returned to the parent as the tool result, and the parent turn continues rather than crashing

### Requirement: Cancellation and recursion bounds
Cancelling a parent SHALL cancel its children; child tool calls SHALL pass
through the approval gateway; and delegation SHALL enforce a depth and fan-out
cap to prevent unbounded recursion.

#### Scenario: Cancel propagates
- **WHEN** the user cancels a parent session with running subagents
- **THEN** all child sessions are aborted and their runs recorded as cancelled

#### Scenario: Child tool approval
- **WHEN** a subagent invokes a tool that requires approval
- **THEN** the request flows through the same approval broker/rules as a top-level tool call

#### Scenario: Recursion cap
- **WHEN** delegation would exceed the configured depth or fan-out cap
- **THEN** the delegation tool refuses with a clear error rather than spawning further sub-sessions
