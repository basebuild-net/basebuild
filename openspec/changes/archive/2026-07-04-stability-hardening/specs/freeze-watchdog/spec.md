## ADDED Requirements

### Requirement: Main-thread liveness monitoring
A watchdog thread SHALL measure main-thread responsiveness continuously (heartbeat roundtrip through the main thread). When the main thread is unresponsive beyond the report threshold (default 10s), the watchdog SHALL write a freeze report to disk containing timestamp, unresponsive duration, the most recent command telemetry entries (including any command still running), uptime, and app version. Report writing SHALL NOT require the main thread or any lock the main thread might hold.

#### Scenario: Freeze produces a report
- **WHEN** the main thread blocks for longer than the report threshold
- **THEN** a freeze report file exists on disk naming the in-flight command(s), written while the app was still frozen

#### Scenario: No false positive under normal load
- **WHEN** the app runs normally with heavy streaming and terminal output
- **THEN** no freeze reports are generated

### Requirement: Hang-to-crash escalation
When unresponsiveness exceeds the abort threshold (default 60s, configurable, enabled by default), the watchdog SHALL write a final freeze report and abort the process so the hang becomes a diagnosable crash. Disabling escalation in settings keeps report-only behavior.

#### Scenario: Indefinite hang becomes crash
- **WHEN** the main thread remains blocked past the abort threshold
- **THEN** the process terminates abnormally, the freeze report references the abort, and the next launch surfaces the report

#### Scenario: Escalation disabled
- **WHEN** the user disables abort-on-freeze
- **THEN** prolonged hangs produce periodic reports but the process is never watchdog-terminated

### Requirement: Post-freeze surfacing
On the next launch after a freeze report or watchdog abort, the app SHALL surface the report non-blockingly (DebugPanel badge or notice) with the report available for review and issue filing.

#### Scenario: Next launch shows freeze evidence
- **WHEN** the app starts after a watchdog abort
- **THEN** the user sees a notice that a freeze was detected, linking to the report in the DebugPanel
