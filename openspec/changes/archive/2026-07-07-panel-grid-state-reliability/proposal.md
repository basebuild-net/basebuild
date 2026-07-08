# Proposal: panel-grid-state-reliability

## Why

The panel creation controls can silently fail for one project while appearing
to work in another. Live diagnosis on 2026-07-07 reproduced the failure in
`basebuild-dotnet` for the header `+` menu and the activity-sidebar controls.
The saved workspace state contained:

- one live panel, `panel-1783338273743`; and
- a stale `activePanelId`, `panel-1783407506176`, which was not present in the
  split tree.

Every create path passes `activePanelId` directly to `splitPanelAt`. When the
anchor is absent, `splitPanelAt` returns the original tree by design. The UI
therefore closes the menu without adding or focusing a panel.

The failure also violates the no-silent-side-effects invariant. Chat creation
writes a `session_tabs` row before attempting the grid update, while Terminal
and Oh My Pi additionally spawn a process. Reproduction created invisible
`Chat 71`, `Chat 72`, and `Terminal 2` tab records even though the visible grid
never changed. The terminal process was started with no reachable panel.

Project switching is the likely producer of the corrupt state: one shared
`panelGridState` is hydrated asynchronously for successive projects and
debounced persistence is keyed by the current project path. There is no
project-bound loading boundary or stale-response guard. Selection is also
performed twice (`handleSelectProject` calls `selectProject`, then the
`activeProjectPath` effect calls it again), which produced duplicate
"Project selected" diagnostics during the UI audit.

This change makes panel state self-healing, project-scoped, and transactional
so a stale pointer can neither disable creation nor produce hidden tabs or
processes.

## What Changes

- Normalize restored panel-grid blobs: validate the tree, repair a missing
  active panel deterministically, reject duplicate/live-vs-history ids, and
  persist the repaired state for the same project.
- Centralize panel insertion behind one reducer/helper that resolves a valid
  anchor from the current tree and reports failure instead of silently
  returning success.
- Make Chat, Terminal, Oh My Pi, Schematic, file-open, history-reopen, split,
  and plan-run insertion use the same checked path.
- Make process-backed creation transactional: reserve a visible pending panel
  before spawning; bind the backend tab/process only on success; roll back the
  pending panel and show/log an actionable error on failure.
- Isolate project transitions with a project-keyed loading boundary, stale
  async-response guards, and project-captured persistence so project A's grid
  cannot be written under project B.
- Ensure a user project selection runs detection/logging once.
- Add recovery visibility for legacy orphaned session tabs without silently
  deleting local data.

### Modified Capabilities

- `panel-grid` (introduced by the in-flight `project-grid-workspace` change) —
  valid anchors, transactional creation, error recovery, and id uniqueness.
- `ide-workspace-state` — project-scoped hydration/persistence and corruption
  repair.
- `desktop-shell` — reliable creation from every shell affordance and
  single-run project selection.
- `workspace-history` (introduced by `project-grid-workspace`) — checked
  re-open with no stale-anchor no-op.

## Impact

- **Frontend**: `AppShell.tsx`, `panelGrid.ts`, `PanelGrid.tsx`,
  `ActivitySidebar.tsx`, `ChatEnvironmentPanel.tsx`, and project/sidebar state.
- **Backend**: no schema change is expected. Existing tab/process commands may
  need a compensating close operation if the frontend cannot complete a bind.
- **Local data**: invalid restore blobs are repaired non-destructively. Orphaned
  tabs are surfaced for recovery; they are never silently deleted.
- **Dependencies**: this is an urgent live-bug amendment to
  `project-grid-workspace`. Apply it with that change's panel-grid substrate or
  immediately after the substrate lands; do not duplicate the grid model.
- **Network/privacy**: none. All state remains local.

