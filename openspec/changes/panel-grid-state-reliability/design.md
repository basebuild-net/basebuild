# Design: panel-grid-state-reliability

## Context

`PanelGridState` stores a recursive split tree, `activePanelId`, and closed
panels. `parsePanelGrid` currently performs only shallow shape validation and
returns the blob unchanged. Creation callbacks then use:

```ts
prev.activePanelId ?? flattenPanels(prev.root).at(-1)?.id ?? ""
```

A non-null stale id wins over the valid fallback. `splitPanelAt` cannot find
that target and returns the original root, so callers set a new active id while
retaining the old tree. Backend tab/process creation is often started before
this silent no-op is known.

The grid state is also held in one React state value while project restore is
loaded asynchronously. The persistence timer reads the current project path,
restore object, and grid state from changing render closures. Switching
projects can therefore expose the previous grid during the transition and
accept a late restore or save for the wrong project.

## Goals / Non-Goals

**Goals**

- Any structurally recoverable restore blob becomes a valid grid state before
  user interaction.
- Every panel creation/reopen either becomes visible and focused exactly once,
  or leaves no tab/process side effect behind.
- Project switches never display, mutate, or persist another project's grid.
- Failures are visible and actionable instead of menu-close no-ops.

**Non-Goals**

- Redesigning the split-tree layout or visual shell.
- Automatically deleting legacy orphaned sessions/tabs.
- Changing terminal, chat, or OMP runtime behavior after a panel is bound.

## Decisions

### Normalize state at the boundary

Add `normalizePanelGrid(raw)` (or strengthen `parsePanelGrid`) to recursively
validate node kinds, panel ids, child lists, and size arrays. It returns a
normalized state plus repair diagnostics. If `activePanelId` is not a live
leaf, select the first live panel in stable tree order (or `null` for an empty
tree). Closed-panel ids must not duplicate live ids; malformed entries are
quarantined/reported rather than trusted.

This repairs existing installations immediately and prevents every consumer
from having to understand corrupt persistence.

### One checked insertion primitive

Introduce a pure `insertPanel(state, panel, placement)` result:

```ts
type InsertPanelResult =
  | { ok: true; state: PanelGridState }
  | { ok: false; reason: string };
```

It resolves a valid anchor by checking whether the requested/active id exists,
then falls back to a deterministic live leaf. Empty grids accept the panel as
the root. It verifies that the new panel id appears exactly once before
returning success. `splitPanelAt` remains useful math, but shell code no longer
interprets an unchanged tree as successful insertion.

All shell paths use this primitive, including file open, plan-run events, drag
splits, sidebar creation, header creation, schematic open, and history reopen.

### Reserve, then acquire process resources

For Chat, Terminal, and Oh My Pi, first insert a visible panel in `creating`
state. Only after insertion succeeds may the app create the session tab or
spawn the process. On success, atomically bind the returned identifiers and
clear `creating`. On failure, remove the reservation and surface an error.

If an unavoidable backend resource is acquired before the final bind, execute
an explicit compensating close and log both the original and cleanup outcomes.
This ordering guarantees a stale UI anchor cannot spawn an unreachable PTY.

Use collision-resistant ids (`crypto.randomUUID()` or the persisted tab id)
instead of `Date.now()` so concurrent callbacks cannot create duplicate panel
ids.

### Key workspace state by project transition

Treat `(projectPath, panelGridState)` as one ownership unit. When selection
starts, disable panel mutations and show a neutral loading state until that
project's restore resolves. Tag restore requests with a generation/token and
ignore late responses from prior projects. Debounced saves capture the project
path and the normalized state they belong to; cancel or flush the outgoing
project's timer before changing ownership.

Consolidate project detection/selection into one path so a click produces one
detection call and one diagnostic event.

### Preserve legacy data

Do not silently delete `session_tabs` rows that are absent from the visible
grid. Report them as recoverable orphaned tabs and offer an explicit,
confirm-gated cleanup or history recovery path. This protects user data while
making prior silent failures discoverable.

## Risks / Trade-offs

- **Pending panels add a transient UI state.** Keep it compact and disable
  panel actions until binding completes.
- **Compensating process cleanup can also fail.** Log both failures and expose
  the orphan for explicit recovery; never claim success.
- **Repair persistence could race a project switch.** Persist only through the
  project-keyed ownership mechanism and cover it with fake-timer race tests.
- **Overlap with `project-grid-workspace`.** Implement as an amendment to its
  state model and tests, not a parallel grid architecture.

## Migration Plan

- No database migration.
- On first load, normalize each project's blob in memory and write back only
  after ownership is established for that same project.
- Existing orphaned tabs remain intact and are reported for user-directed
  recovery/cleanup.
- Rollback leaves normalized JSON compatible with the previous reader.

