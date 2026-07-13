## MODIFIED Requirements

### Requirement: Opt-in, signed-in account sync

Periodic account usage sync SHALL be disabled until the user is signed in to their basebuild.net account, explicitly enables auto-sync, and grants the `allowUsageAnalyticsUpload` permission. The enable toggle SHALL be available only while signed in. Enabling Windows launch at sign-in SHALL NOT imply consent to collect or upload usage.

#### Scenario: Fresh install does not sync

- **WHEN** the app starts on a fresh install with no account signed in
- **THEN** no account sync runs, no network request is made to basebuild.net, and the auto-sync toggle is presented as off and unavailable until sign-in

#### Scenario: Auto-sync requires explicit enable

- **WHEN** the user is signed in but has not enabled auto-sync or analytics upload permission
- **THEN** periodic sync does not run and Settings explains which gate is still required

#### Scenario: Background startup does not bypass consent

- **WHEN** Basebuild starts hidden through Windows autostart while one or more sync gates are not satisfied
- **THEN** the usage scheduler performs no upload and does not prompt by opening or focusing the main window

#### Scenario: Sign-out stops sync

- **WHEN** auto-sync is enabled and the user signs out
- **THEN** the periodic loop stops and no further sync requests are made until sign-in and re-enable

### Requirement: Hourly plus event-driven sync cadence

When all sync gates pass, the system SHALL push newly observed usage from every supported local usage source to basebuild.net on an interval cadence (default 60 minutes, `autoSyncIntervalMinutes`) and on opportunistic triggers: the app UI window closing/hiding while the process stays alive, an impending system shutdown/sleep, network reachability transitioning from offline to online, and system resume. Every trigger SHALL pass the same consent gates, persisted due-time check, and single-flight coordinator before collecting or pushing.

#### Scenario: Interval tick pushes when due

- **WHEN** the interval elapses and the last successful sync is older than `autoSyncIntervalMinutes` or `get_my_live_usage` reports `isStale = true`
- **THEN** the system collects unsynced rows from all available registered usage sources and performs one account usage push with the native token

#### Scenario: Hidden background process remains scheduled

- **WHEN** Basebuild is running in the tray with its main window hidden or minimized
- **THEN** the backend scheduler continues evaluating the hourly cadence without depending on renderer focus, animation timers, or a visible window

#### Scenario: UI hidden triggers a sync

- **WHEN** the app window is closed or hidden while the process keeps running and the gates plus due-time check pass
- **THEN** a sync push is performed opportunistically before the app goes idle

#### Scenario: Impending shutdown or sleep triggers a sync

- **WHEN** the OS signals that the machine is about to shut down or sleep and the gates pass
- **THEN** the system attempts a bounded best-effort sync so shutdown is not delayed indefinitely

#### Scenario: Network reconnect or system resume triggers a re-check

- **WHEN** network reachability transitions from offline to online or the machine resumes after missing one or more intervals
- **THEN** the system re-checks the persisted schedule and pushes once if due rather than replaying one request per missed interval

#### Scenario: Fresh data skips the push

- **WHEN** a trigger fires but no source has unsynced usage and the last successful sync is within the interval and server data is fresh
- **THEN** no account usage push is made

#### Scenario: Concurrent triggers coalesce

- **WHEN** interval, window, resume, or reconnect triggers arrive while a sync attempt is already running
- **THEN** at most one additional due re-check is coalesced and no overlapping upload is started

### Requirement: Usage-only payload

Account sync SHALL transmit only normalized usage records and summaries derived from supported local usage ledgers. Each record SHALL identify its source kind and stable deduplication key and MAY include provider, model, plan or subscription identifiers, token counts, cache counts, timings, outcome, and cost. It SHALL NOT include prompt text, response text, reasoning text, source code, terminal output, tool arguments or results, secrets, credentials, environment values, or raw absolute paths.

#### Scenario: OMP usage is normalized

- **WHEN** OMP stats or usage ledgers contain rows newer than the source checkpoint
- **THEN** the payload contains normalized OMP usage records with source identity and stable deduplication keys while preserving server-compatible OMP totals during migration

#### Scenario: Native chat usage is normalized

- **WHEN** the Basebuild Native metrics ledger contains completed request rows newer than the source checkpoint
- **THEN** the payload contains provider/model usage metrics and request outcome without chat content, tool content, credentials, or project paths

#### Scenario: No prompt, source, or tool content is uploaded

- **WHEN** a multi-source sync push is assembled
- **THEN** payload validation rejects any field outside the explicit usage schema before transport

### Requirement: Non-blocking, non-storming failure handling

Sync and projected-usage calls SHALL be non-blocking and MUST NOT interrupt the user's workflow. The scheduler SHALL persist the last successful sync and per-source checkpoints, allow only one in-flight sync, apply bounded exponential backoff with jitter after transient failures, and surface compact diagnostics without opening a hidden window. A failed source SHALL NOT discard another source's successfully acknowledged checkpoint.

#### Scenario: Network failure does not block or storm

- **WHEN** a sync fails because basebuild.net is unreachable
- **THEN** the app continues normally, schedules a bounded backoff, preserves unsynced source rows, and shows a non-blocking failure status that clears on the next successful sync

#### Scenario: App restarts during backoff

- **WHEN** Basebuild restarts before a scheduled retry time
- **THEN** the backend restores the persisted schedule and does not reset into an immediate retry loop

#### Scenario: One usage source is unavailable

- **WHEN** OMP is missing, an OMP ledger is temporarily unreadable, or another registered usage source fails collection
- **THEN** the attempt records source-specific diagnostics, continues with other available sources, and leaves the failed source checkpoint unchanged

#### Scenario: Server rejects the new payload version

- **WHEN** basebuild.net does not yet accept the normalized multi-source payload
- **THEN** Basebuild preserves unsynced native rows, does not falsely advance their checkpoint, and retains the compatible OMP upload path without retry-storming

## ADDED Requirements

### Requirement: Registered multi-source usage collection

Account sync SHALL collect usage through a typed registry of local read-only sources rather than assuming every activity originates from an OMP process started by Basebuild. The initial sources SHALL be OMP's persisted usage ledgers and Basebuild Native's request-metrics ledger. Additional sources MAY be registered only when they expose the same privacy-reviewed usage contract.

#### Scenario: OMP runs outside Basebuild

- **WHEN** the user runs OMP independently while Basebuild remains open in the tray
- **THEN** the next due sync reads newly persisted OMP usage from its documented ledger or JSON commands without attaching to, controlling, or modifying the OMP process

#### Scenario: Native chat runs inside Basebuild

- **WHEN** a Basebuild Native request completes while auto-sync is enabled
- **THEN** its locally recorded usage metrics become eligible for the next due sync without requiring OMP to be installed

#### Scenario: Both sources report usage

- **WHEN** OMP and Basebuild Native both contain new usage in the same interval
- **THEN** one coordinated upload includes both source groups and advances each checkpoint only after the server acknowledges that group

#### Scenario: Unregistered activity is not inspected

- **WHEN** another application or CLI has no privacy-reviewed registered usage source
- **THEN** Basebuild does not inspect arbitrary processes, files, network traffic, prompts, or terminal content in an attempt to infer usage
