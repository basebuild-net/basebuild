# Tasks: panel-grid-state-reliability

## 1. Reproduce and lock the regression

- [x] 1.1 Add a fixture matching the live failure: a valid root leaf plus an `activePanelId` absent from the tree.
- [x] 1.2 Add unit tests proving current `splitPanelAt` behavior is a no-op for a missing target and that shell insertion must not treat it as success.
- [x] 1.3 Add a mocked-Tauri e2e covering header `+` and sidebar creation for Chat, Terminal, Oh My Pi, and Schematic with the corrupt fixture.

## 2. Normalize and validate panel-grid state

- [x] 2.1 Strengthen `parsePanelGrid` with recursive node/panel/size validation and deterministic active-panel repair.
- [x] 2.2 Detect duplicate ids across live leaves/history and return repair diagnostics without deleting backing sessions.
- [x] 2.3 Persist a repaired blob only after the matching project's restore ownership is established.
- [x] 2.4 Unit-test malformed JSON, stale active ids, empty trees, nested splits, invalid sizes, duplicate ids, and live/history collisions.

## 3. Centralize checked panel insertion

- [x] 3.1 Add a typed `insertPanel`/anchor-resolution helper that returns success or a reason and verifies the new panel exists exactly once.
- [x] 3.2 Route header menu, activity sidebar, panel header split, schematic open, file open, history reopen, prompt routing, and plan-run events through the helper.
- [x] 3.3 Replace timestamp-only panel ids with collision-resistant or backend-derived ids.
- [x] 3.4 Surface insertion failures in the notification/log UI; never close a menu as if creation succeeded without visible feedback.

## 4. Make resource-backed creation transactional

- [x] 4.1 Reserve and focus a visible `creating` panel before creating a chat tab or spawning Terminal/Oh My Pi.
- [x] 4.2 Bind returned tab/session/terminal ids atomically on success; roll back the reservation on failure.
- [x] 4.3 Add compensating cleanup for resources acquired before a failed bind and report cleanup failures explicitly.
- [x] 4.4 Regression-test that one click creates exactly one visible panel and one backing tab/process; a failed insert creates zero hidden records and zero processes.
- [x] 4.5 Ensure rapid repeated clicks are serialized/idempotent and cannot create duplicate `Chat 1` tabs or colliding panel ids.

## 5. Isolate project switching

- [x] 5.1 Add a project-keyed loading boundary that disables panel mutation until the selected project's restore completes.
- [x] 5.2 Guard async restore responses with a project/generation token so late project A data cannot hydrate project B.
- [x] 5.3 Capture project ownership in debounced saves and cancel/flush the outgoing save before switching projects.
- [x] 5.4 Consolidate project selection/detection so one user selection emits one diagnostic event.
- [x] 5.5 Add fake-timer and e2e races for rapid A -> B -> A switching, including mutation during restore and delayed save/restore responses.

## 6. Recover legacy orphans

- [x] 6.1 Detect session tabs that have no reachable panel after normalization and expose a non-destructive recovery diagnostic/history entry.
- [x] 6.2 Any permanent orphan cleanup is explicit and confirm-gated; no automatic session/tab deletion.

## 7. Verification

- [x] 7.1 Run `npx tsc --noEmit`, `npm run build`, `cd src-tauri && cargo check`, and `cargo test`.
- [x] 7.2 Run focused panel-grid math/state tests and the mocked-Tauri project-switch/create-panel e2e suite.
- [x] 7.3 Live UI smoke on at least two projects: all four `+` actions and both sidebar actions create/focus exactly one panel; restart preserves each project's independent grid.
- [x] 7.4 Crash/freeze drill per `docs/agents/testing.md`; verify failed creation produces a visible error and no orphan PTY.
- [x] 7.5 Audit every touched interactive control for `title=`, 0px radius, and styles only in `src/styles/globals.css`.

## 8. Docs and roadmap

- [x] 8.1 Update `docs/agents/desktop-shell.md` with normalization, transactional creation, project-transition ownership, and orphan recovery behavior.
- [x] 8.2 Update `docs/agents/testing.md` with the corrupted-restore and cross-project race regression matrix.
- [x] 8.3 Refresh `openspec/ROADMAP.md` via `node scripts/openspec-status.mjs --write` and manually keep the execution narrative/dependency note current.

