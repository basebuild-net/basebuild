## MODIFIED Requirements

### Requirement: Startup Update Splash

Basebuild SHALL perform the signed update check during every packaged Windows startup. A foreground startup SHALL show the startup update splash before the main shell becomes interactive; a Windows autostart invocation SHALL run the same check without showing or focusing the hidden main window.

#### Scenario: Foreground splash shows current build version while checking

- **WHEN** a packaged Basebuild build starts from an explicit foreground launch
- **THEN** the splash shows the current build version and a `Checking for updates` state before presenting the main shell

#### Scenario: No update continues quickly

- **WHEN** the update check completes and the signed update manifest contains no newer version
- **THEN** a foreground launch transitions to the main app and a background launch remains in the tray without requiring user action

#### Scenario: Background startup checks without surfacing the window

- **WHEN** Windows launches Basebuild through the registered background-start entry
- **THEN** the updater checks the signed release channel without showing, focusing, or flashing the main window

#### Scenario: Optional update found during background startup

- **WHEN** a background startup check finds an optional update
- **THEN** Basebuild records the existing update-available state for tray and in-app presentation and does not force the main window open

#### Scenario: Mandatory update found during background startup

- **WHEN** a background startup check finds that the running build is below the minimum supported version
- **THEN** Basebuild follows the mandatory signed-update policy without exposing an unsupported interactive shell and surfaces progress or recoverable failure through tray-visible state

#### Scenario: Update channel diagnostics remain visible

- **WHEN** the startup update check fails because the update endpoint is unreachable, malformed, missing a platform entry, or signature-invalid
- **THEN** a foreground launch shows an actionable diagnostic with retry, while a background launch records the same diagnostic without crashing or opening the window so it is visible when the user next opens Basebuild
