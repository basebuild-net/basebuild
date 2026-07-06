# Design: project-grid-workspace

## Context

The current shell renders one tab at a time (terminal, chat, file, schematic)
behind a flat `WorkspaceTabs` bar. Only chat tabs get a multi-column grid
(`ChatGrid`). The left sidebar lists chat sessions, not live panel activity.

This change flattens tabs + chat grid into a single **panel grid**: any panel
type is a leaf in a split tree, drag-to-split creates VS Code-style splits in
both directions (`{x}:{y}`), closing moves to a history drawer, and the
sidebar shows live panel status.

The drag-reorder, resize, and close-animation logic is ported from an
MIT-licensed reference IDE's chat-stack component. The reference only supports
`{x}:1` (a single horizontal row of chats); this change extends it to a
recursive split tree supporting arbitrary `{x}:{y}` layouts (horizontal splits
within rows, vertical splits between rows, nested arbitrarily).

Existing substrate we build on (do not re-implement):
- `gridMath.ts` — width clamping, resize, reorder, reflow math (reused for
  panel resize; the split-tree model is a new layer on top).
- `save_workspace_restore_state` — already persists per-project blobs; we
  extend the blob's shape, no new DB table.
- `SessionTab` — the existing `kind` field (`terminal | empty | file | chat
  | omp`) maps 1:1 to `Panel.type`. No schema migration needed.
- `ChatPanel`, `TerminalPanel`, `FileViewer`, `ProjectSchematicTab` —
  rendered as panel leaves; their internal logic is unchanged.

## Goals / Non-Goals

**Goals**:
- Unified grid that holds any panel type, supporting `{x}:{y}` layouts.
- VS Code-style drag-to-split with visual drop zones (both directions).
- Drag-to-reorder within a row/column.
- Resize splitters in both horizontal and vertical directions.
- Close-to-history with re-open.
- Activity sidebar with live status indicators.
- Chronological chat message stream.
- Per-project grid persistence (layout survives app restart).

**Non-Goals**:
- Popping panels out into separate windows (future).
- Tab/panel tearing-off into a separate OS window.
- Redesigning the chat composer or provider model (unchanged).
- Backend changes beyond the restore-state blob shape.

## Decisions

### Split-tree data model

**Decision**: Use a recursive split-tree (`SplitNode`) instead of the
existing `rows: string[][]` flat-row model.

**Rationale**: The flat-row model can't express arbitrary vertical splits
within a row, or nested splits (a terminal split-right of a chat that's
already in a column split). A split tree
(`{ direction: "row" | "column", children: [...], sizes: number[] }`)
handles any `{x}:{y}` layout naturally and serializes to JSON for the
restore blob. The reference IDE's 1×N model is a degenerate case (one row
split with N children).

```typescript
type PanelType = "chat" | "terminal" | "file" | "schematic" | "omp";

type Panel = {
  id: string;           // matches SessionTab.id
  type: PanelType;      // matches SessionTab.kind (empty → schematic)
  title: string;
  chatSessionId: string | null;
  terminalId: number | null;
  filePath: string | null;
};

type SplitDirection = "row" | "column";  // row = side-by-side, column = stacked

type SplitNode =
  | { kind: "leaf"; panel: Panel }
  | { kind: "split"; direction: SplitDirection; children: SplitNode[]; sizes: number[] };
```

### Sizes model

**Decision**: Fractional sizes (0–1, sum to 1.0) per split node.

**Rationale**: Resolution-independent. The renderer converts fractions to
pixels using available space. Resize adjusts the balance between adjacent
children. On serialize, fractions are stable across viewport sizes.

### Panel grid component

**Decision**: Build `PanelGrid.tsx` (replaces `ChatGrid.tsx`) that takes a
`SplitNode` tree and renders it recursively. Each leaf renders via
`renderPanel(panel)`. Splitters render between children of a split node,
oriented based on the split direction (row → vertical splitters, column →
horizontal splitters).

### Drag-to-split interaction

**Decision**: On header drag-start, render four overlay zones (left/right/
top/bottom) on every other panel. On drop:
- Left/right drop on a panel in a row split → insert beside it in that row.
- Top/bottom drop on a panel in a column split → insert beside it in that column.
- Left/right drop on a panel in a column split (or standalone) → wrap it in
  a new row split.
- Top/bottom drop on a panel in a row split (or standalone) → wrap it in a
  new column split.

This is the VS Code model. Visual zones make the split direction obvious
before committing. The drag-reorder logic (within a row/column) is ported
from the reference IDE's pointer-based drag system.

### Resize logic

**Decision**: Port the reference IDE's pointer-based resize with
`requestAnimationFrame` batching and min-width/min-height clamping. Extend
it to handle both horizontal (col-resize) and vertical (row-resize)
splitters. Double-click a splitter to equalize sizes in that split.

### Activity sidebar status

**Decision**: Each panel exposes a `status` field via a shared context:
`"idle" | "streaming" | "thinking" | "running" | "error" | "succeeded"`.
The sidebar reads this context to render the indicator dot + animation.

### Chat message chronology

**Decision**: Change ChatPanel's message rendering from "interleave tool
events by messageId + live events at end" to a single sorted list of all
events (user messages, assistant messages, reasoning folds, tool cards,
approvals) sorted by `(createdAt, sortOrder)`. Each event has a `kind`
field that determines its render component.

### History drawer

**Decision**: Closed panels move to a `closedPanels: Panel[]` array in the
project's grid state. Re-open moves the panel back to the grid (split-right
of focused, or sole panel if empty). "Delete permanently" calls
`delete_session` / discards the terminal.

### Persistence

**Decision**: The full `PanelGridState` (split tree + closed panels + active
panel id) is serialized to JSON and stored in the `tabGridStates` field of
`WorkspaceRestoreState`. The existing debounced (250ms) save handler in
AppShell persists it. On project open, the grid hydrates from the restore
state. Legacy restore states (without `panelGrid`) default to an empty grid.

## Risks / Trade-offs

- **Split-tree complexity**: recursive rendering + resize + drag-to-split is
  harder than the flat-row model. Mitigation: unit-test the split-tree math
  exhaustively.
- **Panel remounting on drag**: moving a panel between splits could remount
  React and lose state. Mitigation: use `key={panel.id}` so React preserves
  the subtree.
- **Restore-state blob growth**: the split tree + closed panels add to the
  restore blob. Mitigation: debounce persists (250ms); prune history entries
  older than 30 days.
- **Activity-sidebar performance**: reading panel status on every render
  could cause re-renders. Mitigation: use a context with a selector so only
  the sidebar rows re-render, not the grid.

## Migration Plan

1. Build `PanelGrid.tsx` + split-tree math alongside the existing `ChatGrid`
   (no cutover yet).
2. Wire `ActivitySidebar.tsx` alongside the existing sidebar.
3. Add the drag-to-split overlay + `splitPanelAt` mutation.
4. Switch `AppShell` to render `PanelGrid` + `ActivitySidebar` (cutover).
5. Migrate chat rendering to the chronological stream.
6. Add history drawer.
7. Update e2e mocks + tests.
8. Remove `WorkspaceTabs.tsx`, `ChatGrid.tsx`, old sidebar code.

Rollback: revert step 4 — the old tab bar + ChatGrid code is retained until
step 8, so a revert restores prior behavior without DB changes.

## Open Questions

- Should the activity sidebar show panels from all open projects or only the
  active project? **Decision: active project only** — keeps it simple.
- Should drag-to-split support tearing off into a new window? **No — future
  scope.**
- Should the history drawer show a preview of the chat content? **No — just
  title, type, timestamp.** Keeps it fast.
