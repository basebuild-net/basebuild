# sqlite-robustness Specification

## Requirements

### Requirement: WAL and busy timeout
Every SQLite connection SHALL enable WAL journal mode and a busy timeout (default 5s) at open. Concurrent readers and a writer SHALL NOT produce spurious `database is locked` failures under normal operation.

#### Scenario: Concurrent writer threads
- **WHEN** the UI, a telemetry thread, and a pipeline worker write within the same second
- **THEN** all writes succeed (serialized by busy-wait) with no locked errors surfaced to the user

#### Scenario: Pragmas applied on every path
- **WHEN** any service obtains a connection through `StorageService::connect`
- **THEN** WAL and busy_timeout are in effect for that connection

### Requirement: Contention diagnostics
Database operations that block longer than a threshold (default 250ms) on busy-wait SHALL be recorded in command telemetry, so lock contention is visible in the DebugPanel instead of manifesting as mystery slowness.

#### Scenario: Contended write visible
- **WHEN** a write waits 800ms on the busy handler
- **THEN** a contention entry with the calling command name appears in telemetry
