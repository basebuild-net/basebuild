# main-thread-hygiene Specification

## Requirements

### Requirement: Heavy commands off the main thread
Commands performing network I/O, subprocess execution, or unbounded file I/O SHALL NOT execute that work synchronously on the main thread: they run as async commands with blocking work delegated to `spawn_blocking` or dedicated worker threads. `native_chat_send` SHALL return an acknowledgment immediately; streaming, persistence, and completion flow exclusively through events.

#### Scenario: UI responsive during chat turn
- **WHEN** a native chat turn streams for 60 seconds
- **THEN** the window keeps processing input (tabs switch, panels scroll) for the entire turn and chunks render as they arrive

#### Scenario: Send returns before completion
- **WHEN** the frontend invokes `native_chat_send`
- **THEN** the command resolves promptly with a turn handle, and a completion event later carries the final result or error

#### Scenario: Git commands do not stutter the shell
- **WHEN** git status/diff runs on a large repository
- **THEN** the main thread is not blocked while the subprocess executes

### Requirement: Outbound timeouts everywhere
Every outbound operation SHALL have a timeout: provider HTTP connect and stream-idle timeouts, git subprocess wall-clock timeout, omp subprocess wall-clock timeout. Timeout expiry SHALL produce a typed error naming the operation and configured limit, never a silent hang.

#### Scenario: Stalled provider stream
- **WHEN** a provider stops sending SSE data mid-turn beyond the stream-idle timeout
- **THEN** the turn fails with a timeout error surfaced in the transcript, and the app remains responsive throughout

#### Scenario: Hung git subprocess
- **WHEN** a git invocation exceeds its timeout
- **THEN** the process is killed, the command returns a timeout error naming git and the limit, and no zombie process remains

### Requirement: Command duration telemetry
Every Tauri command invocation SHALL record name, start time, and duration into a bounded in-memory ring buffer. Sync-on-main-thread commands exceeding a violation threshold (default 50ms) SHALL be logged as violations. The DebugPanel SHALL display recent slowest commands and violations.

#### Scenario: Slow sync command flagged
- **WHEN** a sync command takes 400ms
- **THEN** a violation entry with command name and duration is recorded and visible in the DebugPanel

#### Scenario: Telemetry bounded
- **WHEN** thousands of commands execute over a long session
- **THEN** telemetry memory stays bounded by the ring buffer size and never grows unbounded
