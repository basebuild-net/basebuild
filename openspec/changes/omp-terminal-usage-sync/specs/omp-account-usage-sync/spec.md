## MODIFIED Requirements

### Requirement: Opt-in, signed-in account sync

Periodic account usage sync SHALL run only when the user is signed in to
their basebuild.net account. Once the user signs in, auto-sync SHALL
default to ENABLED and the usage-sync permissions
(`allowUsageAnalyticsUpload`, and `allowUsageAnalyticsCollection` for the
local telemetry ledger) SHALL default to granted — signing in is the
consent action for usage sharing, and the sign-in/consent surface SHALL
state that usage stats will sync to basebuild.net. The auto-sync toggle
SHALL remain visible and one click to disable while signed in; disabling
stops the periodic loop immediately. Signed-out users SHALL never sync and
the toggle SHALL be presented as off and unavailable until sign-in.

#### Scenario: Fresh install does not sync

- **WHEN** the app starts on a fresh install with no account signed in
- **THEN** no account sync runs, no network request is made to
  basebuild.net, and the auto-sync toggle is presented as off and
  unavailable until sign-in

#### Scenario: Sign-in enables sync by default

- **WHEN** the user signs in to basebuild.net and takes no further action
- **THEN** the auto-sync checkbox is checked, the upload permission is
  granted, and the next cadence trigger performs a sync without any
  additional toggle-flipping

#### Scenario: One-click opt-out

- **WHEN** a signed-in user unchecks auto-sync
- **THEN** the periodic loop stops immediately, the preference persists
  across restarts, and no further automatic pushes occur until re-enabled

#### Scenario: Sign-out stops sync

- **WHEN** auto-sync is enabled and the user signs out
- **THEN** the periodic loop stops and no further sync requests are made
  until sign-in

## ADDED Requirements

### Requirement: Manual sync bypasses the auto-sync toggle

The manual "Sync now" action SHALL run whenever the user is signed in and
the upload permission is granted, regardless of the auto-sync toggle
state, and SHALL bypass the freshness/staleness skip (a manual click means
"push now").

#### Scenario: Sync now with auto-sync off

- **WHEN** a signed-in user with upload permission clicks "Sync now" while
  auto-sync is disabled
- **THEN** the push runs and its outcome is reported

### Requirement: Every sync attempt reports an outcome

Every sync attempt — manual or automatic — SHALL end in a user-visible
outcome: success (with last-sync timestamp), failure (with error reason),
or blocked (naming the failed gate: not signed in, permission denied, or
auto-sync disabled for periodic runs). A sync trigger MUST NOT silently
return without recording and surfacing why.

#### Scenario: Blocked manual sync names the gate

- **WHEN** the user clicks "Sync now" while the upload permission is
  denied
- **THEN** the UI shows a blocked notice naming the permission (with a
  link/affordance to grant it) instead of doing nothing

#### Scenario: Successful sync updates the status line

- **WHEN** a manual or periodic sync completes successfully
- **THEN** the settings surface shows the new "Last sync" timestamp
  without requiring a modal reopen
