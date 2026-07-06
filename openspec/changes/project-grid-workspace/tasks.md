# Tasks: project-grid-workspace

## 1. Foundation — split-tree model & math

- [ ] 1.1 Add `SplitNode` / `Panel` / `PanelType` / `PanelGridState` types to `src/lib/panelGrid.ts`. Recursive split tree: `leaf | split` with `direction: "row" | "column"`, `children`, fractional `sizes` (0–1, sum to 1). Supports arbitrary `{x}:{y}` layouts.
- [ ] 1.2 Add pure split-tree math with unit tests: `emptyGrid`, `singlePanelGrid`, `panelCount`, `flattenPanels`, `findPanel`, `findParentSplit`, `splitPanelAt` (left/right/top/bottom → wraps in row/column split), `removePanel` (collapses empty splits), `movePanel` (reorder within split), `resizeSplitChild` (adjust fractional sizes with min clamp), `equalizeSplit` (double-click reset), `reflowSplit`. Port drag-distance/reorder-index math from the reference IDE's `chat-stack` pointer logic.
- [ ] 1.3 Add `closedPanels: Panel[]` to `PanelGridState`; `closePanel` (grid → history) + `reopenPanel` (history → grid, split-right of focused) + `deletePanelPermanently` (remove from history) pure functions.
- [ ] 1.4 Extend `src/lib/workspace.ts` `WorkspaceRestoreState` with `panelGrid?: string` (JSON of `PanelGridState`). Add `parsePanelGrid` / `serializePanelGrid` with backward-compat (absent → empty grid). Wire into the existing `save_workspace_restore_state` debounced persist.

## 2. PanelGrid component

- [ ] 2.1 Build `src/components/panels/PanelGrid.tsx`: recursive renderer for `SplitNode` — renders leaves via `renderPanel(panel)`, splitters between split children (row → vertical splitter, column → horizontal splitter), min-width/height clamping, empty state. `key={panel.id}` on leaves to preserve subtree state across drags.
- [ ] 2.2 Build `PanelSplitter.tsx`: port the reference IDE's pointer-based resize with `requestAnimationFrame` batching, min clamping, live resize. Support both `col-resize` (row splits) and `row-resize` (column splits). Double-click to equalize.
- [ ] 2.3 Build `PanelHeader.tsx`: title (inline-editable on double-click), type icon, streaming/progress indicator, more-actions menu (Split right, Split down, Close, Duplicate, History). 0px radius, `title=` on every control. Drag handle for reorder.
- [ ] 2.4 Wire `PanelGrid` in `AppShell.tsx` to replace `WorkspaceTabs` + `ChatGrid` for the center workspace; render chat/terminal/file/schematic panels as leaves via `renderPanel`.
- [ ] 2.5 Wire per-project grid persistence: `AppShell` debounced-saves `PanelGridState` via `save_workspace_restore_state` on grid changes; hydrates on project open.

## 3. Drag-to-split

- [ ] 3.1 Build `DropZoneOverlay.tsx`: renders 4 semi-transparent zones (left/right/top/bottom) on every non-dragged panel during a header drag; highlights the zone under the cursor.
- [ ] 3.2 Wire drag-start on `PanelHeader` (pointerdown → threshold check → drag state with panel id + start coords); render `DropZoneOverlay` on all panels. Port the reference IDE's pointer-event drag system (pointermove/pointerup/pointercancel).
- [ ] 3.3 Wire drop: on pointerup over a drop zone, call `splitPanelAt(targetId, direction, draggedId)`; animate the new panel in (width/height from 0 → allocated share, 180ms ease-out).
- [ ] 3.4 Handle drag-to-reorder within a row/column: port the reference's `resolveChatDragIndex` / `resolveChatDragDistance` / `resolveChatOffset` logic, extended for column direction. Drop on left/right edge within same-direction split → reorder, not split.

## 4. Activity sidebar

- [ ] 4.1 Build `src/components/layout/ActivitySidebar.tsx`: replaces `ProjectChatSidebar.tsx` for the panel list. Shows active project's panels (row-major order from split tree) with title, type icon, status indicator, click-to-focus.
- [ ] 4.2 Add `PanelStatusContext` (React context): each panel leaf publishes its status (`idle | streaming | thinking | running | error | succeeded`) + timestamp; sidebar consumes it.
- [ ] 4.3 Render status indicators: idle (muted dot), streaming (pulsing blue), thinking (pulsing amber), running (spinner), error (red), succeeded (green, fades after 5s). CSS animations in `globals.css`.
- [ ] 4.4 Wire `ActivitySidebar` in `AppShell.tsx` replacing `ProjectChatSidebar` for the panel list; keep project list + account row at the top/bottom.
- [ ] 4.5 Add "History" button at the sidebar bottom with count badge; opens the history drawer.

## 5. History drawer

- [ ] 5.1 Build `HistoryDrawer.tsx`: lists `closedPanels` newest-first with title, type icon, relative close time, "Re-open" + "Delete permanently" actions. Dismiss on outside-click / Escape.
- [ ] 5.2 Wire `reopenPanel`: moves panel from `closedPanels` back to the grid (split-right of focused, or sole panel if empty); loads chat history / reconnects terminal on explicit user action.
- [ ] 5.3 Wire `deletePanelPermanently`: confirm-gated; calls `delete_session` for chats, discards terminal PTY for terminals; removes from `closedPanels`.

## 6. Chronological chat stream

- [ ] 6.1 Refactor `ChatPanel.tsx` message rendering: merge `nativeMessages` + `toolEvents` + `reasoningText` into a single `ChatEvent[]` sorted by `(createdAt, sortOrder)`. Each event has a `kind: "user" | "assistant" | "reasoning" | "tool" | "approval"` field.
- [ ] 6.2 Render `ChatEvent[]` as a flat chronological list: user bubble, assistant bubble, reasoning fold, tool card, approval card — each at its chronological position, not grouped.
- [ ] 6.3 Handle live (null messageId) events: insert them at the end of the sorted list until their messageId is assigned, then move to their correct position.

## 7. E2E mocks & tests

- [ ] 7.1 Extend `src/test-support/tauri-core.ts` with panel-grid mocks if needed (panel state is frontend; restore state already mocked).
- [ ] 7.2 Playwright e2e: create panels (chat + terminal), drag-to-split, resize, close → history, reopen from history, per-project persistence.
- [ ] 7.3 Playwright e2e: activity sidebar shows live status; click to focus; history button opens drawer.
- [ ] 7.4 Playwright e2e: chat chronological stream — reasoning → tool → message in order.
- [ ] 7.5 `npx tsc --noEmit`, `npm run build`, `cd src-tauri && cargo check`, `cargo test --lib`.

## 8. Cleanup & docs

- [ ] 8.1 Remove `WorkspaceTabs.tsx`, `ChatGrid.tsx` (replaced by PanelGrid), old `ProjectChatSidebar.tsx` panel-list code. Migrate all callers.
- [ ] 8.2 Update `docs/agents/desktop-shell.md` — panel grid, drag-to-split, activity sidebar, history drawer, per-project persistence.
- [ ] 8.3 Update `docs/agents/design-system.md` — new CSS classes (panel-grid, splitter, panel-header, drop-zone, activity-sidebar, history-drawer).
- [ ] 8.4 Refresh `openspec/ROADMAP.md` + run `node scripts/openspec-status.mjs --write` in the same commit.
