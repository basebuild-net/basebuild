# Agent Runtime

Basebuild is **native-first**: the primary chat runtime is an in-house Rust
agent loop (`agent_loop_service.rs`) that handles provider streaming, tool
calling, approval gates, and ask_user interactions directly. All providers
(OpenAI, Anthropic, Devin, GLM-5.2, etc.) route through this native loop — no
external CLI process is required for chat.

OhMyPi (OMP) is a **supported tool**, not the chat transport. OMP may be used
as a terminal panel, a plan runner, and an optional chat profile for users who
want OMP's own tool ecosystem. The OMP RPC bridge (`omp-rpc` profile) exists
for users who explicitly choose it, but the native agent loop is the default
and preferred runtime. The architecture supports future adapters (Basebuild
CLI, other CLIs, IDEs) without changing the chat UI contract.

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

The composer opens provider/model configuration in one two-pane modal. A dense
provider grid puts configured providers first with green Connected state;
unconfigured providers use grey Available state. The adjacent searchable model
pane stays scoped to the selected provider and shows capability badges. Models
are keyed by both provider id and model id, so duplicate model
ids cannot cross providers. On restore, the chat session's provider/model/effort
wins over the project default; effort controls contain only values present in
the selected model's `supportedEfforts`. Until catalog-owned effective transport
capabilities land, the UI also rejects known bespoke transports that cannot
participate in the native tool loop rather than starting a false planning run.
Transports that cannot expose tools produce an explicit capability state before
launch; they do not advertise planning support or start a fake tools-capable run.

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

`native_generate_ideas` runs idea generation as a chat turn through the agent
loop. The conversation plus the project schematic is sent to a **configured**
provider with a category-aware system prompt. A `propose_ideas` tool is exposed
to the agent loop; when the model calls it, each idea is persisted via the
existing ideas store (`create_idea`) and rendered incrementally as a card in
the chat transcript. A fallback structured-output parser captures ideas if the
model emits proposal-shaped JSON in its text response instead of calling the
tool.

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

`question` and `approval` cards render inline in their owning surface (Schematic
or planning) and visibly block the run. The run resumes the exact pending turn
once, after the user answers or resolves the approval gate; duplicate or stale
answers are ignored.

## Tool Runtime

The `ToolRuntimeService` provides six built-in tools:

| Tool | Kind | Description |
|------|------|-------------|
| `read_file` | ReadOnly | Read file contents with optional range support |
| `write_file` | Mutating | Create or overwrite a file |
| `edit_file` | Mutating | Exact-match string replacement with occurrence validation |
| `list_files` | ReadOnly | Glob-based file listing |
| `search_files` | ReadOnly | Rust regex content search, workspace-scoped |
| `run_command` | Mutating | Supervised child process with timeout and output capping |

All file tools enforce workspace scoping: paths are canonicalized and
symlink-resolved before a prefix check against the project root. Denials are
recorded as audit events.

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
- Fallback: if the model emits idea-shaped JSON in its text response
  instead of calling the tool, the structured-output parser captures them.
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

The project Planning modal is a five-tab inspector:

- **Plans** — the existing plan pipeline (edit, focus, queue). The blank/manual
  Create plan affordance, Generate plans modal, and input boxes are removed;
  generation begins from AI ideas and existing plan metadata remains editable.
- **Ideas** — filterable idea history (all/concept/picked/rejected/archived)
  with promote, reject, and delete actions. Each idea card shows its
  `grounding` evidence and `anchor` (or an "outside current focus" flag when
  no anchor is set).
- **Categories** — list with idea counts, drill-down detail, add-category
  form, and "Suggest more ideas" which opens a chat turn scoped to the
  category. The empty state offers "Generate categories from project"
  (no hardcoded seeds).
- **Flow** — lifecycle counts, launch policy, run board, and merge queue.
- **Changes** — the OpenSpec change catalog.

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

## OMP RPC chat bridge (optional profile)

The `omp-rpc` chat runtime profile is an **optional** path for users who
explicitly want OMP's own tool ecosystem. It is not the default and not
required for any provider. The native agent loop (`agent_loop_service.rs`)
is the default and preferred runtime for all providers, including Devin and
GLM-5.2.

When the `omp-rpc` profile is explicitly selected, it runs a persistent
`omp --mode rpc` child per session (`omp_rpc_session_service.rs`), exchanging
line-delimited JSON frames over stdio. Unlike the one-shot `OmpCodexRpcClient`
(which uses `--no-tools --no-session`), the session bridge enables
session+tools and stays alive for the duration of the chat.

### Frame map

Frames are untrusted child-process output. Parsing is tolerant: malformed
lines are skipped, unknown frame kinds render as inert collapsed debug rows.
Never executes or interpolates frame content.

| Frame type | Mapping |
|---|---|
| `response` (command=prompt, success=false) | Error chunk on `native-chat://chunk` |
| `assistantMessageEvent` / `event` | Nested event: `text_delta` → content, `reasoning_delta` → reasoning, `tool_*` → tool card |
| `turn_end` / `agent_end` | Turn-end marker on `native-chat://chunk` |
| `user_input` / `ask` / `question` | Pending interaction (question card) via `InteractionService`; answer returned over stdin |
| Unknown | Inert debug row on `native-chat://chunk` (channel=debug) |

### Lifecycle

- `probe_omp_rpc()` gates the profile: `omp --version` must succeed.
- `start_session()` spawns a hidden `omp --mode rpc` child, reads stdout on a
  background thread, and emits `omp-rpc://status` events.
- Process exit → `omp-rpc://status` (status=exited) → session-ended state;
  visible history retained.
- `cancel_session()` sends a cancel frame and cancels pending interactions.
- `resolve_user_input()` sends the user's answer back over stdin.

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

## OMP RPC question routing

OMP RPC `ask_user` frames are routed into `pending_interactions` by
`handle_user_input` in `omp_rpc_session_service.rs`. The chat UI renders these
as interactive question cards. Answers are serialized back over stdin via
`resolve_user_input`. This applies to OMP RPC sessions only; native chat uses
the in-process harness directly.

## Prose quick-reply detection

`detectProseQuickReplies()` in `ChatPanel.tsx` detects enumerated options in
assistant messages (e.g. `A. Foo\nB. Bar`) and renders clickable quick-reply
chips. Detection:
- Matches `^[A-H][).:]\s` patterns (up to 8 options).
- Also detects "reply with X/Y" phrasing.
- Strips code fences before scanning.
- Renders chips after the message list; clicking a chip sends the option text.
