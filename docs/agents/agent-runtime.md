# Agent Runtime

Basebuild wraps terminal-based coding tools. The primary agent is OhMyPi (OMP).
The architecture supports future adapters (Basebuild CLI, other CLIs, IDEs)
without changing the chat UI contract.

## Runtime profiles

Agent and terminal integrations are modeled as **runtime profiles**, not
hardcoded UI branches. Profiles are persisted in SQLite and validated before
use. The default chat profile is `basebuild-native`, which runs Basebuild's
first-party local harness; OMP remains a selectable chat profile.

- `RuntimeProfile` defines: `id`, `kind` (chat/terminal), `label`, `executable`,
  `args`, `workingDirectoryMode`, `defaultModel`, `capabilities`, `builtIn`.
- Built-in profiles: Basebuild Native (chat, default), OMP (chat), Default Terminal (platform shell).
- The Basebuild Native profile runs structured chat sessions, persists messages/tool events/approvals, and records per-request metrics locally without requiring an external CLI.
- Because the native harness runs **in-process** (no external binary), its adapter
  health is always reported available. Default-adapter selection is health-aware:
  `get_defaults` never activates a chat adapter that reports unavailable and falls
  back to the first available adapter (preferring the internal harness). External
  adapters (e.g. OMP) are probed on `PATH`.

## Capabilities

`AgentCapability` enum: `chat`, `messages`, `skills`, `providers`, `commands`,
`info`. The chat UI degrades gracefully when an adapter does not support a
capability. Unsupported capabilities return a typed error, not a crash.

## Native request metrics

The native harness records an OMP-stats-style local ledger row per request:
provider, model, effort level, started/completed timestamps, duration, TTFT, TTLT,
input/output/cache tokens, tokens-per-second, cost, outcome, and error class.
Prompt text, response text, source code, terminal output, secrets, and raw absolute
paths are never stored. The ledger is queryable locally even when analytics
collection/upload remain disabled.

## Provider and model catalog

Native chat exposes providers (Basebuild Local, OpenAI, Anthropic, Umans),
models, effort levels, sync freshness, and source metadata through typed backend
commands. Provider credentials are stored locally only and never uploaded.
`native_provider_catalog` returns the cache-first catalog; `native_provider_catalog_refresh`
forces online sync for one provider or all providers. Direct provider/CLI model
payloads are preferred, OpenAI-compatible providers use `/v1/models` when
available, and the optional hosted Basebuild model directory is queried only
when direct discovery is unavailable and without secrets, prompts, project
paths, or local account identifiers.

## Provider-backed turn execution

Each chat turn is dispatched to the provider/model selected for that turn via the
`ProviderClient` trait (`src-tauri/src/services/provider_client.rs`):

- `LocalCoordinator` — explicit, clearly-labeled **offline** fallback. Its turns
  are tagged "Offline" in the UI and never presented as provider answers.
- `OpenAiCompatibleClient` — OpenAI and Umans (OpenAI-compatible base URL).
- `AnthropicClient` — Anthropic Messages API.

Assistant output streams incrementally to the UI over the `native-chat://chunk`
event channel and is appended live. Metrics (TTFT, total latency, input/output
tokens) are captured from the real request. When the chosen provider has no
stored credential, `send_message` returns a typed `SetupRequired` result (not an
error) so the composer renders an inline connect prompt **without discarding the
drafted message**.

## Provider web login

Providers can be connected through a web/loopback flow in addition to manual
API-key entry (`src-tauri/src/services/provider_login_service.rs`):

- `native_provider_login_start(provider_id)` binds an ephemeral `127.0.0.1` port,
  opens a loopback landing page in the system browser (linking to the provider's
  key page), and captures the credential via an HTTP POST to localhost.
- The secret is never placed in a URL query string and never logged; it is
  persisted only through the local credential store.
- `native_provider_login_poll` / `native_provider_login_cancel` drive the UI.
- Disconnect removes the stored credential and returns the provider to
  setup-required; the catalog refreshes without an app restart.

## Chat slash commands

The composer intercepts recognized slash commands before provider send:

- `/login` opens the provider chooser; `/login <provider>` preselects a matching
  provider and opens its connection UI.
- `/model` opens the searchable model picker; `/model <filter>` pre-filters by
  provider id, model id, or label.
- `/models refresh` forces provider model-catalog sync and reports the result in
  the composer.

Unknown slash commands remain local and offer an explicit "send as text" escape.
Slash commands are accelerators only; provider/model UI remains visible next to
the effort selector.

## In-chat idea generation

`native_generate_ideas` sends the conversation plus the project schematic to a
**configured** provider and parses the structured JSON result into Idea records
(persisted via the existing ideas store). The offline local coordinator does not
fabricate ideas — with no configured provider the command returns a setup prompt.
Generated ideas render inline in the composer and can be promoted into the
existing plan pipeline, tagged with the originating chat session (`chat:<id>`).

## Defaults

`RuntimeDefaults` (persisted in SQLite):
- `defaultChatProfileId` — default: `basebuild-native`.
- `defaultTerminalProfileId` — default: platform shell.
- `defaultModel` — model selection if the adapter supports it.
- `autoSendGeneratedPrompts` — whether to auto-send drafted prompts (default: `false`).

## Permissions

`PermissionRules` (persisted in SQLite, conservative by default):
- `allowCommandExecution`: ask / allow / deny.
- `allowExternalContext`: ask / allow / deny.
- `allowFileModification`: ask / allow / deny.
- `allowUsageAnalyticsCollection`: default `false`.
- `allowUsageAnalyticsUpload`: default `false`.
- `allowDetailedDiagnostics`: default `false`.

Permission checks happen before backend action, not only in UI. All permission
decisions are recorded in the audit trail.

## Privacy and analytics

**Analytics are disabled until explicit opt-in.** This is non-negotiable.

- Local collection and remote upload are separate permissions.
- Fresh install: collection off, upload off.
- No prompt text, chat content, source code, terminal output, secrets, or raw
  absolute paths in analytics events by default.
- Upload toggle is disabled/hidden unless a reviewed endpoint is configured.
- Users can inspect, export, and delete local analytics data.

## No silent side effects

Basebuild does not spawn side effects (commits, PRs, installs, file edits)
unless the user explicitly triggers them through the UI or an approved skill.
When in doubt, ask. The default stance is conservative.

## Respecting underlying tools

Never assume Basebuild owns a project. `git`, `omp`, and editors are the source
of truth; Basebuild persists only project-local metadata in `.basebuild/`.

## OMP session telemetry

When OMP is installed, Basebuild attaches a read-only telemetry channel to the
running OMP session by reading `omp stats --json` + `omp usage --json` (the same
blobs used for account sync). This surfaces per-message provider, plan, model,
and effort/thinking level (when resolvable), per-message metrics (tokens, cost,
TTFT, duration), and live provider window utilization (5h/7d usedFraction,
resetsAt, severity) with explicit freshness markers.

- Telemetry is **read-only**: it never writes to OMP databases or sends commands
  to OMP. It never ingests prompt text, response text, source code, terminal
  output, secrets, or raw absolute paths.
- Live in-memory display is ungated. Local persistence of telemetry metrics is
  gated on `allowUsageAnalyticsCollection`.
- Updates are published over the `omp-telemetry://update` event channel. The
  polling loop starts on app launch and emits a `detached` state when OMP is not
  installed or no session is running.
- OMP's stdio RPC mode (`omp --mode rpc`) is a separate, non-terminal protocol;
  a raw TUI terminal and RPC mode are mutually exclusive on one process. The
  "Oh My Pi" tab runs OMP as a raw PTY terminal; telemetry reads from the
  ledgers. RPC-backed native rendering is an optional future path.

## Account usage sync

Signed-in users can opt in to periodic account usage sync, which pushes compiled
OMP usage to basebuild.net via the MCP `sync_raw_usage` tool using the stored
native `bb_app_` token. The app is a producer; the website computes projected
usage.

- **Off by default.** Requires sign-in + explicit enable + upload permission.
- **Cadence**: hourly interval (default 60 min) plus opportunistic triggers —
  window hide/focus-loss (process alive), impending shutdown/sleep (best-effort),
  and network offline→online. Triggers are debounced behind a freshness check.
- **Freshness-gated**: before pushing, the app checks `get_my_live_usage.isStale`
  / `fetchedAgoMin` and skips if the account data is already fresh.
- **Native token only**: all reads/writes go to `POST /api/mcp` with the native
  token. The API-key-only `/api/mcp/personal/usage-context` anchor is not used.
- **Projected usage** (`get_my_live_usage`, `get_my_usage`, `list_my_plans`,
  `get_my_plan_timeline`) is displayed on the Account page, labeled with
  freshness. Server-stale values are shown as stale, not as current.
- **Usage-only payload**: only aggregated usage stats are sent — no prompts,
  source, secrets, or absolute paths.
- On 401/unauthorized, the stored token is cleared and a re-sign-in prompt is
  emitted via `auth://changed`.
## Hidden process spawning

Non-interactive helper commands (`omp --version`, `omp stats --json`, `git`,
`node --version`, profile validation) are spawned with `CREATE_NO_WINDOW` on
Windows via `crate::services::process_helpers::hidden_command`. This prevents
visible console windows from appearing when Basebuild (a windowed application
with no console) spawns console-subsystem child processes. PTY-backed terminal
and agent spawns use ConPTY, which already passes `CREATE_NO_WINDOW`.

The release binary is built with `windows_subsystem = "windows"` so the
packaged app does not allocate a console window on launch. Debug builds keep
the console visible for panic output and development logging.

## Workspace restore

Basebuild persists per-project workspace state (last session, last tab, side panel
section, sidebar/side collapse, side panel width) and restores it on project open.
Restoring never auto-spawns terminals, agents, or external processes; stale
process-backed tabs show a disconnected state until the user takes action. Side
panel width is resizable via a drag handle and persisted locally.

## Update policy

The release channel can declare update policy fields in the signed
`latest.json` manifest. These fields control the startup splash behavior:

- `minimumSupportedVersion` (or `mandatoryBelow`) — If the running app's
  version is strictly below this value, the update is mandatory: the splash
  hides the skip button and auto-starts the update. Example: a manifest
  declaring `"minimumSupportedVersion": "0.1.2"` forces all versions below
  `0.1.2` to update mandatorily.
- `releaseSummary` — Short user-facing summary shown in the splash. Falls
  back to the standard `notes` field when absent.

Skip-version persistence: when the user skips an optional update for version
`X.Y.Z`, Basebuild stores that version locally and suppresses the startup
prompt for that exact target. A newer release clears the skip implicitly.
Mandatory updates always override any skip.

The no-wizard update flow uses NSIS `passive` install mode (shows only a
progress bar, no wizard dialogs). The Tauri updater plugin verifies the
downloaded payload signature before applying. Progress events are emitted
to the frontend via `updater://progress` events with step, downloaded bytes,
total bytes, and a message.
