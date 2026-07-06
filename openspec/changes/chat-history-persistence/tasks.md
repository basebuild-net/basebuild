# Tasks: chat-history-persistence

## 1. Fix restore-state persistence (bug 1)

- [ ] 1.1 `src/lib/workspace.ts` — make `sideCollapsed`/`sideWidth` required in `WorkspaceRestoreState` to match the backend contract.
- [ ] 1.2 `src/components/layout/AppShell.tsx` — include `sideCollapsed` and `sideWidth` (from the loaded `workspaceRestore`, defaulting safely) in the `saveWorkspaceRestoreState` payload so it round-trips; never clobber the loaded side-panel width.
- [ ] 1.3 `src-tauri/src/models/workspace.rs` — add `#[serde(default)]` to `side_collapsed`/`side_width` as defense-in-depth so a partial payload can never hard-break persistence.
- [ ] 1.4 Ensure workspace-persist failures are logged with command + cause (already logged in AppShell — verify the message is actionable) and not presented as success.

## 2. Persist last active session (bug 2)

- [ ] 2.1 `src/state/sessions.ts` — add an effect that calls `setLastActiveSession(projectPath, activeSessionId)` whenever the active session changes (idempotent, project-scoped).
- [ ] 2.2 Verify `refreshSessions` restore prefers the stored last-active session and falls back to the most recent existing session when it is missing (no new session minted).

## 3. Paginated message loading (backend)

- [ ] 3.1 `native_chat_service` — add a paginated messages query (`session_id`, optional `before` cursor / `sort_order`, `limit`) returning a bounded page in stable order, plus associated tool events/reasoning for those messages.
- [ ] 3.2 `src/lib/native-chat.ts` — thin wrapper for the paginated query; keep the existing load-all for small sessions/tests.
- [ ] 3.3 Backend unit tests: page boundaries are contiguous, stable-ordered, no duplicates/gaps; `before` cursor pagination is correct as new messages append.

## 4. Windowed rendering + lazy load (frontend)

- [ ] 4.1 `src/components/panels/ChatPanel.tsx` — on mount/restore, load the most-recent page instead of all messages; render at the bottom.
- [ ] 4.2 Lazy-load older pages when the user scrolls near the top, with a loading marker and a start-of-conversation marker at history start.
- [ ] 4.3 Preserve the scroll anchor on prepend (pin the top-visible message; no jump), while keeping bottom-follow for live streaming.
- [ ] 4.4 Bound mounted message rows (in-house windowed list with overscan) so long histories don't mount an unbounded DOM; keep reasoning folds/tool cards intact.
- [ ] 4.5 New/short sessions and streaming turns behave unchanged (full load when under one page; new turns append and follow).

## 5. Verification

- [ ] 5.1 `npx tsc --noEmit`, `npm run build`, `cd src-tauri && cargo check`, `cargo test`.
- [ ] 5.2 Regression e2e (mocked Tauri, `BASEBUILD_E2E=1`): persist workspace state produces no `missing field` error; send messages → restart → same last-active session + active chat tab restored with history visible.
- [ ] 5.3 e2e: open a long session loads only the recent window; scrolling up loads older pages with stable scroll position; start-of-history marker appears.
- [ ] 5.4 UI smoke: switching sessions updates the restored session on reopen; no agent/provider process spawned on restore.

## 6. Docs & roadmap

- [ ] 6.1 `docs/agents/desktop-shell.md` — last-active-session persistence + restore; active-tab/chat restore behavior.
- [ ] 6.2 `docs/agents/agent-runtime.md` (or `design-system.md` for the list UI) — windowed history loading (recent window + lazy older pages + scroll anchor + bounded rows).
- [ ] 6.3 Refresh `openspec/ROADMAP.md` narrative and run `node scripts/openspec-status.mjs --write` in the same commit.
