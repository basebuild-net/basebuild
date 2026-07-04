## ADDED Requirements

### Requirement: Plan run queue
The system SHALL maintain a per-project ordered queue of `ready` plans. The user SHALL be able to enqueue, reorder, remove, start, pause, and cancel the queue. Starting the queue SHALL execute plans in order until empty or paused.

#### Scenario: Enqueue and run sequentially
- **WHEN** the user enqueues three `ready` plans and starts the queue with concurrency 1
- **THEN** the first plan moves to `running`; when it reaches `finished` (including final touches), the next plan starts automatically

#### Scenario: Cancel a running plan from the queue
- **WHEN** the user cancels a plan that is `running`
- **THEN** its chat session/agent request is aborted, the plan returns to `ready` (or `cancelled` if the user chose cancel-plan), artifacts are kept, and the queue proceeds to the next plan only if the user cancelled the run rather than pausing the queue

### Requirement: Concurrency and model binding
The queue SHALL have a configurable execution profile of the form `N × <provider/model[/effort]>` (e.g. `4 × umans/glm-5.2`), displayed at the top of the plans UI. At most `N` plans run concurrently, and each run's chat session SHALL be bound to the configured model without manual re-picking.

#### Scenario: Parallel execution
- **WHEN** the profile is `2 × umans/glm-5.2` and four plans are queued
- **THEN** two plans run concurrently in separate chat sessions (and separate workspaces when parallel-workspaces is enabled), and a third starts only when one finishes

#### Scenario: Model binding
- **WHEN** a queued plan starts
- **THEN** its chat session uses the queue's configured provider/model/effort, regardless of what was last selected manually in the composer

### Requirement: Auto-provisioned run sessions
When a plan enters `running`, the system SHALL create a fresh native chat session titled from the plan (reference id + title), with fresh context seeded from the plan (goal, description, focus context, linked OpenSpec change path) and the project schematic, and SHALL surface the session in the workspace.

#### Scenario: Plan start opens a fresh chat
- **WHEN** a plan starts (manually or via the queue)
- **THEN** a new chat session appears named like `bb-x7k2p1 — Add dark mode`, containing no prior conversation, with the plan's OpenSpec tasks referenced in its opening context, and the plan card links to that session

#### Scenario: Run completion transitions the plan
- **WHEN** the run session's agent reports the plan's tasks complete (or the user marks the run done)
- **THEN** the plan moves to `finished` after final touches execute, and `finished_at` is set

### Requirement: OMP runner compatibility
The queue SHALL default to the native harness but SHALL also support launching a run in an OMP terminal tab seeded with the plan reference id, preserving the existing OMP-first workflow.

#### Scenario: Run via OMP terminal
- **WHEN** the user chooses "Run with OMP" on a plan
- **THEN** a terminal tab opens in the project directory with an OMP invocation referencing the plan (reference id and OpenSpec change path), and the plan moves to `running`
