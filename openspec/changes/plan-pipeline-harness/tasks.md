# Tasks: Plan Pipeline & Native Harness Commands

## 1. Foundations & Migrations

- [x] 1.1 Bump storage schema version in `storage_service.rs`; add migration: plan status rename (`waiting→ready`, `in_progress→running`), idea status collapse to snake_case (`concept/picked/archived`), `plans.idea_id`, `plans.change_name` columns.
- [x] 1.2 Create `pipeline_runs`, `plan_queue`, `plan_runs`, `final_touch_steps`, `workspaces` tables in the same migration; startup pass marks stale `running` pipeline/plan runs `failed`.
- [x] 1.3 Update `PlanStatus` in `models/plan.rs` (Ready/Running variants, lenient `from_str` for legacy strings) and `models/idea.rs`; sync `src/lib/plans.ts` and `src/lib/ideas.ts` types/labels.
- [x] 1.4 Update `AGENTS.md` invariant 9 and `.basebuild/project-schematic.md` lifecycle text (approval granted in this change); update `PlanPanel.tsx`/`IdeasPanel.tsx` status labels and CSS state classes.
- [x] 1.5 Rust unit tests: migration idempotency, legacy status parsing, stale-run cleanup. `cargo check` + `npm run build`.

## 2. Chat Model Defaults

- [x] 2.1 Add global `chat.defaultModel` and per-project default (provider/model/effort) persistence in `settings_service.rs` + `settings.rs` command + `src/lib/settings.ts`.
- [x] 2.2 Resolve defaults on session create in `native_chat_service.rs` (project → global → first connected); write-back on manual composer selection in `ChatPanel.tsx`.
- [x] 2.3 Graceful fallback + notice when the stored default's provider is disconnected or model missing from catalog.
- [x] 2.4 Tests: default resolution order (Rust unit), restart-persistence smoke via dev app.

## 3. Idea → Plan Pipeline

- [x] 3.1 `pipeline_service.rs`: stage-run recording, per-run `CancellationToken`, cancel command; `pipeline.rs` Tauri commands + `src/lib/pipeline.ts` wrapper + run events.
- [x] 3.2 Implement stages over the native harness: generate idea categories, generate ideas (per category/freeform), enhance idea → draft plan; prompt templates as bundled skills with project schematic context.
- [x] 3.3 Pick flow: multi-select promote in `IdeasPanel.tsx` → linked draft plans (`idea_id`), idea → `picked`; idea card shows derived plan status/link.
- [x] 3.4 Pipeline UI: stage buttons, per-run status/error display, cancel buttons in `IdeasPanel.tsx`/`PlanPanel.tsx`; tooltips on all controls.
- [x] 3.5 Tests: stage lifecycle transitions, cancellation aborts request and records `cancelled`, promotion linkage (Rust unit + UI smoke).

## 4. OpenSpec Artifacts

- [x] 4.1 `openspec_service.rs`: change-name derivation (kebab-case + collision suffix), atomic artifact writes to `<project>/openspec/changes/<name>/`, `.openspec.yaml` stamping.
- [x] 4.2 Bundled skills `basebuild-openspec-proposal/-specs/-design/-tasks` driving generation as a pipeline stage; `draft → openspec` transition gated on all files written.
- [x] 4.3 `tasks.md` checkbox parser + progress on plan model; refresh on file change/open; plan card progress display.
- [x] 4.4 Review affordance: open generated artifacts in the file viewer; explicit action advances `openspec → ready`.
- [x] 4.5 Tests: name collision handling, atomic write (no partial change dir on failure), checkbox parsing edge cases.

## 5. Slash Command Registry

- [x] 5.1 `command_discovery_service.rs`: scan builtin manifest, `.omp/commands` (project>user), `.claude/commands` (recursive + `dir:name` aliases), `.codex/commands`, skills, MCP prompts; first-wins dedup with shadow tracking; `list_slash_commands` command.
- [x] 5.2 Frontmatter parsing (`name`, `description`) + template expansion (`$1..$n`, `$@[start[:len]]`, `$ARGUMENTS`/`$@`, quote-aware args, no-placeholder append) with Rust unit tests; `expand_slash_command` command.
- [x] 5.3 Composer autocomplete popup in `ChatPanel.tsx`: filter-as-you-type, description + source badge, keyboard navigation; styles in `globals.css`.
- [x] 5.4 Replace hardcoded `handleSend` parsing with builtin-action dispatch map (`/login`, `/model`, `/models refresh`, `/mcp`, `/plan`, `/idea`, `/openspec`) + file/MCP expansion path + `/skill:<name>` injection + unknown-command fallthrough (send-as-text).
- [x] 5.5 Command list UI (shadowed entries visible) and rescan on project switch/manual refresh.
- [x] 5.6 Tests: precedence/dedup, expansion table-driven cases, unknown fallthrough UI smoke.

## 6. Native MCP Client

- [x] 6.1 Add pinned `rmcp` dependency (dependency review); `mcp_service.rs` wrapping client behind a Basebuild trait; config loader for omp `mcp.json` schema (both scopes + fallbacks, `disabledServers`, `${VAR}`, `!command` resolution) with validation errors surfaced.
- [x] 6.2 stdio transport: supervised child processes (spawn on enable, kill on disable, crash reporting/reconnect).
- [x] 6.3 Streamable HTTP + SSE transports; OAuth browser flow reusing `auth_service.rs` plumbing, tokens keyed per server URL, refresh handling.
- [x] 6.4 Expose MCP tools to native chat turns namespaced `mcp:<server>/<tool>` through the approval gateway; render tool results in transcript.
- [x] 6.5 Register MCP prompts as slash commands via `command_discovery_service.rs` (collision prefixing).
- [x] 6.6 Settings MCP section: server list (source, state, tool/prompt counts), enable/disable, add/edit (project or user scope with `$schema`), test, reauth, reload; `src/lib/mcp.ts` wrapper.
- [x] 6.7 Tests: config parsing/validation (table-driven), stdio lifecycle against a local echo server, approval-gated tool call integration.

## 7. Plan Run Queue & Sessions

- [x] 7.1 `plan_runner_service.rs`: queue CRUD (enqueue/reorder/remove), execution profile `N × provider/model[/effort]` persistence, tokio-semaphore scheduler, `plan_run://` events; commands + `src/lib/planRuns.ts`.
- [x] 7.2 Session provisioning: `create_session_for_plan` in `native_chat_service.rs` — fresh session, title `<ref> — <plan title>`, opening context from plan + linked change + schematic, bound model; plan `ready → running`.
- [x] 7.3 Run lifecycle: completion detection (all tasks checked or explicit user done), cancel (abort turn, plan back to `ready` or `cancelled` per user choice, artifacts kept), pause queue, `finished_at` stamping.
- [x] 7.4 OMP runner path: "Run with OMP" opens terminal tab seeded with reference id + change path; plan → `running`.
- [x] 7.5 Queue UI in `PlanPanel.tsx`: profile selector at top (`N ×` + model picker), queue ordering, per-run status, cancel/pause controls, links to run sessions.
- [x] 7.6 Tests: scheduler respects N, cancel semantics, session provisioning fields, queue survives panel unmount (backend-owned) — Rust unit + dev-app smoke.

## 8. Final Touches

- [x] 8.1 `final_touches_service.rs` + step config CRUD (kinds: `shell`, `validate`, `commit`, `pull_request`; ordered, per-project, remote-writing kinds default disabled).
- [x] 8.2 Execution after run completion: sequential steps, per-step status/output on the run, halt-on-failure with retry/skip/send-to-chat actions; `finished` gated on pipeline success.
- [x] 8.3 Step implementations: shell via `process_helpers`, validate via harness diff-review turn, commit/PR via `git_service.rs` extensions.
- [x] 8.4 Settings UI for step configuration showing exact commands to run; tooltips.
- [x] 8.5 Tests: ordering, failure halts, disabled-by-default guarantees (no commit/PR on unconfigured project).

## 9. Parallel Workspaces
- [x] 9.1 `worktree_service.rs`: create worktree under managed dir with branch `bb/<ref>-<slug>`, list, remove via `git worktree remove` (confirmation before `--force`); `src/lib/workspaces.ts`.
- [x] 9.2 Queue integration: acquire worktree per run when concurrency > 1 and repo is git; sequential fallback + notice otherwise; hard-cap concurrency 1 without worktrees.
- [x] 9.3 Workspace UI: list with plan/branch/path, prune action, uncommitted-changes warning.
- [x] 9.4 Tests: worktree create/remove round-trip in a temp repo, non-git fallback.
## 10. Docs, Polish & Verification

- [x] 10.1 Update `docs/agents/agent-runtime.md` (harness commands, MCP, defaults), `docs/agents/desktop-shell.md` (queue/workspace surfaces), `DESIGN.md` (new UI states/classes).
- [x] 10.2 Verify design contract: zero radius, tooltips on every new control, styles only in `globals.css`.
- [x] 10.3 Full pass: `npx tsc --noEmit`, `npm run build`, `cargo check`, `cargo test`; end-to-end smoke: categories → ideas → pick → openspec → ready → queue run (1× and 2× with worktrees) → final touches → finished; cancel at each stage.
- [x] 10.4 Suggest commit points per completed phase (no silent commits).
