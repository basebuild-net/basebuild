## ADDED Requirements

### Requirement: Event-driven inspector freshness
The planning inspector SHALL refresh its Plans, Ideas, and Categories views
live from planning events instead of requiring reopen or manual refetch, and
the inspector's entry point (button/panel affordance) SHALL show an unread
planning-activity badge sourced from the notification store, cleared when the
inspector is opened.

#### Scenario: Live idea appears while the inspector is open
- **WHEN** a generation turn captures an idea while the Ideas tab is visible
- **THEN** the idea row appears without any manual refresh action

#### Scenario: Badge counts unseen planning activity
- **WHEN** two plans are created while the inspector is closed
- **THEN** the inspector entry point shows an unread badge of 2, and opening
  the inspector clears it
