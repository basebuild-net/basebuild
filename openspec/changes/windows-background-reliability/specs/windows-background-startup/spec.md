## ADDED Requirements

### Requirement: User-controlled Windows launch at sign-in

Basebuild SHALL provide one persisted launch-at-sign-in preference whose effective state is reconciled with the current Windows autostart registration. The control SHALL be available during first-run setup and in Settings, and changing it SHALL update both persisted state and the operating-system registration or return an actionable error without reporting a false enabled state.

#### Scenario: First-run setup proposes launch at sign-in

- **WHEN** a new Windows user reaches the background-startup step in first-run setup
- **THEN** launch at sign-in is selected by default, the minimized behavior is explained, and the operating-system registration is created only when the user finishes setup with the selection enabled

#### Scenario: User skips first-run setup

- **WHEN** a user skips or dismisses first-run setup without accepting its settings
- **THEN** Basebuild does not create a new Windows autostart registration as a side effect of the skipped flow

#### Scenario: User changes the setting later

- **WHEN** the user enables or disables launch at sign-in in Settings
- **THEN** Basebuild updates the Windows autostart registration, reads back the effective state, persists it, and shows any registration failure without claiming success

#### Scenario: Unsupported platform

- **WHEN** Basebuild runs on a platform that does not support the Windows launch-at-sign-in integration
- **THEN** the setting is reported as unavailable and no platform-specific registration command is attempted

### Requirement: Autostart launches remain in the tray

A Windows autostart invocation SHALL start the Basebuild process and its background services without showing, focusing, or flashing the main window. The existing tray menu and a subsequent explicit invocation SHALL still make the main window visible and focused.

#### Scenario: Windows starts Basebuild automatically

- **WHEN** Windows invokes the registered autostart entry with the dedicated background-start argument
- **THEN** Basebuild initializes the tray, updater, usage scheduler, and other non-interactive services while the main window remains hidden/minimized

#### Scenario: User launches Basebuild explicitly

- **WHEN** the user launches Basebuild from the Start menu, Explorer, a supported protocol, or another explicit foreground entry point
- **THEN** the main window is shown and focused even if launch at sign-in is enabled

#### Scenario: Explicit second instance activates the running app

- **WHEN** a hidden background instance is already running and the user explicitly launches Basebuild again
- **THEN** single-instance handling shows and focuses the existing main window instead of creating a duplicate process

#### Scenario: Tray show action activates the app

- **WHEN** the user chooses `Show Basebuild` from the tray menu
- **THEN** the existing main window is restored, shown, and focused

### Requirement: Autostart state is upgrade-safe and observable

Basebuild SHALL reconcile its persisted launch preference with the effective Windows registration on startup and after app updates. Reconciliation SHALL be idempotent, SHALL NOT create duplicate startup entries, and SHALL expose a compact status suitable for Settings and diagnostics.

#### Scenario: Enabled registration is missing after an upgrade

- **WHEN** launch at sign-in is enabled but the effective Windows registration is absent or points to an obsolete executable after an app upgrade
- **THEN** Basebuild repairs the registration once, verifies the result, and records a diagnostic outcome without opening the main window

#### Scenario: Registration exists after the preference was disabled

- **WHEN** the persisted preference is disabled but a stale Basebuild autostart entry remains
- **THEN** Basebuild removes the stale entry and reports the effective state as disabled

#### Scenario: Reconciliation fails

- **WHEN** Windows denies or otherwise fails an autostart registration change
- **THEN** Basebuild keeps running, reports the persisted and effective states separately, and offers a retry path without repeatedly retrying in a tight loop
