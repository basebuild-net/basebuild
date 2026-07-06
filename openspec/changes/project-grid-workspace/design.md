# Design: project-grid-workspace

## Context

The current shell renders one tab at a time (terminal, chat, file, schematic)
behind a flat `WorkspaceTabs` bar. Only chat tabs get a multi-column grid
(`ChatGrid`). The left sidebar lists chat sessions, not live panel activity.

This change flattens tabs + chat grid into a single **panel grid**: any panel
type is a leaf in a split tree, drag-to-split creates VS Code-style splits,
closing moves to a history drawer, and the sidebar shows live panel status.

Reference: [t3code](https://github.com/pingdotgg/t3code) (MIT) for the
activity-sidebar + panel-grid visual model. We port layout logic and visual
structure, not files or dependencies.

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
- Unified grid that holds any panel type.
- VS Code-style drag-to-split with visual drop zones.
- Close-to-history with re-open.
- Activity sidebar with live status indicators.
- Chronological chat message stream.
- Per-project grid persistence.

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
within a row. A split tree (`{ direction: "row" | "column", children: [leaf
| split, ...], sizes: number[] }`) handles any `M×N` layout naturally and
serializes to JSON for the restore blob.

**Alternatives**: Keep the flat-row model and add a separate column-split
concept — rejected because it creates two parallel layout systems and can't
express nested splits (e.g. a terminal split-right of a chat that's already
in a row).

```typescript
type PanelType = "chat" | "terminal" | "file" | "schematic" | "omp";

type Panel = {
  id: string;           // matches SessionTab.id
  type: PanelType;      // matches SessionTab.kind
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

### Panel grid component

**Decision**: Build `PanelGrid.tsx` (replaces `ChatGrid.tsx`) that takes a
`SplitNode` tree and renders it recursively. Each leaf renders via
`renderPanel(panel)`. Splitters render between children of a split node.

**Rationale**: Recursive rendering of a split tree is the standard approach
(VS Code, Eclipse, IntelliJ all use it). It's simple, testable, and handles
arbitrary nesting.

### Drag-to-split interaction

**Decision**: On header drag-start, render four overlay zones (left/right/
top/bottom) on every other panel. On drop, call `splitPanel(targetId,
direction, draggedId)` which mutates the split tree: the target leaf becomes
a new split node containing the target + the dragged panel.

**Rationale**: VS Code's approach. Visual zones make the split direction
obvious before committing.

### Activity sidebar status

**Decision**: Each panel exposes a `status` field via a shared context:
`"idle" | "streaming" | "thinking" | "running" | "error" | "succeeded"`.
The sidebar reads this context to render the indicator dot + animation.

**Rationale**: A shared context avoids prop-drilling and lets any panel type
report its status without the sidebar knowing about chat vs terminal internals.

### Chat message chronology

**Decision**: Change ChatPanel's message rendering from "interleave tool
events by messageId + live events at end" to a single sorted list of all
events (user messages, assistant messages, reasoning folds, tool cards,
approvals) sorted by `(createdAt, sortOrder)`. Each event has a `kind` field
that determines its render component.

**Rationale**: The current two-path rendering (messages vs tool events with
a `withMessageId` map + `live` array) creates chronological ambiguity — live
approval events render after all messages even if they occurred mid-stream.
A single sorted list is simpler and strictly chronological.

### History drawer

**Decision**: Closed panels move to a `closedPanels: Panel[]` array in the
project's grid state. The history drawer reads this array. Re-open moves the
panel back to the grid (split-right of focused, or sole panel if empty).
"Delete permanently" calls `delete_session` / discards the terminal.

**Rationale**: Avoids a new DB table — closed panels are just SessionTab
rows that aren't in the active split tree. The `closedPanels` array is
persisted in the restore blob alongside the split tree.

## Risks / Trade-offs

- **Split-tree complexity**: recursive rendering + resize is harder than the
  flat-row model. Mitigation: unit-test the split-tree math (split, resize,
  remove, reflow) exhaustively in `gridMath.spec.ts`.
- **Panel remounting on drag**: moving a panel between splits could remount
  React and lose state. Mitigation: use `key={panel.id}` and a stable
  render function so React preserves the subtree.
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
3. Add the drag-to-split overlay + `splitPanel` mutation.
4. Switch `AppShell` to render `PanelGrid` + `ActivitySidebar` (cutover).
5. Migrate chat rendering to the chronological stream.
6. Add history drawer.
7. Update e2e mocks + tests.
8. Remove `WorkspaceTabs.tsx`, `ChatGrid.tsx`, old sidebar code.

Rollback: revert step 4 — the old tab bar + ChatGrid code is retained until
step 8, so a revert restores prior behavior without DB changes.

## Open Questions

- Should the activity sidebar show panels from all open projects (like t3code)
  or only the active project? **Decision: active project only** — keeps it
  simple and matches the "project → grid" mental model.
- Should drag-to-split support tearing off into a new window? **No — future
  scope.**
- Should the history drawer show a preview of the chat content? **No — just
  title, type, timestamp.** Keeps it fast.
