# crash-reporting Specification

## Requirements

### Requirement: Deadlock-free persisted panic reports
The panic hook SHALL write a crash report file (message, location, backtrace, app version, OS) to the crash-reports directory before any event emission, using no blocking lock acquisitions (`try_lock` only, skip-on-contention). Report persistence SHALL succeed even when the webview is dead or the main thread is deadlocked.

#### Scenario: Panic while APP_HANDLE lock held
- **WHEN** a panic occurs on a thread currently holding the app-handle mutex
- **THEN** the crash file is still written and the process does not deadlock inside the panic hook

#### Scenario: Panic with dead webview
- **WHEN** a backend panic occurs while the webview is unavailable
- **THEN** the crash report file exists on disk and is surfaced on next launch

### Requirement: Renderer crash detection
The system SHALL detect renderer/webview process termination (black-screen crash), record a renderer-crash report, and offer relaunch of the window without restarting the backend.

#### Scenario: Webview process dies
- **WHEN** the webview process terminates abnormally
- **THEN** a renderer-crash report is written and the user is offered a window relaunch; accepting restores the workspace without losing backend state

### Requirement: Report browser and user-triggered filing
The DebugPanel SHALL list crash, freeze, and renderer-crash reports (newest first) with full content view, delete, and a "file GitHub issue" action that opens a prefilled issue in the browser. Reports SHALL never upload automatically; retention SHALL be bounded (default: last 50 reports).

#### Scenario: Browse and file
- **WHEN** the user opens the DebugPanel after a crash
- **THEN** the report appears with its backtrace, and the file-issue action opens the browser with title/body prefilled from the report — nothing is sent without that explicit action

#### Scenario: Retention bound
- **WHEN** more than the retention limit of reports accumulate
- **THEN** oldest reports are pruned automatically
