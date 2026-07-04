# core-tool-runtime Specification

## Requirements

### Requirement: Core tool set
The runtime SHALL expose these tools to the model with JSON-schema parameter definitions: `read_file` (path, optional line range), `write_file` (path, content), `edit_file` (path, exact old text, new text, expected occurrence count), `list_files` (glob pattern), `search_files` (regex, optional path scope), and `run_command` (command line, optional cwd within workspace, optional timeout).

#### Scenario: Edit with exact-match validation
- **WHEN** the model calls `edit_file` and the old text matches a different number of occurrences than expected
- **THEN** the edit is rejected with a descriptive error result (found vs expected counts) and no file modification occurs

#### Scenario: Read with range
- **WHEN** the model calls `read_file` with a line range on a large file
- **THEN** only the requested range is returned with line numbers, and oversized unranged reads are truncated with an explicit truncation marker

### Requirement: Workspace scoping
All file tools SHALL canonicalize paths and reject any path resolving outside the project workspace (symlink escapes included). `run_command` SHALL execute with cwd inside the workspace. Escape attempts SHALL return an error result to the model and record a `denied` audit event, never silently succeed.

#### Scenario: Path escape rejected
- **WHEN** the model calls `write_file` with `..\..\outside.txt` or a symlink pointing outside the workspace
- **THEN** the call fails with a scoping error, nothing is written, and the denial is auditable

### Requirement: Headless supervised commands
`run_command` SHALL run as a supervised child process (no PTY requirement): captured stdout/stderr (interleaved, size-capped), exit code, configurable timeout (default 120s) with kill-on-timeout, and kill-on-cancel. Command output SHALL stream to the transcript while running.

#### Scenario: Timeout kills the process tree
- **WHEN** a command exceeds its timeout
- **THEN** the process tree is terminated, the result reports the timeout with partial output, and the loop continues with that error result

#### Scenario: Cancel kills the command
- **WHEN** the user cancels the run while a command executes
- **THEN** the process tree is terminated and a `cancelled` event is recorded

### Requirement: Tool results as structured events
Every executed call SHALL persist a `native_tool_events` row with kind, arguments summary, status (`approved`/`denied`/`succeeded`/`failed`/`cancelled`), result summary, and timing, linked to session and message.

#### Scenario: Audit trail
- **WHEN** a loop performs five tool calls
- **THEN** five tool events exist with correct linkage and statuses, queryable per session
