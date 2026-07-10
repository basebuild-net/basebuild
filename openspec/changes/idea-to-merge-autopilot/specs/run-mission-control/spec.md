## ADDED Requirements

### Requirement: Mission control board
The system SHALL provide a project-scoped mission control board rendering one
card per plan run that is queued, running, blocked, awaiting review, or
finished-but-unintegrated. Each card SHALL show: plan reference and title,
owner chat (click focuses that chat panel), branch and worktree indicator,
task progress (`n/m` with a bar), live run state, elapsed time, and current
blockers (collisions, prerequisites, approval waits). The board SHALL update
from planning events without manual refresh, SHALL stay consistent with the
sidebar agent-status indicators, and SHALL follow the design system (0px
radius, `title=` tooltips, `globals.css` only).

#### Scenario: Two runs render as live cards
- **WHEN** two plans run concurrently at `3/10` and `6/8` tasks
- **THEN** the board shows two cards with their plan references, owner chats,
  branches, progress bars, and running state, updating as tasks tick without
  reopening the board

#### Scenario: Card click focuses the owner chat
- **WHEN** the user clicks a run card's owner chat
- **THEN** that chat panel receives focus in the workspace grid

#### Scenario: Queued run is visually distinct
- **WHEN** a launched run waits on a provider concurrency slot
- **THEN** its card shows the queued state (not running, not failed) with the
  provider cap named in the tooltip

### Requirement: Completion estimates
Run cards SHALL show a projected completion time while the run is `running`
and at least one task-completion tick has been observed, derived from
observed task-completion velocity (linear projection over remaining tasks),
explicitly labeled as an estimate, updating as further ticks arrive. Before
the first tick the card SHALL show elapsed time with an "estimating" label
instead of a number. Estimates SHALL never gate or trigger behavior — they
are display-only. A finished or cancelled run SHALL show its actual duration
instead of an estimate.

#### Scenario: Estimate follows task velocity
- **WHEN** a run completes 4 tasks in 8 minutes with 6 tasks remaining
- **THEN** the card shows an estimated completion of ~12 more minutes, labeled
  as an estimate, and the value updates after the next task tick

#### Scenario: No ticks yet
- **WHEN** a run is streaming but has completed zero tasks
- **THEN** the card shows elapsed time and "estimating" with no fabricated
  number

#### Scenario: Terminal runs show actual duration
- **WHEN** a run reaches `finished`
- **THEN** the card replaces the estimate with the actual elapsed duration

### Requirement: Attention states
Run cards SHALL surface a distinct attention state whenever the run waits on
user action — a pending tool approval, a pending ask_user question, a
mark-as-complete prompt, or merge readiness — with a direct action that
navigates to the exact surface resolving it. Attention states SHALL be
visually distinguishable from normal running state and SHALL clear when the
underlying wait resolves.

#### Scenario: Pending question raises attention
- **WHEN** a run's chat has a pending ask_user interaction
- **THEN** the run's card shows an attention state naming the wait, and
  clicking it focuses the question card in that chat

#### Scenario: Attention clears on resolution
- **WHEN** the user answers the pending question
- **THEN** the card returns to the normal running presentation without manual
  refresh
