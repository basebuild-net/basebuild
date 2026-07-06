# Proposal: chat-history-persistence

## Why

On reopening the app, chat history does not come back — the user lands on an
empty or unrelated chat even though the conversation was saved. Diagnosis of
the running `feat/chat-first-shell` build (2026-07-06) found **two concrete
restore bugs**, plus a **rendering-scale gap**:

1. **Workspace state never persists.** `save_workspace_restore_state` fails on
   every call with `invalid args state ... missing field sideCollapsed`. The
   Rust `WorkspaceRestoreState` model (`src-tauri/src/models/workspace.rs`)
   requires `side_collapsed: bool` and `side_width: i64` (non-`Option`), but
   the frontend save in `AppShell.tsx` omits both fields. Because the payload
   fails to deserialize, `lastSessionId`/`lastTabId` are never stored, so the
   active tab cannot be restored.
2. **Last active session is never recorded.** `setLastActiveSession`
   (`set_last_active_session`) is imported in `src/state/sessions.ts` but never
   called. The project's `lastActiveSessionId` is therefore never updated, and
   on reopen `refreshSessions` falls back to `list[0]` — the most **recently
   created** session (`created_at DESC`), not the one the user was last in. The
   old conversation is intact in SQLite but a different/empty session is shown.
3. **History loads all-at-once.** Messages *are* persisted (the native harness
   writes every message/tool event/approval to SQLite; `ChatPanel` loads them
   via `nativeChatMessages(sessionId)`), but the panel fetches and renders the
   **entire** history in one pass with no pagination or windowing. Long
   sessions will render thousands of DOM nodes at once, hurting open time and
   scroll performance.

This change makes chat history reliably persist, restore, and load: fix the
two restore bugs (as testable requirements), and add windowed rendering with
lazy load-on-scroll-up so large histories open fast and render incrementally.

## What Changes

### Reliable restore (fixes the two live bugs)
- The workspace restore state SHALL round-trip completely: the persisted
  payload carries every field the backend requires, persistence never fails
  silently on a field mismatch, and a persist failure is surfaced (logged
  actionably), not swallowed. (Captures bug 1 — `sideCollapsed`/`sideWidth`.)
- The **last active session** SHALL be persisted whenever the active session
  changes and restored on reopen, so the app reopens the session/chat the user
  was last in — not merely the most-recently-created session. (Captures bug 2
  — `setLastActiveSession` never called.)
- After restore, the previously active chat tab SHALL be reselected and its
  ChatPanel SHALL load that session's persisted history.

### Persist ALL history + windowed loading (the feature)
- All chat messages, tool events, reasoning, and approvals SHALL remain durably
  persisted per session (assert + regression-test the existing behavior).
- On opening a chat (new or restored), the system SHALL load the **most recent
  window** of messages (a bounded page), not the entire history.
- Scrolling toward the top SHALL **lazy-load older messages** in pages, with the
  scroll position anchored so the viewport does not jump when older content
  prepends.
- The message list SHALL bound the number of simultaneously rendered messages
  (windowing/virtualization) so a very long history stays responsive.

### New Capabilities
- `chat-history-loading` — persist-all + paginated backend message query +
  windowed frontend rendering + lazy load-on-scroll-up + scroll-anchor
  preservation.

### Modified Capabilities
- `session-lifecycle` — "Launch does not mint sessions" clarified: the **last
  active** session is persisted on change and restored on reopen (not just the
  most-recently-created one).
- `ide-workspace-state` — adds a **restore-state persistence integrity**
  requirement: the workspace restore payload round-trips without dropped
  fields, and persist failures are surfaced rather than silently breaking
  restore.

## Impact

- **Frontend**:
  - `src/lib/workspace.ts` — `WorkspaceRestoreState` type includes
    `sideCollapsed` + `sideWidth` (align with backend contract).
  - `src/components/layout/AppShell.tsx` — the `saveWorkspaceRestoreState` call
    sends the full state (preserving loaded `sideCollapsed`/`sideWidth`).
  - `src/state/sessions.ts` — call `setLastActiveSession` when the active
    session changes.
  - `src/components/panels/ChatPanel.tsx` — replace the load-all
    `nativeChatMessages(sessionId)` mount fetch with a windowed loader (initial
    recent page + lazy older pages on scroll-up) and bound rendered rows.
  - `src/lib/native-chat.ts` — thin wrapper for the paginated messages query.
- **Backend (Rust)**:
  - `native_chat_service` — add a paginated messages query
    (`limit` + `before` cursor / `sort_order`) alongside the existing
    load-all; keep tool events/reasoning associated per message.
  - Optionally harden `save_workspace_restore_state` deserialization
    (see design) so a partial payload cannot silently break persistence.
- **Dependencies**: none added. Windowing uses the existing React stack; no
  new virtualization library unless justified in design (prefer a lightweight
  in-house windowed list to honor `globals.css`/0px conventions).
- **Tests**:
  - Regression: `save_workspace_restore_state` accepts the frontend payload
    (no missing-field error); reopening restores the last active session + tab.
  - Unit: paginated message query returns correct pages/order; scroll-anchor
    math on prepend.
  - Playwright e2e (mocked Tauri): send messages → reopen → same session/chat
    restored with history visible; scroll up loads older pages.
- **Security / trust boundaries**: none new. All reads are local SQLite; no
  network, no new credentials, no new side effects. Restore remains
  no-silent-side-effects (no agent/provider calls on load).
- **Coordination**: `ide-workspace-state` is also modified by
  `parallel-plan-workspaces` (grid persistence). This change only **adds** a
  restore-integrity requirement (no edit to the shared "Project Workspace
  Restore" requirement), so the two changes do not conflict. Independent of the
  `chat-first-shell` gate — these are live-bug fixes and can land immediately.
