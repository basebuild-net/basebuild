## ADDED Requirements

### Requirement: Native MCP sync without API keys
Basebuild Desktop SHALL sync local OMP usage to basebuild.net through the hosted MCP endpoint using the stored native token, not a user-created API key.

#### Scenario: logged-in sync
- **WHEN** a logged-in user clicks Sync usage or an allowed automatic sync trigger runs
- **THEN** the app collects `omp stats --json` and `omp usage --json` through the existing Tauri OMP commands
- **AND** sends a JSON-RPC `tools/call` request for `sync_raw_usage` to the website `/api/mcp` endpoint with `Authorization: Bearer <native token>`.

#### Scenario: sync succeeds
- **WHEN** the MCP response returns success
- **THEN** the app records and displays the sync timestamp, synced blob/tool summary, and any non-fatal warnings.

#### Scenario: guest sync attempt
- **WHEN** a guest user clicks a native MCP sync action
- **THEN** the app prompts them to sign in through the browser device flow
- **AND** does not ask for or display an API key field.

### Requirement: Native MCP status
Basebuild Desktop SHALL surface enough sync/account status to explain what happened without exposing secrets.

#### Scenario: usage data unavailable
- **WHEN** `omp stats --json` or `omp usage --json` fails because OMP is unavailable or unauthenticated
- **THEN** the app displays the existing OMP error message and does not call `/api/mcp` with partial misleading data unless at least one valid raw payload is available.

#### Scenario: native token unauthorized
- **WHEN** `/api/mcp` returns an auth error for the native token
- **THEN** the app clears local token material, switches to guest state, and offers Sign in again.

#### Scenario: MCP warning response
- **WHEN** `sync_raw_usage` returns warnings or skipped rows
- **THEN** the app shows those warnings in a compact details area while still marking the sync request as completed.

### Requirement: Token privacy
Basebuild Desktop SHALL NOT expose native token plaintext in UI, logs, terminal output, or plan context.

#### Scenario: account details rendered
- **WHEN** the user opens Settings > Account
- **THEN** the UI may show token prefix, expiry, scopes, and last sync
- **AND** it never shows the full native bearer token.
