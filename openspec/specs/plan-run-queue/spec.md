# plan-run-queue Specification

## Requirements
### Requirement: Plan run queue
The system SHALL maintain a per-project ordered queue of `ready` plans. The user SHALL be able to enqueue, reorder, remove, start, pause, and cancel the queue. Starting the queue SHALL execute plans in order until empty or paused.

#### Scenario: Enqueue and run sequentially
- **WHEN** the user enqueues three `ready` plans and starts the queue with concurrency 1
- **THEN** the first plan moves to `running`; when it reaches `finished` (including final touches), the next plan starts automatically

#### Scenario: Cancel a running plan from the queue
- **WHEN** the user cancels a plan that is `running`
- **THEN** its chat session/agent request is aborted, the plan returns to `ready` (or `cancelled` if the user chose cancel-plan), artifacts are kept, and the queue proceeds to the next plan only if the user cancelled the run rather than pausing the queue

### Requirement: Concurrency and model binding
The queue SHALL run plans concurrently up to the effective per-provider concurrency limits defined by `run-concurrency-limits` (replacing the single `N` in the former `N × <provider/model>` profile). Each run's chat session SHALL be bound to a single configured provider/model/effort without manual re-picking. The queue's execution profile SHALL display, per provider, the effective concurrency limit and the bound model, at the top of the plans UI.

#### Scenario: Parallel execution bounded by provider limit
- **WHEN** provider `umans` has an effective concurrency limit of `2` and four plans on that provider are queued
- **THEN** two plans run concurrently in separate chat sessions (and separate worktrees when parallel-workspaces is enabled), and a third starts only when one finishes

#### Scenario: Model binding
- **WHEN** a queued plan starts
- **THEN** its chat session uses the queue's configured provider/model/effort for that plan, regardless of what was last selected manually in any composer

#### Scenario: Mixed-provider queue
- **WHEN** the queue holds plans across two providers with limits `2` and `1`
- **THEN** the scheduler runs up to 2 of the first provider's plans and 1 of the second concurrently, each bounded independently

### Requirement: Auto-provisioned run sessions
When a plan enters `running`, the system SHALL create (or reuse the assigned) native chat session titled from the plan (reference id + title), with fresh context seeded from the plan (goal, description, focus context, linked OpenSpec change path) and the project schematic, and SHALL surface the session as a chat column in the active chat tab's grid (creating a chat tab if none is active), per `chat-grid-layout`.

#### Scenario: Plan start opens a fresh chat column
- **WHEN** a plan starts (manually, via the queue, or via assignment) and it has no pre-bound chat
- **THEN** a new chat column appears named like `bb-x7k2p1 — Add dark mode`, containing no prior conversation, with the plan's OpenSpec tasks referenced in its opening context, and the plan card links to that chat column

#### Scenario: Assigned chat is reused
- **WHEN** a plan was explicitly assigned to a specific chat (per `plan-chat-assignment`) and then starts
- **THEN** the run streams into that assigned chat column rather than creating a new one

#### Scenario: Run completion transitions the plan
- **WHEN** the run session's agent reports the plan's tasks complete (or the user marks the run done)
- **THEN** the plan moves to `finished` after final touches execute, `finished_at` is set, and (when on a worktree branch) the chat surfaces a pull-request recommendation

### Requirement: OMP runner compatibility
The queue SHALL default to the native harness but SHALL also support launching a run in an OMP terminal tab seeded with the plan reference id, preserving the existing OMP-first workflow.

#### Scenario: Run via OMP terminal
- **WHEN** the user chooses "Run with OMP" on a plan
- **THEN** a terminal tab opens in the project directory with an OMP invocation referencing the plan (reference id and OpenSpec change path), and the plan moves to `running`
