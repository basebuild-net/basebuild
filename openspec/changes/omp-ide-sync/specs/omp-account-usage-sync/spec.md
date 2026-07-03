## ADDED Requirements

### Requirement: Opt-in, signed-in account sync

Periodic account usage sync SHALL be disabled by default and SHALL run only when the user is
signed in to their basebuild.net account AND has explicitly enabled auto-sync. The enable
toggle SHALL be available only while signed in, and account sync SHALL additionally require the
`allowUsageAnalyticsUpload` permission because it transmits usage data to a remote endpoint.

#### Scenario: Fresh install does not sync

- **WHEN** the app starts on a fresh install with no account signed in
- **THEN** no account sync runs, no network request is made to basebuild.net, and the auto-sync toggle is presented as off and unavailable until sign-in

#### Scenario: Auto-sync requires explicit enable

- **WHEN** the user is signed in but has not enabled auto-sync
- **THEN** periodic sync does not run; manual `sync_raw_usage_native` remains available on demand

#### Scenario: Sign-out stops sync

- **WHEN** auto-sync is enabled and the user signs out
- **THEN** the periodic loop stops and no further sync requests are made until sign-in and re-enable

### Requirement: Hourly plus event-driven sync cadence

When enabled and signed in, the system SHALL push compiled OMP usage to basebuild.net on an
interval cadence (default 60 minutes, `autoSyncIntervalMinutes`) AND on opportunistic triggers:
the app UI window closing/hiding while the process stays alive, an impending system
shutdown/sleep, and network reachability transitioning from offline to online. Because the
payload is small (aggregated usage only), these extra triggers are permitted. Every trigger
SHALL pass the same gates (signed in AND auto-sync enabled AND upload permission) and the same
freshness check before pushing.

#### Scenario: Interval tick pushes when due

- **WHEN** the interval elapses, the last local sync is older than `autoSyncIntervalMinutes`, or `get_my_live_usage` reports `isStale = true`
- **THEN** the system collects `omp stats --json` + `omp usage --json` and calls `sync_raw_usage` with the native token

#### Scenario: UI hidden triggers a sync

- **WHEN** the app window is closed or hidden while the process keeps running and the gates + freshness check pass
- **THEN** a sync push is performed opportunistically before the app goes idle

#### Scenario: Impending shutdown or sleep triggers a sync

- **WHEN** the OS signals that the machine is about to shut down or sleep and the gates pass
- **THEN** the system attempts a best-effort sync push so the account reflects the latest usage before the machine goes down

#### Scenario: Network reconnect triggers a re-check

- **WHEN** network reachability transitions from offline to online and the gates pass
- **THEN** the system re-checks freshness and pushes if the account data is stale, catching up work missed while offline

#### Scenario: Fresh data skips the push

- **WHEN** a trigger fires but the last local sync is within the interval and `get_my_live_usage` reports the data is fresh
- **THEN** no `sync_raw_usage` push is made

### Requirement: Native-token transport for all account calls

All account reads and writes SHALL use the stored native `bb_app_` token as an
`Authorization: Bearer` credential against `POST /api/mcp` (JSON-RPC 2.0 `tools/call`). The
system SHALL NOT prompt for or store a user-managed API key, and SHALL NOT depend on the
API-key-only `/api/mcp/personal/usage-context` anchor. On an unauthorized response the system
SHALL clear the stored token and surface a re-sign-in prompt.

#### Scenario: Sync uses the native token

- **WHEN** a periodic or manual sync runs while signed in
- **THEN** the request is sent to `POST /api/mcp` with the native token as a Bearer credential and no API key is requested from the user

#### Scenario: Revoked token clears auth

- **WHEN** basebuild.net returns 401/unauthorized for a sync or projected-usage call
- **THEN** the stored token is cleared, the periodic loop stops, and the UI shows a re-sign-in prompt

### Requirement: Projected usage on the Account page

When signed in, the system SHALL retrieve the account's projected provider usage via the MCP
usage tools — at minimum `get_my_live_usage` (per provider/window utilization, severity,
`resetsAt`, staleness) and `get_my_usage` (per provider/model requests/day, hours/day,
cost/day) — and MAY additionally use `list_my_plans` and `get_my_plan_timeline`. The projected
usage SHALL be displayed on the Account page. Displayed values SHALL carry their freshness, and
a value the server marks stale SHALL be shown as stale, not as current. This display is a
secondary convenience; the sync push to basebuild.net is the primary function.

#### Scenario: Projected usage rendered on the Account page

- **WHEN** the user opens the Account page while signed in and a projected-usage fetch succeeds
- **THEN** the Account page shows per-provider window utilization (used/remaining, resets-at, severity) and per-model requests/day and hours/day, each labeled with its freshness

#### Scenario: Server-stale value shown as stale

- **WHEN** `get_my_live_usage` returns a value with `isStale = true`
- **THEN** the Account page renders that value in a stale/dimmed state with its `fetchedAgoMin` rather than presenting it as live

### Requirement: Usage-only payload

Account sync SHALL transmit only the verbatim `omp stats --json` / `omp usage --json` usage
blobs (usage metrics, model/provider/plan identifiers, timings, costs). It SHALL NOT include
prompt text, response text, source code, terminal output, secrets, or raw absolute paths.

#### Scenario: No prompt or source content is uploaded

- **WHEN** a sync push is assembled
- **THEN** the payload contains only the usage/stats blobs and carries no prompt, response, source, terminal, secret, or absolute-path content

### Requirement: Non-blocking, non-storming failure handling

Sync and projected-usage calls SHALL be non-blocking and MUST NOT interrupt the user's workflow
on failure. On a transient failure the system SHALL back off and retry on a later trigger rather
than retry-storming, and SHALL surface a compact, dismissible status instead of a blocking error.

#### Scenario: Network failure does not block or storm

- **WHEN** a sync fails because basebuild.net is unreachable
- **THEN** the app continues normally, no repeated immediate retries occur, and the failure is surfaced as a non-blocking status that clears on the next successful sync
