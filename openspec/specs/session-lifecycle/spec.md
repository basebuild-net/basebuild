# session-lifecycle Specification

## Requirements

### Requirement: Launch does not mint sessions
App launch and project auto-restore SHALL reuse the project's most recent
session; a new session row SHALL be created only by an explicit user action
(File → New Session or equivalent control). Focusing the app, switching
projects, or restarting the app MUST NOT create session rows.

#### Scenario: Restart reuses last session
- **WHEN** the app is restarted with a last-active project whose most recent
  session exists
- **THEN** that session is selected with its tabs, chats, and plans visible,
  and the session count for the project is unchanged

#### Scenario: Explicit new session
- **WHEN** the user invokes "New Session"
- **THEN** exactly one new session is created and becomes active

### Requirement: Meaningful session titles
New sessions SHALL start with a neutral placeholder title and SHALL be
auto-titled from the first meaningful activity (first user chat message or
generate-plans goal, truncated to a short phrase) unless the user has set a
title manually. Users SHALL be able to rename a session inline; manual titles
are never overwritten by auto-titling.

#### Scenario: Auto-title from first message
- **WHEN** the user sends the first chat message "Add health-check endpoint
  and rate limiting" in an untitled session
- **THEN** the session title becomes a readable derivative (e.g. "Add
  health-check endpoint…") instead of "Session 05/07/2026, 9:43:47 am"

#### Scenario: Manual rename wins
- **WHEN** the user renames a session and later sends more messages
- **THEN** the manual title is preserved

### Requirement: Stable session list ordering
The project sidebar session list SHALL use a stable ordering (most recently
created or most recent user-visible activity) that does NOT change merely
because a session was selected/opened. Selecting a session MUST NOT bump its
position in the list.

#### Scenario: Selection does not reshuffle
- **WHEN** the user clicks through several sessions in the sidebar
- **THEN** the list order after each click is identical to the order before
  the click

### Requirement: Single instance guard
Launching the app while another instance is running SHALL focus the existing
window instead of starting a second process against the same `state.db`.

#### Scenario: Second launch focuses first
- **WHEN** the user launches the app twice
- **THEN** the second launch exits after bringing the first instance's window
  to the foreground, and only one process holds the database
