## ADDED Requirements

### Requirement: Workspace restore-state persistence integrity
The workspace restore state SHALL round-trip completely between frontend and backend: the persisted payload MUST carry every field the backend requires to deserialize, so `save_workspace_restore_state` never fails on a missing/mismatched field. A persistence failure MUST be surfaced (logged with an actionable message) rather than silently breaking restore, and a save MUST NOT clobber unrelated persisted fields (e.g. side-panel width) that the caller did not intend to change.

#### Scenario: Full payload round-trips
- **WHEN** the frontend persists workspace state after a tab or session change
- **THEN** the backend accepts the payload without a missing-field error, and `lastSessionId`/`lastTabId` are stored and returned on the next load

#### Scenario: Regression — no missing-field failure
- **WHEN** the app persists workspace state during normal use (tab switch, session switch, sidebar collapse)
- **THEN** no `invalid args state ... missing field` error occurs, and the persist succeeds

#### Scenario: Persist failure is visible
- **WHEN** a workspace-state persist call fails for any reason
- **THEN** the failure is logged with the command and cause, and the app does not present the workspace as successfully saved

#### Scenario: Unrelated fields preserved
- **WHEN** a save is triggered by a tab change that does not touch the side-panel width
- **THEN** the previously persisted side-panel width and collapse state are preserved, not reset to defaults

### Requirement: Active tab and chat restored after reload
After the app restores a project, the previously active workspace tab SHALL be reselected when it still exists, and if it is a chat tab its ChatPanel SHALL load that chat session's persisted history. When the stored active tab no longer exists, restore SHALL prefer an existing chat tab over a neutral empty state without spawning new processes.

#### Scenario: Active chat tab restored with history
- **WHEN** the last active tab was a chat tab bound to a session with saved messages, and the app is restarted
- **THEN** that chat tab is reselected and its transcript loads the session's persisted history (most-recent window), with no new agent process spawned

#### Scenario: Missing active tab prefers a chat tab
- **WHEN** the stored active tab id no longer resolves to a tab
- **THEN** restore focuses an existing chat tab if one exists, otherwise shows the neutral empty state, and never auto-creates a process-backed tab
