# Design: Native Agent Loop & Tool Runtime

## Context

`provider_client.rs` defines `ProviderClient` streaming `content`/`reasoning` deltas via blocking reqwest + SSE, with `OpenAiCompatibleClient` and `AnthropicClient` as real backends and `LocalCoordinator` as offline fallback. `ChatMsg`/`ProviderRequest`/`ProviderResponse` carry no tool concepts. `native_chat_service.rs` runs exactly one provider turn per send and has approval *stubs*: `request_tool_approval` consults `SettingsService::get_permission_rules` but nothing calls tools; `native_tool_events` only ever stores `request_metrics`. Meanwhile `plan-pipeline-harness` (in flight) assumes a working loop + gateway for MCP tools and plan runs, and `connector-permission-gateway` (unstarted) specs a superset permission broker.

## Goals / Non-Goals

**Goals**:
- A model on either wire format can read, search, edit, and run commands in the project, under user-controlled approval, with everything auditable and cancellable.
- Backend-owned loop reusable by future callers (plan run queue, MCP tools) without UI attached.
- Ship the approval gateway `plan-pipeline-harness` and `connector-permission-gateway` will consume.

**Non-Goals**:
- MCP tools (plan-pipeline-harness phase 6 plugs into this loop later).
- History compaction/summarization (truncation only; compaction is its own change).
- PTY-visible agent commands (headless chosen; "open in terminal" is a viewer affordance).
- Subagents, hooks, LSP/AST tools — later parity waves.

## Decisions

**Decision**: Extend the existing provider types rather than adding a parallel path — `ChatMsg` gains a role enum incl. tool results, `ProviderRequest.tools: Vec<ToolSchema>`, `ProviderResponse.tool_calls: Vec<ToolCallRequest>`; the `emit` callback gains a `tool_call` channel for streamed call deltas. Each client owns its wire mapping (OpenAI `tools`/`tool_calls`/role-`tool`; Anthropic `tools`/`tool_use`/`tool_result` blocks). — **Rationale**: one request path keeps metrics/error handling/secret hygiene; adapters isolate format drift. **Alternatives**: separate "agent client" trait — rejected, duplicates streaming/auth/error code.

**Decision**: New `agent_loop_service.rs` owns the loop (iteration cap default 25, per-run `CancellationToken`, run-state column on native sessions marked interrupted on startup). `native_chat_service::send` becomes "start loop" when the model supports tools; each iteration persists assistant/tool messages incrementally so the transcript is crash-consistent. — **Rationale**: backend ownership survives webview churn and gives the plan runner a callable entry point (`run_agent_turn(session, prompt) -> RunResult`). **Alternatives**: frontend-driven loop — rejected, dies with the panel and can't serve the queue.

**Decision**: Tools implemented in `tool_runtime_service.rs` as a registry of `ToolDef { schema, kind: ReadOnly|Mutating, execute }`. Read-only calls from one response run concurrently; mutating calls run sequentially in response order. `edit_file` is exact-match replace with expected-occurrence validation (deterministic, verifiable, no fuzzy matching). Path scoping: canonicalize + prefix check against the workspace root after resolving symlinks. — **Rationale**: smallest correct tool set proven by every major harness; occurrence validation prevents the classic multi-match corruption. **Alternatives**: line-number edits — rejected, stale-line hazards without snapshot bookkeeping.

**Decision**: `run_command` uses supervised child processes via `process_helpers` (kill process tree on timeout/cancel; on Windows spawn through `cmd /C` with job-object termination), output size-capped and streamed as tool-card deltas. No PTY. — **Rationale**: user chose headless; deterministic capture, testable, no terminal-UI coupling. Trade-off: interactive commands hang until timeout — mitigation: docs + timeout default 120s.

**Decision**: Approval gateway lives in the existing permission-rules surface of `settings_service.rs`, extended with per-project `approval_mode` (`safe`/`balanced`/`auto`, default `balanced`), persistent per-project rules, and in-memory session rules (per tool kind, or command-prefix for `run_command`). Prompt flow: loop emits an approval-request event → ChatPanel renders the inline card → decision command resolves the pending call; timeout (10 min) denies and pauses the run. Every decision + provenance lands on the `native_tool_events` row. — **Rationale**: reuses the stub's storage/UI seams; prefix rules match how users actually batch-approve (`npm test`, `cargo check`). This is the concrete implementation `connector-permission-gateway` should later wrap for external connectors.

**Decision**: Context guard in the loop, not the provider: estimate with the existing `estimate_tokens`, budget = catalog context window (conservative 32k default when unknown) minus output margin (max(8k, 20%)); drop oldest non-system turns whole; oversized tool results stored fully but sent head+tail-truncated. — **Rationale**: whole-turn dropping keeps tool-call/result pairing intact (dangling tool results are wire-format errors on both APIs).

**Decision**: Tool availability is capability-gated per model: catalog entries carry `supports_tools` (default true for OpenAI-compatible/Anthropic; false for `LocalCoordinator`); unsupported models get plain chat turns + UI notice. — **Rationale**: explicit degradation beats provider 400s.

## Risks / Trade-offs

- **Streaming tool-call assembly differs per provider** (OpenAI fragments arguments across deltas; Anthropic uses `input_json_delta`) → table-driven parser tests per client with recorded SSE fixtures.
- **Blocking reqwest client + long loop occupies a thread** → loop runs on a dedicated thread per run (same pattern as PTY sessions); cancellation token checked between iterations and wired to process kill.
- **Model ignores occurrence-count contract on edits** → error results teach the model; edits never apply on mismatch.
- **Windows process-tree kill is fiddly** → use job objects (or `taskkill /T /F` fallback); test on Windows explicitly (primary dev OS).
- **Approval fatigue in `balanced`** → session prefix rules + visible mode switcher; `auto` exists for trusted projects.
- **Parallel-change collision**: `plan-pipeline-harness` touches `native_chat_service.rs` concurrently → this change adds new services and keeps `native_chat_service` edits to the send entry point; coordinate merge order (this change should land first; the queue consumes `run_agent_turn`).

## Migration Plan

1. Additive schema migration: `approval_mode` + rules table, run-state column on native chat sessions; `native_tool_events` unchanged shape, new kinds/statuses.
2. No behavior change for models without tool support; existing sessions keep working as plain chat.
3. Rollback: feature-gate the loop behind a setting (`agent.toolsEnabled`, default on) so a bad release can disable tools without downgrade.

## Open Questions

- Should `search_files` shell out to ripgrep if present or use a Rust regex walker? Start with Rust walker (no external dependency); revisit for perf.
- Reasoning-capable models interleaving thinking with tool calls (Anthropic extended thinking) — verify block ordering against the live API during implementation.
- Whether `LocalCoordinator` should fake a tool-echo mode for offline UI testing — decide during the testing phase.
