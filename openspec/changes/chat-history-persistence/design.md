# Design: chat-history-persistence

## Context

Reported symptom: reopening the app does not load chat history. Investigation
of the running `feat/chat-first-shell` build (2026-07-06) traced this to two
independent restore bugs, and surfaced a third scale gap in rendering. History
itself is persisted correctly; the failure is in **restore** and **load
strategy**.

### Diagnosis (evidence)

**Bug 1 — workspace restore state never persists (serialization contract
mismatch).**
- Backend `src-tauri/src/models/workspace.rs` `WorkspaceRestoreState` declares
  `side_collapsed: bool` and `side_width: i64` as **required** (non-`Option`,
  `#[serde(rename_all = "camelCase")]`).
- Frontend `src/lib/workspace.ts` types them optional (`sideCollapsed?`,
  `sideWidth?`), and `src/components/layout/AppShell.tsx`'s
  `saveWorkspaceRestoreState({ … })` call omits **both**.
- Result: every persist fails with `invalid args state for command
  save_workspace_restore_state: missing field sideCollapsed` (seen repeatedly
  in the logs). `lastSessionId`/`lastTabId` are never written, so tab restore
  has nothing to read.

**Bug 2 — last active session never recorded.**
- `set_last_active_session` exists (`src/lib/projects.ts`) and is imported in
  `src/state/sessions.ts` (`setLastActiveSessionApi`) but is **never called**.
- The project's `lastActiveSessionId` therefore stays null/stale. On reopen,
  `useSessionState.refreshSessions` picks `list[0]` — the newest session by
  `created_at DESC` — instead of the session the user last used. The prior
  conversation is intact in SQLite but a different session is shown.

**Gap 3 — history renders all-at-once.**
- Messages/tool events are persisted by the native harness and loaded in
  `ChatPanel` via `nativeChatMessages(sessionId)` + `nativeChatToolEvents(…)`
  on mount (a single load-all fetch). There is no pagination or windowing, so
  a long session mounts its entire transcript at once.

## Goals / Non-Goals

**Goals**
- Reopen restores the exact last-active session and its active chat tab with
  history visible.
- Workspace-state persistence never silently fails on a field mismatch.
- Chat history persists in full and loads incrementally (recent window + lazy
  older pages) with a bounded rendered DOM.

**Non-Goals**
- Multi-chat grid / tabs (owned by `parallel-plan-workspaces`).
- History compaction/summarization (owned by `session-compaction`).
- Changing what is stored (analytics exclusions unchanged); this is about
  loading/restoring the existing local chat store.

## Decisions

**Decision**: Fix the serialization contract by making the frontend send the
full `WorkspaceRestoreState` (include `sideCollapsed`/`sideWidth` from the
loaded state), and type them required in `workspace.ts`. Additionally harden
the backend with `#[serde(default)]` on those two fields as defense-in-depth.
**Rationale**: The frontend-sends-full-state fix restores correctness and keeps
the contract strict; the serde default prevents a future partial payload from
hard-breaking persistence entirely. The save path preserves loaded values so it
never clobbers side-panel width.
**Alternatives**: Only add `#[serde(default)]` — rejected alone, because a
default `side_width: 0` would clamp to 180 and reset the user's width on every
save that omits it; the frontend must send real values.

**Decision**: Persist last-active session via an effect in `useSessionState`
that calls `setLastActiveSession(projectPath, activeSessionId)` whenever the
active session changes (idempotent, project-scoped).
**Rationale**: Smallest correct wiring of the already-existing command; matches
`session-lifecycle`'s intent ("reuse the project's last active session"). Writes
`last_selected_at`, not `updated_at`, so it does not reshuffle the sidebar
order.
**Alternatives**: Drive restore from `workspaceRestore.lastSessionId` in
AppShell — rejected; session selection already flows through
`useSessionState(path, project.lastActiveSessionId)`, so persisting the project
field is the single-source fix.

**Decision**: Add a paginated backend messages query
(`native_chat_messages_page(session_id, before?, limit)`) returning a bounded
page in stable `sort_order`, and load the most-recent page first; scroll-up
fetches older pages by `before` cursor. Keep the existing load-all for small
sessions / tests.
**Rationale**: Constant open cost regardless of history length; cursor
pagination avoids offset drift as new messages append.
**Alternatives**: Offset pagination — rejected; offsets drift when new rows
land. Load-all-then-window in the client — rejected; still fetches the whole
history over IPC.

**Decision**: Windowed rendering via a lightweight in-house virtualized list
(fixed overscan) rather than a new dependency, with a scroll anchor that pins
the top-visible message when older pages prepend.
**Rationale**: Honors the one-stylesheet / no-extra-dep conventions; message
rows vary in height, so a measured/anchored window with overscan is enough —
no need for a heavy virtualization lib. Anchor-on-prepend prevents scroll jump.
**Alternatives**: `react-virtuoso`/`react-window` — reconsider only if the
in-house window proves insufficient for variable-height rows; adds a dep and
styling friction.

## Risks / Trade-offs

- **Variable-height messages complicate windowing.** → Use measured heights +
  overscan and anchor on the top-visible element; validate scroll stability in
  e2e with mixed message sizes (code blocks, tool cards, reasoning folds).
- **Two changes touch `ide-workspace-state`.** → This change only **adds** a
  requirement (restore integrity) and does not edit the shared "Project
  Workspace Restore" requirement that `parallel-plan-workspaces` modifies —
  no archive conflict.
- **Bottom-follow vs. older-page load interaction.** → Track "at bottom" state
  separately from older-page fetches so streaming still auto-scrolls while a
  prepend is in flight.
- **Backend paginated query correctness at page boundaries.** → Cover with unit
  tests (contiguous, no dup/gap across pages, stable order).

## Migration Plan

- All fixes are additive and backward compatible. Existing sessions load under
  the new windowed loader unchanged (small sessions load fully).
- `WorkspaceRestoreState` gains no new stored fields; the fix is honoring the
  existing contract. No DB migration required.
- Rollback: reverting the `AppShell`/`workspace.ts`/`sessions.ts` edits restores
  prior (broken) behavior; the paginated query is additive and unused if the
  panel reverts to load-all.

## Open Questions

- Page size N and overscan count — pick defaults (e.g. 50 messages/page, small
  overscan) and confirm against real long sessions during apply.
- Should the "load older" affordance be automatic on scroll only, or also a
  manual "Load earlier messages" button for accessibility? Default: automatic
  on scroll with a visible loading marker; revisit if needed.
