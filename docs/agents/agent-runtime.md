# Agent Runtime

Basebuild is **native-first**: the primary chat runtime is an in-house Rust
agent loop (`agent_loop_service.rs`) that handles provider streaming, tool
calling, approval gates, and ask_user interactions directly. All providers
(OpenAI, Anthropic, Devin, GLM-5.2, etc.) route through this native loop — no
external CLI process is required for chat.

OhMyPi (OMP) is **additive**, never a dependency. Every feature must work
natively without OMP installed; OMP only enhances the experience where present
(terminal panel, plan runner, optional chat profile, credential import,
last-resort sign-in fallback). Native chat never bridges through OMP RPC:
routes with no native transport (bespoke agent api_kinds without a direct
endpoint) are refused with typed setup guidance (`route_requires_omp` in
`native_chat_service.rs`). The architecture supports future adapters
(Basebuild CLI, other CLIs, IDEs) without changing the chat UI contract.

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
When both a Basebuild-saved credential and an OMP-imported credential exist for
the same provider, the Basebuild-saved one takes precedence. OMP credentials
serve as the fallback for providers not configured in Basebuild. Disconnecting a
provider blocks both Basebuild and OMP credentials for that provider until a new
key is saved (which unblocks it).
`native_provider_catalog` returns the cache-first catalog; `native_provider_catalog_refresh`
forces online sync for one provider or all providers. Direct provider/CLI model
payloads are preferred, OpenAI-compatible providers use `/v1/models` when
available, and the optional hosted Basebuild model directory is queried only
when direct discovery is unavailable and without secrets, prompts, project
paths, or local account identifiers.

Provider/model configuration opens from the sticky chat header into one
two-pane modal. A dense provider grid puts configured providers first with
green Connected state; unconfigured providers use grey Available state. The
adjacent searchable model pane stays scoped to the selected provider and shows
capability badges. Models are keyed by both provider id and model id, so
duplicate model ids cannot cross providers. On restore, the chat session's
provider/model/effort wins over the project default. The header effort dropdown
contains only values present in the selected model's `supportedEfforts`; the
textual permission dropdown, run state, branch, and circular context indicator
share that rail. The composer footer contains only the growing input and
send/stop. Until catalog-owned effective transport capabilities land, the UI
also rejects known bespoke transports that cannot participate in the native
tool loop rather than starting a false planning run. Transports that cannot
expose tools produce an explicit capability state before launch; they do not
advertise planning support or start a fake tools-capable run.

## Voice capability metadata

`models.json` records voice capability per model so the UI can tell a realtime
voice route apart from a model that merely accepts an audio attachment. Both
fields are optional and default safely, so the ~200 providers that predate them
keep parsing unchanged.

```jsonc
"input":  ["text", "audio"],          // existing field, vocabulary extended
"output": ["text", "audio"],          // defaults to ["text"]
"voice": {                            // absent means no voice capability recorded
  "level": "realtime",                // none | stt | tts | audio_turn | realtime
  "billing": "api_key",               // api_key | subscription | local
  "transports": ["webrtc", "websocket", "sip"],
  "turnDetection": ["server_vad", "semantic_vad", "none"],
  "bargeIn": true,
  "voices": ["alloy", "cedar", "marin"],
  "sampleRateIn": 24000,
  "sampleRateOut": 24000
}
```

`level` is an ordered ladder, not a boolean, because "supports audio" is the
question everyone asks and the wrong one. A model that takes an audio
attachment in an ordinary request (`audio_turn`) is a different product from
one that holds a duplex session open with server-side endpointing
(`realtime`), and collapsing them makes the catalog useless for choosing a
voice route. `transports` and `turnDetection` reuse OpenAI's and Azure's own
vocabularies verbatim rather than inventing terms; leave `turnDetection` empty
for providers that use a different vocabulary instead of inventing a mapping.

`CatalogModel::voice_level()`, `accepts_audio()` and `emits_audio()` are the
accessors; `NativeModel` carries `supportsAudioInput`, `supportsAudioOutput`
and the full `voice` object through to the UI, persisted in
`native_provider_model_cache` as two integer columns plus `voice_json`. A
malformed `voice_json` degrades that row to no-voice rather than failing the
whole catalog read.

### Only record what a provider documents

Populate `voice` from provider documentation, never from a model id. Inferring
that `gpt-realtime` is realtime because of its name is exactly what makes a
catalog untrustworthy, and the existing `supports_images(id)` heuristic is a
precedent that must not be extended to audio. Discovery paths
(`local_discovered`, `provider_discovered`, `omp_cli`, `hosted_fallback`) set
the two booleans only from genuine modality arrays and always leave `voice`
as `None`. Models with no verified data stay absent, which the schema defines
as "no voice capability recorded", not "no voice capability".

### Realtime voice is not available on a subscription

As of 2026-07 no vendor sells third-party native speech-to-speech on a consumer
subscription. OpenAI Realtime, Gemini Live, xAI Grok Voice and Azure Realtime
all authenticate with an API key and meter per token or per minute; Anthropic
ships no audio endpoint at all. The Codex ChatGPT OAuth credential Basebuild
already holds requests the scope `openid profile email offline_access
api.connectors.read api.connectors.invoke`, which carries no audio or realtime
grant, so it cannot open a realtime session. Codex's RFC 8693 exchange for
`openai-api-key` mints an API key, which is the pay-per-token credential; it
does not make a subscription cover Realtime.

Three tests hold this line. `chatgpt_subscription_route_advertises_no_voice`
asserts every `openai-codex` model stays voice-free, and
`no_model_claims_subscription_backed_realtime_voice` guards the whole catalog
against a sync introducing a `realtime` + `subscription` pair. If either fails,
the claim is a genuine industry first or bad data, and both deserve a human
look before shipping. The `VoiceBilling::Subscription` variant exists so the
catalog can record such a route the day one ships, without a schema change.

The picker states this where a user chooses a model: a realtime model billed by
API key, browsed under a subscription OAuth provider, carries an inline note
that the subscription does not cover it.

## Chat loading and streaming performance

Existing-session messages, tool events, interactions, and the persisted model
identity begin loading without waiting for provider metadata. A single
`native_chat_bootstrap` request resolves one cache-first catalog snapshot and
the project model default; the model chip shows a spinner and keeps the stored
model id visible until that request becomes `ready` or `error`. Permission,
branch/worktree, and global request metadata also load independently. Content
and reasoning fragments accumulate in order and flush to React once per
animation frame, bounding renderer work during high-frequency streams. The
transcript follows output while pinned to the bottom and preserves the reader's
position after an upward scroll.

The context circle uses the latest completed metric for the current session
(`input_tokens + output_tokens`) against the selected model's `contextWindow`.
New sessions display zero usage. Missing model limits remain explicit in the
tooltip; the UI never labels zero as unknown.

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

## Provider sign-in

Provider connection is native-first (`src-tauri/src/services/provider_login_service.rs`):

- **OpenAI Codex (ChatGPT subscription)** signs in natively. The primary flow
  is the standard authorization-code + PKCE browser flow: Basebuild binds the
  registered localhost callback port (1455), opens the system browser at
  `auth.openai.com/oauth/authorize`, validates the CSRF `state` round-trip on
  the callback, exchanges the code itself, and stores the token in the local
  database (refreshed before requests). If the callback port is unavailable,
  the native device-code flow runs instead; only when the account has device
  code authorization disabled AND OMP is installed does the flow fall back to
  OMP as an additive last resort.
- **OMP-owned providers** (Anthropic subscription, etc.) delegate to OMP's
  structured RPC login; credentials remain owned and refreshed by OMP.
- API keys can always be entered manually; the key stays in the local
  credential store and is never placed in a URL or logged.
- `native_provider_login_start` / `poll` / `submit` / `cancel` drive the UI.
  Start and the OMP credential refresh run on blocking tasks so the webview
  never freezes; cancel stops the worker thread and pollers.
- Disconnect removes the stored credential and returns the provider to
  setup-required; the catalog refreshes without an app restart.

## Chat slash commands

The composer intercepts recognized slash commands before provider send. Typing
`/` opens a command palette with a large, filterable list showing command names,
descriptions, source badges, usage hints, and argument helpers. A visible
`Commands` button in the composer rail opens the same palette without typing `/`.
Keyboard: ArrowUp/ArrowDown navigates, Tab completes the selected command into
the composer, Enter submits, Escape closes. Recent commands rank first.

- `/login [provider]` opens the provider chooser; with a provider id/label,
  preselects it and opens its connection UI.
- `/model [query]` opens the searchable model picker; with a filter, pre-filters
  by provider id, model id, or label.
- `/provider [query]` opens the provider picker; with a filter, switches to the
  matching provider with a compatible model fallback.
- `/models refresh` forces provider model-catalog sync and reports the result
  inline.
- `/clear` clears the current chat transcript. Confirms before deleting persisted
  messages; preserves the session and provider/model/effort selection.
- `/new` starts a fresh empty chat for the current project without deleting the
  previous chat.
- `/commands` and `/help` show the complete command reference locally with names,
  descriptions, usage, source labels, and a keyboard guide.
- `/stop` cancels the current running chat request, or reports idle if nothing
  is running.
- `/plan`, `/idea`, `/openspec` execute planning pipeline UI actions.
- `/mcp` shows a notice pointing to Settings for MCP server management.
- `/skill:<name> [args]` injects a skill's content into the conversation.

Unknown slash commands remain local and offer an explicit "send as text" escape.
Slash commands are accelerators only; provider/model UI remains visible next to
the effort selector.

## In-chat idea generation

`native_generate_ideas` runs the bundled `basebuild-planning` skill through the
native agent loop. The destination chat exclusively owns cancellation,
streaming, messages, and tool-event cards; chat-native idea turns do not create
pipeline-run or Background agents entries. The planning session separately owns
categories, rounds, and captured ideas. Before invoking the backend, the chat
waits for its chunk and tool-event subscriptions so immediate provider activity
cannot race ahead of the transcript; remounts recover persisted running
messages and tool events. The visible user turn is a compact
`/skill:basebuild-planning` invocation. The model receives conversation,
schematic, category, and direction context in the internal system prompt, then
must call `propose_ideas` to persist structured output. Disconnected, OMP-only,
and non-tool-capable model routes stop with a capability-specific setup result.

Idea generation is **schematic-grounded** (schematic-grounded-planning):
- Generation system prompts derive from the bundled `basebuild-planning` skill
  content at read time (LazyLock-cached), not hardcoded strings. Planning
  Settings overrides still take precedence.
- Each turn prepends a **focus directive** assembled from the schematic inspect
  report: Vision, End goals, and Current priorities serve first; the Blueprint
  (archetype, team size, stage) constrains scope; missing or stale end goals
  are flagged.
- `propose_ideas` requires a `grounding` field (concrete evidence: real files,
  functions, or observed gaps) per idea. Captures without grounding are
  rejected by the agent loop. An optional `anchor` field names the schematic
  element served (Vision / End goal / Current priority); ideas without an
  anchor are flagged "outside current focus" in the UI.
- Categories are **project-derived** (generated from the schematic's Blueprint,
  Vision, and priorities), not hardcoded seeds. The empty state offers
  "Generate categories from project" and manual add.
- When schematic health is not `complete`, the chat planning menu shows a
  nudge linking to the schematic wizard (soft gate — proceed is allowed).

Ideas can be promoted into the plan pipeline (tagged with the originating chat
session `chat:<id>`) or rejected. Rejected ideas are retained for history but
hidden from the active concept list. The offline local coordinator does not
fabricate ideas — with no configured provider the command returns a setup
prompt. Categories organize ideas and can be managed in the Planning Inspector.

Idea and plan cards can request a local execution assessment. The assessment
combines the work's structured scope, duration, difficulty, uncertainty, risk,
and parallelism with the currently available provider/model routes. The
`ExecutionAdvisorService` applies hard capability/context/capacity gates before
scoring planner and coder candidates. It returns alternatives, exclusions,
factor explanations, evidence freshness, and confidence; a missing or stale
signal lowers confidence and never becomes an invented zero or unlimited
capacity. Recommendations are advisory: the user must explicitly apply or
override a route, and refresh never launches work.

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
- Execution recommendation feedback has separate consent, defaults to `false`,
  and also requires analytics collection before a bounded event can be queued
  and analytics upload before it can leave the device.

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
  polling loop is **opt-in / on-demand**: it is NOT started at app launch
  (starting it there spawned `omp stats/usage` probe processes on every run,
  even with no OMP installed). It starts idempotently when the OMP HUD mounts
  (`useOmpTelemetry` → `omp_telemetry_start`) and emits a `detached` state when
  OMP is not installed or no session is running.
- OMP's stdio RPC mode (`omp --mode rpc`) is a separate, non-terminal protocol;
  a raw TUI terminal and RPC mode are mutually exclusive on one process. The
  "Oh My Pi" tab runs OMP as a raw PTY terminal (its **New panel** option is
  gated on `ompStatus().installed`, so it is offered only when OMP is present);
  telemetry reads from the
  ledgers. RPC-backed native rendering is an optional future path.

## Usage sync

Usage sync has two paths depending on auth mode:

**Signed-in accounts** use `sync_raw_usage` (richer OMP raw payload) via the
stored native `bb_app_` token. The app is a producer; the website computes
projected usage. When OMP is not installed, OMP raw-usage collection is skipped
gracefully (`sync_raw_usage_native` guards on `OmpService::status().installed`),
so a machine without OMP records no sync error; native per-message usage
(`sync_messages_native`) carries attribution.

**Guest/private installations** use the closed aggregate envelope
(`sync_usage_envelope`) via a write-only `bb_guest_` token bootstrapped from
`/api/auth/guest/bootstrap`. The envelope contains only allowlisted aggregate
fields (provider, model, requests, tokens, runtime, cost) — never prompts,
responses, source code, paths, or secrets. OMP counters are delta-diffed
against a persisted baseline and included in the envelope; the raw OMP path
is skipped for guest tokens to avoid duplicate uploads.

### OMP delta collection

OMP cumulative counters are diffed against a persisted baseline in
`usage_source_cursors`. Pending batches are stored before transport and
replayed unchanged on retry until the server acknowledges, preventing
duplicate/loss across restarts. Reset detection: if current < previous,
current is treated as absolute. First collection uses `window_end - 31 days`
(within the server's 31-day window limit); subsequent collections use
`window_end - 1 second`.

### Local harness sources

Each harness reader declares `has_usage_store()`, which drives `available()`.
It MUST mean "there is something here we can actually read", not "the tool
left a directory behind" — OpenCode reported as available for every install
while its reader looked at a path that no longer exists, so the row sat at
"Ready" forever without ever producing a batch.

| Harness | Store | Notes |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | assistant entries; `<synthetic>` model ids are normalized, not dropped |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | rollout files |
| OpenCode | `~/.local/share/opencode/opencode.db` | SQLite `message` table, opened read-only; `storage/message/*.json` is the pre-SQLite fallback |

The OpenCode walk is scoped to `storage/message` and the `message` table —
never the harness root, which also holds `auth.json` and session diffs.

`aggregate_entries` bounds every collect to ONE server-acceptable window,
anchored to the oldest reportable entry and capped at the 31-day span. That
anchoring is the point: a fixed offset chunk that happens to contain no
entries would never advance, and aggregating a multi-year history into a
clamped 31-day window would misreport every counter in it. A backlog drains
one chunk per pass as the checkpoint advances; anything past the 90-day
horizon is unreportable and the checkpoint skips it.

### Sync status

`AutoSyncStatus` reports per-source diagnostics: `off_reason`, `attribution`
(account/guest/private), `overall_outcome` (Success/Partial/Failed/NothingToSync),
and a `sources` map with per-source success/error state.
`coordinated_usage_outcome()` classifies sync results, distinguishing
"skipped" (OMP not installed) from actual work.

The Analytics tab collapses each source to exactly one state and one detail.
Keep it that way — `pending_retry` and `last_error` describe the same
condition, and rendering them as two different labels ("Retry pending" vs
"Needs attention") was pure noise:

| State | Condition | Detail shown |
| --- | --- | --- |
| Not installed | `!available` | `availability_reason`, naming the tool |
| Retrying | `last_error \|\| pending_retry` | the error text |
| Synced | `last_success_at` | relative time ("2 minutes ago") |
| Waiting | available, no data, no error | "No new usage yet" |

Installed sources sort first. `last_processed_at` is server-cron state and is
deliberately not rendered.

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

Basebuild persists per-project workspace state (last session, panel grid
layout, closed panels, sidebar collapse, side panel width) and restores it
on project open. The panel grid state (`PanelGridState`) is a split tree
of panels with split ratios, an active panel id, and a closed-panels
history. Restoring never auto-spawns terminals, agents, or external
processes; stale process-backed tabs show a disconnected state until the
user takes action. Side panel width is resizable via a drag handle and
persisted locally.

## Per-provider concurrency and subagents

Plan runs execute concurrently up to a per-provider max concurrency limit
(`run-concurrency-limits`). The default is `1` per provider (most providers
rate-limit concurrent requests). A global default can be overridden per
project. Runs beyond the limit queue with a visible reason. Subagent
execution is off by default and can be enabled per provider with a
subagent cap. The scheduler is backend-owned and survives panel unmounts.

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

## Native Agent Loop

The native harness includes a backend-owned agent loop (`agent_loop_service.rs`)
that runs on a dedicated thread per turn. When a tools-capable model is selected,
`native_chat_service::send` delegates to `run_agent_turn` instead of a single
provider call.

### Loop lifecycle

1. **Stream**: The provider streams an assistant response. Reasoning and text
   deltas are emitted to the frontend in real time.
2. **Tool calls**: If the provider returns `tool_calls`, the loop collects them
   and resolves each through the approval gateway.
3. **Execute**: Approved tool calls run through the `ToolRuntimeService` —
   read-only calls run in parallel, mutating calls run sequentially.
4. **Append + repeat**: Tool results are appended as `role: "tool"` messages,
   and the loop re-requests the provider. This continues until the model returns
   no tool calls or the iteration cap (25) is reached.

### Cancellation

Each run has a `CancellationToken`. The `native_chat_cancel` command cancels the
active run for a session — aborting the provider stream and killing in-flight
tool processes. On startup, an interrupted-run sweep marks any orphaned runs.

### Mid-run steering

A running turn accepts new user messages. `native_chat_steer(sessionId, content)`
persists the message as a normal user row and hands it to the live loop, which
injects it before its next provider request, so the user redirects the agent
instead of stopping and restarting it. Steers are drained at two points in
`run_loop_inner`: after each tool-result batch, and once more immediately before
the loop would report completion. An accepted steer resets the iteration and
empty-retry budgets, because a fresh human instruction is a new question rather
than a continuation, and each reset requires a real human action so the loop
cannot spin unbounded.

The handoff is race-free by lock order: `push_steer` takes `ACTIVE_RUNS` then
`PENDING_STEERS` and holds both across the enqueue, and the loop's final
`finish_or_steer` takes the same pair in the same order and retires the run
handle only when nothing is pending. A steer therefore either joins the running
turn or is refused, never queued against a run that will not read it. On refusal
the command returns `delivered: false` with no persisted row, and the composer
falls back to a normal send with the draft intact.

While a run is live the composer stays enabled, re-labels itself as a steering
surface, and shows the send control beside stop. Slash commands are excluded
from steering: they remain local UI actions so `/stop` still reaches the run.

### Context budget guard

Before each provider request, the loop estimates tokens (4 chars ≈ 1 token) and
truncates oldest turns first if the conversation exceeds the model's context
window minus an output margin. The system prompt and latest user turn are always
preserved. Oversized tool results are head+tail capped (full output stored locally).

## Agent Activity Timeline

Native and OMP-backed events normalize into ordered **activity items** so the chat
UI can render one timeline for every supported runtime profile.

### Activity item types

Each item has one of the following types:

- `assistant_text` — assistant prose rendered in the transcript.
- `reasoning` — model reasoning/thinking content (often collapsed by default).
- `tool_call` — a tool invocation, its inputs, status, and eventual result.
- `question` — a blocking question posed to the user (e.g. OMP RPC `ask_user`).
- `capture` — a captured artifact or checkpoint surfaced as an activity row.
- `approval` — a pending tool approval gate.
- `notice` — a non-blocking system or runtime notice.
- `error` — a failure that stopped or degraded the run.

### Common fields

Every activity item carries:

- `id` — stable identity for the item within the session.
- `sequence` — ordering index; items render in sequence order when expanded.
- `status` — current lifecycle state of the operation.
- `summary` — short human-readable description shown in collapsed and expanded
  views.
- `startedAt` / `finishedAt` / `updatedAt` — timestamps when available.
- `detail` — optional expandable payload (tool result, error trace, captured
  output, etc.).

### Presentation

- **Ungrouped by default**: the timeline renders a flat chronological list.
  Every tool call, thinking block, question, notice, error, approval, and
  capture is its own row in the order received. No grouping or lumping.
- **Thinking blocks split**: when a tool call, question, or other activity
  interrupts reasoning, the current thinking block closes and later reasoning
  starts a new `ThinkingBlock` row. Thinking is never concatenated with
  assistant text.
- **Loading rows**: streaming, thinking, running tools, waiting for answer,
  queued, blocked, and failed states each show a loading row with both an
  icon and text — never color alone.
- **States**: running, waiting, blocked, and failed states surface the latest
  operation summary, expandable detail, and safe actions such as cancellation
  and retry where the backend allows it.

### Blocking questions and approvals

Pending questions move into the composer-owned `.interaction-workbench`, disable
the normal message input, and visibly block their run. One interaction may have
multiple pages; Next validates the current page and Back preserves answers.
Rating prompts use a keyboard-accessible five-level scale. Exit collapses the
workbench to a compact pending preview without answering; reopening restores the
same page and values. After submission, the transcript keeps a compact answered
summary that can reopen read-only detail. The backend resumes the exact pending
turn once; duplicate or stale answers are ignored.

## Tool Runtime

`ToolRuntimeService` owns the built-in tool registry. The core tools:

| Tool | Kind | Description |
|------|------|-------------|
| `read_file` | ReadOnly | Read file contents with optional range support |
| `write_file` | Mutating | Create or overwrite a file |
| `edit_file` | Mutating | Exact-match string replacement with occurrence validation |
| `list_files` | ReadOnly | Glob-based file listing |
| `search_files` | ReadOnly | Rust regex content search, workspace-scoped |
| `run_command` | Mutating | Supervised child process with timeout and output capping |
| `get_execution_advice` | ReadOnly | Return a bounded local planner/coder route recommendation for one persisted plan or idea |
| `project_status` | ReadOnly | Report Basebuild's own local project state: plans by status, plan runs, captured ideas, and the git branch and working-tree summary |

All file tools enforce workspace scoping: paths are canonicalized and
symlink-resolved before a prefix check against the project root. Denials are
recorded as audit events.

`get_execution_advice` is allowlisted output, not a general planning-data read.
It excludes credentials, account ids, project/source text, paths, messages,
questionnaire answers, raw usage, diffs, and logs. Local UI advice remains
available without external-context permission; returning advice to an external
provider crosses that provider boundary and preserves the
`allowExternalContext` gate.

`project_status` answers "what is planned, running, or outstanding?" from the
local database and repository instead of making the model guess or shell out.
Sections are selectable (`plans`, `runs`, `ideas`, `git`); omitting `sections`
returns all four. Each section degrades to an explicit unavailable line rather
than failing the call, so the model never reads a missing section as "nothing
exists". Absolute paths are never emitted: the project is named by its final
path component, git errors are swallowed because their text can carry paths,
and user-authored titles are collapsed to one bounded line so an embedded
newline cannot forge a section heading.

## Approval Gateway

The approval gateway controls which tool calls require user confirmation.

### Modes

| Mode | Behavior |
|------|----------|
| `safe` | Every tool call prompts for approval |
| `balanced` | Read-only tools auto-allow; mutating tools prompt (default) |
| `auto` | All tools auto-allow |

### Custom rules

Per-project rules can override the mode for specific tools or command prefixes.
Each rule specifies: tool name, optional command prefix, and decision
(`ask`, `allow`, `deny`).

### Audit trail

All approval decisions are recorded in the audit trail with action, scope,
decision, and timestamp. The trail is viewable in Settings → Permissions →
Approval Gateway → Audit Trail.

### Pending approvals

When a tool call requires approval, the loop emits an approval-request event.
The frontend renders inline approval cards (allow once / allow session / deny).
If no response within 10 minutes, the call is auto-denied and the run pauses.

## Stability & Crash Detection

The desktop app has a multi-layer stability system to detect freezes, crashes,
and renderer failures.

### Freeze watchdog

A background thread posts a heartbeat to the Tauri main thread every 2s. If the
main thread doesn't respond within 10s, a freeze report is written to
`<app-data>/reports/`. If unresponsive for >60s, the process aborts after
writing a final report.

### Renderer heartbeat

The frontend calls `stability_renderer_heartbeat` every 5s. If the backend
doesn't receive a heartbeat for >15s, a "renderer" crash report is written.
This detects JS freezes, webview crashes, and navigation failures.

### Command telemetry

Every Tauri command is timed via the `timed!` macro. Durations >50ms are
flagged as violations. The ring holds 512 entries. The DebugPanel shows recent
slow commands and violations.

### Crash reports

Reports are JSON files under `<app-data>/reports/`, retained to 50 files.
Kinds: `panic`, `freeze`, `renderer`, `abort`. The DebugPanel lists reports
with unseen badges. The `CrashReportNotice` toast surfaces unseen reports on
next launch (non-blocking, auto-dismisses after 15s).

### Provider timeouts

- Connect timeout: 10s
- Total request timeout: 300s
- Stream-idle timeout: 120s (documented; enforced via total timeout)
- Typed errors: `ProviderError` enum classifies failures as `AuthMissing`,
  `HttpError`, `ConnectTimeout`, `StreamIdleTimeout`, `EmptyResponse`, `Other`

### Subprocess timeouts

Git commands run with a 30s wall-clock timeout via `spawn_blocking`. OMP
commands have a 60s timeout. All git/catalog/chat commands are async Tauri
commands that run on a blocking thread pool to prevent main-thread freezes.

## Plan Run Queue

The plan run queue (`plan_runner_service.rs`) dispatches ready plans through the
native harness or OMP runner. The queue is backend-owned and survives frontend
unmounts.

- **Queue CRUD**: enqueue, reorder, remove. Stored in `plan_queue` table.
- **Per-provider concurrency** (`run-concurrency-limits`): the former
  single-`N` semaphore is replaced by a per-provider in-flight semaphore
  registry (`PROVIDER_SEMAPHORES`). Each provider's effective limit is
  project override → global default → conservative `1`. Runs + subagents
  acquire against their provider's semaphore, so they count together
  against the cap. Excess runs queue with a visible reason rather than
  erroring. Subagents are off by default; when enabled, their count is
  bounded by the provider limit. Configurable in Settings → Concurrency.
- **Plan→chat assignment**: a `ready` plan can be assigned to a chat
  column (one active per chat; re-assign confirms + restarts). On run
  start, the system provisions a worktree (fresh branch from the fetched
  default branch), seeds the chat from the plan + schematic, binds one
  model, and streams in that column. The auto-provisioned chat surfaces
  as a grid column; an assigned chat is reused instead of minting a new
  column.
- **Session provisioning**: `create_session_for_plan` in `native_chat_service.rs`
  creates a fresh chat session titled `<ref> — <plan title>`, bound to the
  profile's model, primed with an opening context message from the plan +
  linked OpenSpec change + project schematic.
- **Completion detection**: `tasks.md` checkbox polling via
  `openspec_service::read_task_progress`. When all tasks are checked, the run
  auto-completes as succeeded.
- **Cancel/pause**: cancel aborts the run and returns the plan to `ready` (or
  `cancelled` per user choice). Pause stops dispatching new runs; in-flight
  runs continue.
- **OMP runner**: `start_omp_run` records a run with `runner_kind=omp` and
  emits an event so the frontend opens an OMP terminal tab seeded with the
  plan's reference id + change path.
- **Events**: `plan_run://event` carries run_id, session_id, plan_id, status,
  chat_session_id, error. The frontend listens and surfaces the run's chat
  as a column in the active chat tab's grid.

## Final Touches

Per-project post-completion steps (`final_touches_service.rs`) execute
sequentially after a run completes. Kinds: `shell` (run a command),
`validate` (harness turn over diff — placeholder pending diff-review-workflow),
`commit` (git commit), `pull_request` (push branch + `gh pr create` or
browser compare URL via `pull_request_service.rs`; no token stored).
Remote-writing kinds default disabled and are always confirm-gated.
`finished` is gated on pipeline success: if any step fails, the run
is marked failed and the plan stays `ready`. When a worktree run
finishes, the chat surfaces a `PrRecommendationCard` (confirm-gated).

## Parallel Workspaces

`worktree_service.rs` creates git worktrees under
`<data-dir>/worktrees/<project-hash>/<reference-id>` with branch
`bb/<ref>-<slug>` from the **freshly fetched default branch** (auto-detected
via `origin/HEAD` → `origin/main` → `origin/master` → local `main` →
`master` → current `HEAD`). A best-effort `git fetch --all` runs before
branch creation; on fetch failure the branch bases off the local default
and the chat surfaces a non-blocking "base may be stale" notice.
Worktrees are created on run start (not at assignment) and retained until
explicit prune (the branch is always kept). Non-git projects fall back to
sequential execution in the primary checkout with a visible notice.

## Connector Permission Gateway

Connectors are local-first tool integrations (OMP, Claude Code, Codex, etc.)
that plug into Basebuild's UI without being modified. The gateway extends the
native-agent-loop approval substrate — one rules store, one prompt stack, one
audit trail — with connector identity as an additional scope dimension.

### Local-first constraints
- No remote plugin marketplace. Connectors are local processes only.
- No unreviewed remote code execution. Connector manifests must be registered
  and enabled explicitly.
- No silent startup launch. Connectors are NOT auto-started on app launch;
  restore shows them as `disconnected` until the user explicitly starts them.
- Provider claims (e.g. "OMP has OpenAI connected") require explicit user
  approval before Basebuild adopts them. Credentials are never auto-imported.
- Web/collab bridge origins require explicit allowlisting.

### Permission broker
The broker extends `settings_service.rs`'s approval modes (Safe/Balanced/Auto)
and rules storage with connector-scoped grants. Capabilities: command,
file_access, provider_claim, chat_sync, web_bridge, diagnostics, analytics,
skills. Grant scopes: once, session, project.

### Connector tables
- `connectors` — registry entries with manifest, state, capabilities, trust.
- `connector_grants` — per-connector per-capability grants (reuses
  `PermissionDecision` from the native approval gateway).
## Structured idea capture

Generate-ideas runs capture ideas as structured data rendered as inline cards,
never as chat prose alone:

- `propose_ideas` tool is exposed to the agent loop during generate-ideas
  runs. The tool accepts an array of `{title, description, grounding,
  categoryId?, anchor?}` and persists each as an idea row. `grounding`
  (concrete evidence) is required; captures without it are rejected.
  `anchor` optionally names the schematic element served.
- Prose or JSON in the assistant response is not parsed as a hidden fallback;
  the `propose_ideas` tool is the single structured-capture contract.
- Promoted ideas create a draft plan (tagged `chat:<id>`). Rejected ideas
  persist for history (append-only across regenerations).
- Idea state reloads with the session across restarts.
- Generate-ideas runs are recorded as `pipeline_runs` stage rows.
- Stray think-tag markers are stripped from content and routed to the
  reasoning store via `strip_think_tags`.

## Planning prompts

System prompts for chat, idea generation, plan generation, and category
suggestion are stored in the `planning_prompts` table and editable in
Settings → Planning. Planning-kind defaults (idea/plan/category generation)
derive from the bundled `basebuild-planning` skill content at read time;
`chat_system` uses a compiled default. Resetting an override restores the
skill-derived (or compiled) default. `planning_prompt_service.rs` serves
get/set/reset/list operations.

## Planning Inspector

The project Planning modal is a six-tab coordinator:

- **Plans** — draft plans expose an explicit **Generate OpenSpec** action.
  Artifact generation must succeed before status becomes `openspec`; a separate
  **Approve plan** validation action moves the plan to `ready`. Planner and
  coding provider/model routes are labeled independently.
- **Ideas** — filterable idea history plus guided rounds. A round accepts
  multiple categories (or project-wide scope), requests five to eight ideas
  with eight as the default, then uses the shared destination picker for an
  existing or dedicated new chat. Selected ideas become independent draft
  plans; generating more starts another reviewable round.
- **Categories** — category counts, drill-down, creation, and scoped idea
  generation.
- **Flow** — live stage counts, launch profile, queue controls, completion
  review, merge review, and archive/sync navigation. Stage cards drill into
  their owning tab rather than invoking placeholder actions.
- **Runs** — mission-control cards for owner chat, branch/worktree, checklist
  progress, elapsed time, blockers, attention, and supported run controls.
- **Changes** — the OpenSpec change catalog and explicit archive actions.

A schematic health badge appears in the inspector header when health is not
`complete`, with a tooltip naming incomplete sections.
## Planning prompts

System prompts for chat, idea generation, plan generation, and category
suggestion are stored in the `planning_prompts` table and editable in
Settings → Planning. Each prompt has a default; resetting restores it.
`planning_prompt_service.rs` serves get/set/reset/list operations.

Tool calls render as collapsed cards in message order from the event stream:

- Cards update live while streaming/executing via the `native-chat://tool-event`
  and `native-chat://approval-request` event channels.
- Consecutive non-approval tool calls collapse into one activity group showing
  a running count, aggregate status, and the latest call's summary. Expansion
  reveals individual cards in a height-capped scrollable list.
- Approval-required calls render an inline card with allow once / allow session
  / deny actions, wired to `native_chat_resolve_approval`.
- `list_files` glob results are deduplicated and sorted (the `**`
  zero-directory match is tried once per directory, not once per entry).

## Effort level validity

The composer only offers effort levels present in the selected model's
`supportedEfforts`. Persisted defaults are clamped to a supported level
(nearest supported, preferring the model's first supported effort) when
restored or when the model changes. Requests are never sent with an effort
the catalog marks unsupported.

## Test database isolation

All Rust tests run against an isolated `BASEBUILD_HOME` (temp directory).
`StorageService::connect()` enforces this in `cfg(test)` builds by erroring
when `BASEBUILD_HOME` is unset. A shared test-util constructor
(`test_util::test::isolated_home`) provisions a fresh temp dir + global lock +
env var. The user's real `~/.basebuild/state.db` is never read or written
during tests.

## OMP-routed models are refused in chat

Native chat streams providers directly and never delegates a turn to an OMP
child process. `NativeChatService::route_requires_omp(api_kind,
credential_base_url, is_local)` detects the two route shapes that have no
native transport:

- the ChatGPT-subscription OAuth sentinel (`base_url == omp://openai-codex`),
- a bespoke `api_kind` (e.g. `devin-agent`, `openai-codex-responses`) with no
  direct endpoint.

`native_chat_send` returns a `setup_required` result for these routes — the
draft is kept and the message explains the fix (reconnect with an API key, or
pick a native-supported model). The former persistent `omp --mode rpc` chat
bridge (`omp_rpc_session_service.rs`, `omp_rpc_*` commands) was removed: its
frame parser had drifted from the current OMP RPC protocol (`message_start`,
`thinking_*`, `extension_ui_request`, `tool_execution_*`) and leaked debug
rows into transcripts, and it could not run Basebuild tools (approvals,
ask_user question cards, the schematic wizard).

The one-shot `OmpRpcClient` in `provider_client.rs` remains only as the
fallback transport for non-chat, single-shot generation paths (idea
generation); it never streams into a chat transcript.

### Plan runs

Plan-chat assignment supports `omp-rpc` as a runner kind
(`RunnerKind::OmpRpc`, stored as `omp-rpc`). Run streaming, status
transitions, and completion handling have parity with native runs.

## Shared skill registry

`skill_registry_service.rs` resolves one skill set from two roots:

- **Bundled**: `skills/` directory shipped with the app.
- **User**: `~/.basebuild/skills/` (created on first resolve).

User skills override bundled on name collision (marked `override` in the
listing). Both runtimes consume the same resolved set: native harness
planning/schematic turns read skill content through the registry
(`PlanningPromptService` routes `basebuild-planning` through it), and
app-launched OMP sessions are provisioned to discover the same directories
via `provision_dirs()`.

Skill content is instructions (prompt context), never code — injected as
prompt context only, never executed.

Settings → Skills lists every resolved skill with name, description, source
(bundled/user/override), and consuming runtimes. The listing refreshes on
every call (no cache) so user-directory changes appear without restart.

## Integration queue

`integration_service.rs` lists finished worktree runs with branch,
ahead/behind, merged state, and PR state. The flow board's Finished stage
renders an `IntegrationQueue` component with confirm-gated cleanup actions:
merged branches offer safe cleanup; unmerged branches require force
confirmation.

## Milestone auto-commit

Per-project setting (`get/set_milestone_auto_commit`) controls whether the
plan runner commits after each completed task milestone in the run worktree.
Default: false. Stored in `app_defaults` under
`milestone_auto_commit:<project_path>`.

## Prompt delivery contract

When a prompt needs to reach a specific chat tab (e.g. from the schematic
wizard), it goes through `deliverPrompt()` in `src/lib/promptDelivery.ts`:

- A `PromptDelivery` record (`actionId`, `prompt`, `mode`) is stored in a
  module-level `Map<chatSessionId, PromptDelivery>`.
- The target chat panel consumes it via `usePromptDelivery(sessionId)` which
  calls `consumeDelivery()` — exactly-once by `actionId`.
- `mode` is `insert` (fill the composer, don't send) or `send` (fill + send).
- For new conversations, `pendingNewPanelPrompts` ref in `AppShell` bridges
  the delivery until the new chat session is created.

The `DestinationPicker` dialog lets the user choose which open chat panel (or
a new conversation) receives the prompt.

## Prose quick-reply detection

`detectProseQuickReplies()` in `ChatPanel.tsx` detects enumerated options in
assistant messages (e.g. `A. Foo\nB. Bar`) and renders clickable quick-reply
chips. Detection:
- Matches `^[A-H][).:]\s` patterns (up to 8 options).
- Also detects "reply with X/Y" phrasing.
- Strips code fences before scanning.
- Renders chips after the message list; clicking a chip sends the option text.

## Markdown rendering contract

Assistant message bodies, thinking-block bodies, and command notices are
rendered through an in-house markdown renderer (`MarkdownView.tsx`) that
produces **React elements only** — never `dangerouslySetInnerHTML`, never
HTML strings. Raw HTML in the markdown source is rendered as literal text.

- Block tokenizer: fence, heading, list, blockquote, table, paragraph.
- Inline tokenizer: code, bold, italic, link.
- Links render as label + host text with the full URL in `title=`; no
  navigation is attempted.
- Fenced code blocks show a language label header and a copy button
  (`navigator.clipboard` with toast feedback).
- A minimal in-house syntax highlight pass covers comments, strings,
  numbers, and small keyword sets for ts/js/rust/py/json/bash/css/html.
  Unknown languages render unhighlighted. No external dependency.
- Completed messages are memoized by content hash; only the streaming
  message re-parses per frame.
- User messages remain plain pre-wrapped text (no markdown rendering).

## Message action rail

Each persisted message has a per-message action rail:
- **Copy** on all messages (clipboard write of raw source text with toast).
- **Retry** on the latest assistant message (re-issues last user message;
  prior assistant reply preserved; timeline marker links original and retried).
- **Edit-and-resend** on the latest user message (prefills composer, sends
  appends a new turn).
Buttons are tab-reachable with `title=` tooltips.

## Tool card depth

Tool call results render as expandable cards (`ToolEventCard`) with:
- Per-kind icons and duration display.
- Expanded key/value argument table with nested JSON pretty-printed.
- **Unified diff** for `write_file` and `edit_file` (LCS line-diff, cap 400
  lines with head/tail elision; unchanged → explicit "no changes").
- **Approval provenance** line: "Approved by user" / "Denied by user" /
  "Allowed by rule `<pattern>`" / "Auto (mode)".
- Expansion state persists across streaming re-renders (keyed by tool call
  id via a module-level `Map<string, boolean>`).

## Provider availability states

The provider picker renders three states:
- **Ready** (green): configured with a usable transport.
- **Setup required** (grey): no credential stored.
- **Transport unavailable** (warning): configured but all models have
  bespoke `api_kind` and no `base_url` — no native transport; chat sends
  are refused with setup guidance.

Per-provider error chips with Retry buttons appear when `provider.error`
is set; retry triggers `native_provider_catalog_refresh({ providerId, force: true })`.

"Update key" is available beside Disconnect for configured providers in
both the settings panel and the chat provider picker.

## Native schematic wizard round trip

The schematic wizard uses the native agent loop's `ask_user` interaction
mechanism:
- `execute_ask_user` parks the turn on an mpsc channel waiting for resolution.
- `resolve_interaction` delivers answers through the channel; `cancel_interaction`
  delivers a cancelled resolution.
- Pending interactions are stored in a global `Mutex<HashMap<String, mpsc::Sender>>`.

When the agent writes to `.basebuild/project-schematic.md` via `write_file`,
a post-turn mtime check in the native send path detects the change and
emits a `SchematicUpdated` planning event so the schematic tab refreshes.

## Idea grounding metadata

Idea and category generation prompts include a mandatory **decision digest**:
- Recent picked/rejected ideas (last 10).
- Plans finished since the schematic's mtime.
- When the digest is empty, an explicit "no decisions since schematic
  update" line is injected (not silently omitted).

`NativeGenerateIdeasResult` carries `GroundingMetadata`:
- `schematicSections`: headings parsed from the schematic file.
- `finishedPlans`: reference IDs of plans finished since schematic update.
- `finishedPlanCount`, `pickedCount`, `rejectedCount`.
- `digestEmpty`: whether the digest had no recent decisions.

The Planning Inspector's Ideas tab renders a batch header with grounding
provenance ("Grounded in: <sections> · N finished plans") and a
"Generate from finished plans" action that produces a digest-weighted
prompt variant (disabled when no finished plans since schematic update).

## OpenSpec artifact quality gate

`validate_artifacts(change_dir)` in `openspec_service.rs` checks:
- `proposal.md` is non-empty with `## Why` and `## What-Changes` sections.
- At least one spec directory with `spec.md` containing a requirement
  heading and a scenario heading.
- `tasks.md` has at least one task checkbox; pre-checked tasks produce
  a warning (expected 0 for a new change).

Errors block plan status advancement; warnings are advisory. The gate
is wired into:
- `pipeline_service::stage_generate_openspec` after `write_artifacts_atomic`:
  failure keeps the plan in `draft`, records the pipeline run as failed,
  and preserves artifacts on disk.
- `PlanDependencyService::validate_readiness`: artifact errors flow into
  readiness errors, warnings into readiness warnings.

The task progress parser (`parse_task_progress`) counts nested/indented
checkboxes and mixed markers (`-` and `*`) with arbitrary indentation
depth. A single parser feeds plan cards, the context strip, and
`plan_runner_service::evaluate_checklist_completion`.

## Windows background startup

Basebuild can launch automatically at Windows sign-in, minimized to the
system tray. The autostart registration is owned by `tauri-plugin-autostart`
(v2), which manages the Windows registry entry. The `--background` argument
distinguishes autostart launches from explicit foreground launches.

### Launch lifecycle

1. **Window starts hidden** (`visible: false` in `tauri.conf.json`).
2. The `.setup()` block in `lib.rs` calls `detect_launch_mode()` to check
   for `--background`.
3. Foreground launches: window is shown and focused immediately.
4. Background launches: window stays hidden; services initialize without
   spawning terminals or agents.
5. Tray "Show" menu item and single-instance activation call `window.show()`
   + `set_focus()` to reveal the window on demand.

### Consent gates

- **First-run default-on but explicit**: Launch-at-sign-in is selected by
  default in the setup wizard, but OS registration is created only when the
  user completes setup (not on skip/escape/dismiss).
- **Settings control**: The Updates tab in Settings shows the desired and
  effective registration states, with enable/disable and retry-reconciliation
  controls.
- **Enabling startup does NOT imply analytics consent**: The startup
  preference and usage analytics upload are independent settings.

### Usage sync scheduler

Scheduling stays in Rust (`sync_service.rs`) because hidden webviews can be
throttled. The scheduler:
- Is native-first: sources sync in order native → OMP → other detected
  harnesses (`registered_sources`), and the native envelope is the PRIMARY
  source. OMP raw usage and harnesses are best-effort enrichment: a failure is
  recorded per-source (Source status row) but never downgrades the overall
  outcome or raises the coordinator banner (`coordinated_usage_outcome`).
- Trickles rather than syncing on a rigid hour: a startup push, then a short
  evaluation cadence (`MANAGED_TRIGGER_EVAL_SECS`, 60s) fires an early sync when
  usage changes (≥5 new requests or ≥20%), a provider is added, or the device
  has never synced. A periodic full tick (`autoSyncIntervalMinutes`) is only a
  backstop. `MIN_INTER_SYNC_GAP_SECS` (60s) debounces the pushes.
- Runs the network freshness check (`get_my_live_usage.shouldSync`) and the
  push INSIDE the spawned worker thread, so command-path triggers ("Sync now",
  retry) return instantly and never block the UI. Managed/usage-change triggers
  skip freshness (we already know there is new local usage) and push directly.
- Is fault-isolated end to end. A source that cannot be read, a batch this
  client cannot encode, and a batch the server refuses each affect only
  themselves: `assemble_envelope` validates every batch independently and
  ships the survivors, so one unparsable harness row can never starve the
  other sources. `EnvelopeSyncReport` reports `accepted`/`skipped`/`retryable`
  separately, and `Err` means only "nothing reached the server".
- Never replays a batch that cannot succeed. A locally unrepresentable batch,
  or a receipt rejected with a permanent code (`rejection_is_permanent`:
  `invalid_window`, `invalid_row`, `idempotency_conflict`, …), advances its
  source's cursor via `discard_batch`. Unrecognized codes are treated as
  transient, so a server-side change never silently drops a user's usage.
- Mirrors the server's transport limits locally (`usage_envelope.rs`
  constants: 5 batches, 500 rows/batch, 1000 rows/envelope, 31-day window,
  90-day horizon). `clamp_window` pulls long backlogs into range and
  `normalize_identifier` coerces third-party model ids (Claude Code's
  `<synthetic>`, ids with spaces) into the accepted charset instead of
  failing the batch that carries them.
- Emits batches deterministically. The server keys idempotency on a digest of
  the serialized batch, so every aggregator uses ordered maps or an explicit
  sort — an arbitrary iteration order makes an identical replay look like a
  different payload and come back as `idempotency_conflict`.
- Native metrics are rolled up client-side into aggregated rows before
  transport (`aggregate_model_usage_rows`), keeping batches under the envelope's
  500-row cap and sending only aggregate counters.
- Uses a single-flight coordinator (`SYNC_IN_FLIGHT`, held by an RAII guard so
  a panicking worker cannot wedge it) to coalesce concurrent triggers into at
  most one in-flight sync.
- Applies bounded exponential backoff (30s → 900s max) on transient failures,
  reset to 30s on success. The window is enforced in `trigger_sync`
  (`backoff_elapsed`) and surfaced as the `retry_backoff` off-reason with a
  `retryAfter` timestamp; gates stay open so "Sync now"/"Retry sync" bypass it.
- Bounds shutdown sync to 10s so exit cannot hang.
- Clears auth and stops remote scheduling on 401 **and** on JSON-RPC `-32001`,
  which the server returns with HTTP 200 for a revoked or under-scoped bearer.

#### Consent gate and proactive prompt

The "Share anonymous aggregate usage" toggle (`analytics_consent.upload_enabled`)
is the consent signal. `gates_pass()` requires only the enabled toggle plus
`auto_sync_usage`; it never blocks on a separate `consented_at` timestamp, so
installs upgraded from a build that set the toggle without stamping a timestamp
keep syncing. `set_consent` backfills `consented_at`/`consent_version` the first
time a toggle is enabled, purely as an audit record. `resolve_off_reason`
(pure, unit-tested) distinguishes the states: an enabled toggle passes; a
disabled toggle with no prior choice reports `ConsentRequired` (the only state
that drives the proactive `UsageSharingBanner`); an explicit opt-out reports
`UsageSharingDisabled` and is respected without re-prompting. The banner is a
one-time dismissible strip (`basebuild:usage-consent-dismissed`) that enables
sharing in one click or links to Settings → Privacy.

All network-bound usage-sync commands (`usage_sync_projected_usage`,
`usage_{detect,list,declare}_provider_plans`, `sync_raw_usage_native`) are async
and run on `spawn_blocking`, so opening the Account settings tab never blocks the
main thread.

#### Rolled-up and raw are two independent streams

basebuild.net needs both shapes, and they land in different tables, so each
has its own cursor in `UsageSyncSettings`:

| Stream | Tool | Cursor | Principal | Server table |
| --- | --- | --- | --- | --- |
| Rolled-up aggregates | `sync_usage_envelope` | `last_envelope_sync_at` | account or guest | `UsageEnvelopeReceipt`/`Row` |
| Raw per-message rows | `sync_messages` | `last_message_sync_at` | account only | `AppMessageUsage`, `UserUsageSnapshot` |
| Raw OMP blobs | `sync_raw_usage` | OMP source cursor | account only | `RawUsageBlob` |

They MUST NOT share a cursor: whichever drained first would starve the other.
`last_envelope_sync_at` is seeded from `last_message_sync_at` on upgrade
(`get_usage_sync_settings`) so an existing install does not re-send accepted
windows. Raw message rows carry `ts` in **milliseconds** — `AppMessageUsage.ts`
is millisecond-based, and sending seconds skews every distribution query.

### Privacy boundaries

The versioned usage envelope (`usage_envelope.rs`) wraps native chat metrics
in an allowlisted, validated payload. The validator rejects prompts,
responses, reasoning, source code, terminal output, tool args/results,
secrets, credentials, environment values, and raw paths before transport.
Signed-in accounts additionally use the raw paths (`sync_raw_usage`,
`sync_messages`); guest/private installations are restricted by the server to
the closed envelope and skip the account-only tools locally rather than
spending a request on a guaranteed `-32001`.
