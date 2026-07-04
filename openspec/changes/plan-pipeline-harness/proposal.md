# Proposal: Plan Pipeline & Native Harness Commands

## Why

The plan/idea system exists as CRUD tables and panels but does not work as a pipeline: ideas and plans have parallel, drifting lifecycles; nothing promotes an idea into a plan; nothing executes a plan; the model must be re-picked on every chat; and the native chat's slash commands are three hardcoded `if` branches. Basebuild's goal is a first-party harness at least as capable as oh-my-pi — that requires a real command registry, MCP support, and an end-to-end `generate idea categories → generate ideas → pick → draft → openspec → ready → running → finished` pipeline with cancellation, queued/parallel execution, and configurable completion actions.

## What Changes

- **BREAKING** Rename plan statuses `waiting → ready` and `in_progress → running` (SQLite migration; AGENTS.md invariant 9 and `.basebuild/project-schematic.md` updated with this change).
- **BREAKING** Collapse idea statuses to snake_case `concept → picked → archived` (migration from camelCase `concept/planReady/inProgress/finished/paused/cancelled`); picking an idea creates a linked draft plan that owns the lifecycle from then on.
- Add AI pipeline stages as recorded, cancellable runs: generate idea categories, generate ideas (per category or freeform), enhance idea → draft plan, draft plan → OpenSpec artifacts.
- Generate real OpenSpec artifacts (`proposal.md`, `specs/`, `design.md`, `tasks.md`) into the target project's `openspec/changes/<change-name>/`, linked to the plan by reference id; parse `tasks.md` checkboxes for progress display.
- Add a plan run queue: line up plans, execute one-by-one or `N ×` in parallel with a configurable default execution model (e.g. `4 × umans/glm-5.2`); a starting plan opens a fresh native chat session with a generated title, fresh context, plan reference, and the bound model. Cancel stops the run, keeps artifacts, and returns the plan to `ready`.
- Add "final touches" — a per-project, ordered list of post-completion actions (run tests, validation prompt, commit, open PR) executed when a plan run finishes, each gated and reportable.
- Add persistent chat model defaults: last-used provider/model/effort per project plus a global default, so a chosen model (e.g. `umans/glm-5.2`) is never re-picked manually.
- Replace hardcoded chat slash-command parsing with a provider-based registry (omp's precedence model): builtin UI commands, project/user `.omp/commands/*.md`, `.claude/commands/**/*.md`, `.codex/commands/*.md`, `/skill:<name>`, and MCP prompts — with autocomplete, frontmatter descriptions, `$1`/`$@`/`$ARGUMENTS` template expansion, and unknown-command fallthrough to the LLM.
- Add a full native MCP client: stdio, streamable HTTP, and SSE transports with OAuth; omp-compatible `.omp/mcp.json` / `~/.omp/agent/mcp.json` config (including `disabledServers` and `${VAR}` expansion); MCP tools callable from native chat behind the approval gateway; MCP prompts surfaced as slash commands; server management UI in Settings.
- Add parallel workspaces (git worktrees) so parallel plan runs can each execute in an isolated checkout, with lifecycle management (create, reuse, prune) — used by the run queue when concurrency > 1.

## Capabilities

### New Capabilities

- `plan-pipeline` — unified idea→plan lifecycle, stage recording, promotion, and cancellation.
- `plan-run-queue` — queued/parallel plan execution with model binding and auto-provisioned chat sessions.
- `plan-final-touches` — configurable post-completion action pipeline.
- `chat-model-defaults` — persistent provider/model/effort defaults per project and globally.
- `slash-command-registry` — discovery, precedence, expansion, and autocomplete for chat slash commands.
- `native-mcp-client` — full MCP client (config, transports, auth, tools, prompts, management UI).
- `openspec-artifacts` — OpenSpec change generation, linkage, and task progress in target projects.
- `parallel-workspaces` — git-worktree isolation for concurrent plan runs.

### Modified Capabilities

- None in `openspec/specs/` (empty). Supersedes the hardcoded command parsing described by `chat-slash-commands` in the unarchived `provider-model-command-ui` change; `slash-command-registry` is its replacement surface.

## Impact

- `src-tauri/src/models/`: `plan.rs` (status rename), `idea.rs`, new `plan_run.rs`, `mcp.rs`, `slash_command.rs`, `workspace.rs` models.
- `src-tauri/src/services/`: `plan_service.rs`, `storage_service.rs` (migrations), new `plan_runner_service.rs`, `pipeline_service.rs`, `final_touches_service.rs`, `mcp_service.rs`, `command_discovery_service.rs`, `openspec_service.rs`, `worktree_service.rs`; `native_chat_service.rs` (session provisioning, MCP tools, model defaults); `git_service.rs` (worktrees).
- `src-tauri/src/commands/`: matching command modules; `lib.rs` registration.
- `src/lib/`: `plans.ts`, `ideas.ts`, new `planRuns.ts`, `mcp.ts`, `slashCommands.ts`, `openspec.ts`, `workspaces.ts`, `native-chat.ts` (defaults).
- `src/components/`: `ChatPanel.tsx` (registry-driven composer + autocomplete), `IdeasPanel.tsx`, `PlanPanel.tsx` (pipeline + queue UI), `SettingsModal.tsx` (MCP servers, final touches, defaults), `src/styles/globals.css`.
- New Rust dependency for MCP (`rmcp` official SDK or equivalent) — requires dependency review.
- Docs: `AGENTS.md` (invariant 9 statuses), `.basebuild/project-schematic.md` (explicit approval granted in this change), `DESIGN.md`, `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md`.
