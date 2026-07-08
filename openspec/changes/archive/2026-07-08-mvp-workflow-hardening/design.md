# Design: mvp-workflow-hardening

## Context

The current shell restores projects through several independent effects. The
active path begins as `null`, then `projects[0]` is selected; clicking another
project does not refresh its `last_opened_at`. `projectRestoreLoading` is never
set true, so session/panel/provider effects can run against a half-restored
project. Planning generation has a second seam: some actions use the new
destination delivery path while category/idea actions still call
`openOrFocusChat` with insert-only semantics.

## Decisions

### One project activation transaction

Introduce a project activation coordinator with a monotonically increasing
generation. Activation immediately records focus, exposes a non-stale loading
view, and loads detection, workspace restore, last session/chat/panel, planning
counts, and provider/model state in parallel. Only the current generation may
commit. The old project's visible tree is removed before new data is rendered;
on partial failure the boundary shows retry plus the failing subsystem.

Folder picking uses a single in-flight promise and disables all duplicate entry
points until the native dialog resolves. Startup asks the backend for the last
focused project rather than assuming the first recent-project row.

### One planning action router

Schematic, category, idea, promotion-feedback, and artifact-revision actions
produce a typed planning action. The router selects/creates one destination,
verifies the chat has repository and interaction tools, applies the chosen
provider/model/effort/skill, and delivers exactly once in `send` mode. The
planning surface closes or shows a visible “continue in Chat X” state. Missing
tools/provider errors are actionable UI states, not a prose fallback.

### Launch profile at the point of work

A launch profile contains planning engine, provider, model, effort, skill,
worker count, workspace policy (`isolated_worktrees` or `sequential_primary`),
and scheduling mode (`safe` or `yolo`). Project defaults prefill the form, but
the confirmation summarizes effective concurrency, queued overflow, branches,
worktrees, prerequisites, and collisions before dispatch.

### Structured coordination instead of agent chatter

Add a project-scoped dependency graph. Nodes are approved plans; edges come
from explicit prerequisites and inferred affected-path overlap. At runtime,
workers publish file claims, progress, blockers, and artifact revisions to an
append-only coordination ledger. Safe scheduling starts only dependency-ready,
non-conflicting nodes and pauses on newly discovered collisions. YOLO may run
conflicting nodes only after confirmation and marks them for mandatory merge
review. This keeps coordination deterministic and inspectable without relying
on free-form cross-agent messages.

### Responsive surfaces and invariant enforcement

Use anchored/clamped popover geometry with collision handling on all four
viewport edges. At 960×640, secondary header labels collapse into a context
drawer while project/branch/worktree/plan/run state remains reachable. Replace
existing inline styles with documented `globals.css` classes. A static CI check
rejects new stylesheets, inline styles, non-zero radius, and interactive JSX
without a title (with narrow, reviewed exceptions for computed geometry).

### Journey and performance instrumentation

The deterministic MVP fixture has a small Git repo, schematic facts, mock
providers with `ask_user`, categories/ideas, two non-conflicting plans and one
conflicting plan. Tests cover first open through merge-review readiness, restart
focus, partial restore failure, safe/YOLO scheduling, and 960×640/1280×800
snapshots. Performance marks cover click-to-feedback and activation-to-ready;
the 60-second smoke asserts no freeze report, duplicate activation, or false
orphan warning.

## Risks and mitigations

- **Overlap with active changes:** gate implementation on archiving completed
  changes and assign file ownership in `tasks.md`; rebase restore/provider work
  after their owning changes.
- **False collision positives:** show the evidence and allow explicit path
  refinement; safe mode may serialize but never silently reject work.
- **YOLO branch growth:** show worktree/branch count before launch and feed every
  terminal run into the existing integration/prune queue.
- **Loading screen hiding useful partial state:** provide subsystem progress and
  retry details, but never render data belonging to the previous project.
- **Static UI checks overreach:** clear current debt first and keep any dynamic
  geometry exception documented and tested.
