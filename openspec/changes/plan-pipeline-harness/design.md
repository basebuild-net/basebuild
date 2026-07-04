# Design: Plan Pipeline & Native Harness Commands

## Context

Plans/ideas are CRUD-only today (`plan_service.rs`, `IdeasPanel.tsx`); nothing promotes, generates, executes, or cancels. Native chat (`native_chat_service.rs`) sends provider-backed turns but hardcodes three slash commands in `ChatPanel.handleSend` and forgets the selected model. oh-my-pi is the reference bar: capability-based command discovery with provider precedence, markdown command templates, `/skill:` injection, MCP config/tools/prompts. Basebuild is native-harness-first but must keep OMP as a first-class runner.

## Goals / Non-Goals

**Goals**:
- End-to-end pipeline: categories → ideas → pick → draft → openspec → ready → running → finished, cancellable at every stage.
- Queued/parallel plan execution with model binding and auto-provisioned fresh chat sessions.
- omp-parity command registry and full MCP client, sharing omp's on-disk config formats for zero-duplication interop.
- Local-first throughout; no new network surfaces beyond user-configured MCP servers and providers.

**Non-Goals**:
- Replacing OMP or porting its TUI.
- Cloud sync of plans/queues.
- MCP *server* hosting (Basebuild acts as client only).
- Marketplace/plugin distribution for commands or skills.

## Decisions

**Decision**: Rename statuses via a one-shot SQLite migration (`waiting→ready`, `in_progress→running`), keeping `from_str` accepting legacy strings for one release. — **Rationale**: matches the pipeline vocabulary users see; parsing leniency makes the migration idempotent and crash-safe. **Alternatives**: label-only mapping in UI — rejected, guarantees storage/UI drift.

**Decision**: Ideas become pre-plan objects (`concept → picked → archived`, snake_case); `plans.idea_id` is the only link; idea progress is derived at read time. — **Rationale**: one lifecycle owner; eliminates the current camelCase/snake_case split and duplicated states. **Alternatives**: mirrored statuses — rejected, N sources of truth.

**Decision**: New `pipeline_runs` table records every AI stage (kind, plan/idea target, status, error, output refs, timestamps) with a `CancellationToken` per running stage held by `pipeline_service.rs`. Startup marks stale `running` rows `failed`. — **Rationale**: crash-safe, inspectable, and gives cancel a uniform implementation across all stages instead of ad-hoc flags.

**Decision**: `plan_runner_service.rs` owns the queue (SQLite `plan_queue` + `plan_runs` tables) and a tokio semaphore sized by the execution profile `N × provider/model[/effort]`. Runs provision sessions through `native_chat_service` (new `create_session_for_plan`), stream via existing `NATIVE_CHAT_CHUNK` events, and expose `plan_run://` lifecycle events to the UI. — **Rationale**: backend-owned orchestration survives panel unmounts and app-window churn; the frontend only renders state. **Alternatives**: frontend-driven loop — rejected, dies with the webview.

**Decision**: MCP client in Rust on the official `rmcp` SDK (stdio + streamable HTTP; SSE via its compat transport), wrapped by `mcp_service.rs` behind our own trait so the SDK is swappable. Config read/written in omp's `mcp.json` schema, including `disabledServers`, `${VAR}` expansion, and `!command` resolution. OAuth reuses the existing browser-flow plumbing from `provider_login_service.rs`/`auth_service.rs`; tokens keyed `mcp_oauth:<url>` in local storage. MCP tool calls route through the existing approval gateway (connector-permission-gateway work) as `mcp:<server>/<tool>`. — **Rationale**: full-client scope was chosen; `rmcp` removes protocol/transport risk; omp config compat means configure-once. **Risk**: `rmcp` API churn → pin version, isolate behind the trait.

**Decision**: Slash-command discovery and template expansion live in Rust (`command_discovery_service.rs`): scans builtin manifest, `.omp/commands` (project>user), `.claude/commands` (recursive, `dir:name` aliases), `.codex/commands`, skills, and MCP prompts; dedups first-wins by omp's precedence order; exposes `list_slash_commands` and `expand_slash_command`. Frontend keeps only a builtin-action dispatch map and the autocomplete popup. — **Rationale**: file scanning and quote-aware parsing are unit-testable in Rust; keeps `src/lib/*.ts` as thin wrappers (invariant 7); one IPC call per send is negligible. **Alternatives**: TS-side discovery via Tauri fs — rejected, duplicates glob/frontmatter logic that Rust already has patterns for.

**Decision**: OpenSpec generation is a pipeline stage in `openspec_service.rs`: prompt templates ship as bundled skills (`basebuild-openspec-proposal`, `-specs`, `-design`, `-tasks`), executed against the bound model with project schematic + plan context; files written atomically (temp dir then rename) into `<project>/openspec/changes/<name>/`; `tasks.md` parsed with a checkbox regex for progress. — **Rationale**: reuses the existing `read_skill` pattern; artifacts stay CLI/omp-compatible. **Alternatives**: `.basebuild/`-private artifacts — rejected by user choice.

**Decision**: Final touches are per-project ordered steps (`final_touch_steps` table; kinds: `shell`, `validate`, `commit`, `pull_request`), executed by `final_touches_service.rs` after a run completes; remote-writing kinds default disabled. `shell` uses `process_helpers`; `validate` is a harness turn over `git diff` vs the change's specs; `commit`/`pull_request` extend `git_service.rs`. — **Rationale**: honors the no-silent-side-effects invariant while enabling full automation opt-in.

**Decision**: Model defaults persist in `settings_service.rs`: `chat.defaultModel` (global) and per-project `projects.default_model` (provider/model/effort triple). Composer selection writes the project default; session creation resolves project → global → first-connected. — **Rationale**: smallest fix for the "re-pick every time" pain; also feeds the queue's model binding default.

**Decision**: Workspaces = `git worktree` managed by `worktree_service.rs` under `<data-dir>/worktrees/<project-hash>/<reference-id>`, branch `bb/<reference-id>-<slug>`; removal via `git worktree remove` (+ `--force` only after explicit confirmation). Queue acquires a worktree per run when concurrency > 1 and the project is a git repo; otherwise sequential fallback. — **Rationale**: worktrees are cheap, share the object store, and keep the primary checkout clean. **Alternatives**: full clones — rejected, slow and disk-hungry.

## Risks / Trade-offs

- **Scope size** → Mitigation: phases in tasks.md are independently shippable; phases 1–3 (migrations, defaults, registry) land value before MCP/queue complexity.
- **`rmcp` maturity / OAuth edge cases** → Mitigation: trait isolation, pinned version, `mcp test`-style connection check in Settings; SSE only via compat path.
- **Parallel runs mutating one checkout** (workspaces disabled) → Mitigation: hard-cap concurrency to 1 unless worktrees are active.
- **Agent-declared completion is unreliable** → Mitigation: `finished` requires final-touch success or explicit user confirmation; tasks.md progress is the visible signal, not the gate.
- **Command name collisions across ecosystems** → Mitigation: strict precedence + shadowed-command visibility, same as omp.
- **Status rename breaks in-flight rows for downgraders** → Mitigation: lenient `from_str` keeps reading legacy values; migration is forward-only and idempotent.

## Migration Plan

1. Bump storage schema version; in one transaction: rewrite plan statuses, rewrite idea statuses to snake_case triad, add `plans.idea_id`, `plans.change_name`, create `pipeline_runs`, `plan_queue`, `plan_runs`, `final_touch_steps`, `workspaces` tables.
2. Ship lenient parsing one release; remove legacy branches in the next.
3. Update `AGENTS.md` invariant 9 and `.basebuild/project-schematic.md` in the same commit as the migration (user approval for schematic edits granted in this change).
4. Rollback: schema additions are additive; status rename is reversible by inverse UPDATE.

## Open Questions

- Queue profile UI: single global profile per project (`4 × model`) vs per-plan overrides — start with per-project profile + per-plan override field, confirm during implementation.
- Should OMP runs (terminal runner) also get worktrees? Deferred: native runs first; terminal runner keeps primary checkout in v1.
- MCP prompt commands colliding with file commands: prefix with server name on collision — verify against real servers during implementation.
- How the native run detects "tasks complete": v1 = all tasks.md checkboxes checked OR explicit user action; revisit agent self-reporting later.
