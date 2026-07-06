## MODIFIED Requirements

### Requirement: Launch does not mint sessions
App launch and project auto-restore SHALL reuse the project's **last active** session; a new session row SHALL be created only by an explicit user action (File → New Session or equivalent control). Focusing the app, switching projects, or restarting the app MUST NOT create session rows. The last active session id SHALL be persisted per project whenever the active session changes, and restore SHALL prefer it over the most-recently-created session; if the stored last-active session no longer exists, restore falls back to the most recent session.

#### Scenario: Restart reuses last session
- **WHEN** the app is restarted with a last-active project whose most recent session exists
- **THEN** that session is selected with its tabs, chats, and plans visible, and the session count for the project is unchanged

#### Scenario: Last active session is restored, not newest
- **WHEN** the user works in an older session (created before other sessions in the project), then restarts the app
- **THEN** the app reopens that same last-active session with its chat history, not the most-recently-created session

#### Scenario: Active session change is persisted
- **WHEN** the user switches from session A to session B
- **THEN** the project's stored last-active session becomes B, so a subsequent restart reopens B

#### Scenario: Stale last-active falls back
- **WHEN** the stored last-active session has been deleted
- **THEN** restore selects the project's most recent existing session without creating a new one

#### Scenario: Explicit new session
- **WHEN** the user invokes "New Session"
- **THEN** exactly one new session is created and becomes active
