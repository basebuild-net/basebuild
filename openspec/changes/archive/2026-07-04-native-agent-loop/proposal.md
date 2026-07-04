# Proposal: Native Agent Loop & Tool Runtime

## Why

The native harness can chat but cannot act: `provider_client.rs` streams text/reasoning only, no tool schemas reach providers, and the only tool event ever recorded is `request_metrics`. Approval scaffolding exists (`request_tool_approval`, permission rules, `native_tool_events`) with nothing behind it. Every headline feature in flight — the plan run queue actually implementing plans, MCP tools in chat, final-touch validation — assumes an agentic loop that does not exist. This change builds the core: a streaming multi-turn tool-call loop, a workspace-scoped tool runtime, and a real approval gateway.

## What Changes

- Extend the provider layer (`ChatMsg`, `ProviderRequest`, `ProviderResponse`, `ProviderClient`) with tool schemas, tool-call deltas, and tool-result messages, with wire-format adapters for OpenAI-compatible and Anthropic APIs.
- Add a backend-owned agent loop: send → stream → collect tool calls → approval gateway → execute → append results → repeat, with per-turn cancellation, iteration caps, and crash-safe run state.
- Add a core tool runtime in Rust: `read_file`, `write_file`, `edit_file` (exact-match replace), `list_files` (glob), `search_files` (regex), and `run_command` (headless, supervised, timeout + kill-on-cancel) — all workspace-scoped with path-escape rejection.
- Implement the tool approval gateway with per-project modes `safe` (approve everything), `balanced` (auto-allow reads, approve writes/commands), and `auto` (no prompts), plus session-scoped always-allow rules and a persisted audit trail in `native_tool_events`.
- Render tool activity in the chat transcript: collapsed tool cards, diff view for edits, command output blocks with exit codes, inline approval prompts, and an "open in terminal" escape hatch for commands.
- Add a context budget guard: per-model token budget from the catalog, oldest-turn truncation preserving system prompt and recent turns, and a visible UI signal when truncation occurs. Full compaction is explicitly deferred.
- Execute the 9 outstanding manual verification tasks from `stabilize-and-agent-chat`, `startup-update-splash`, and `omp-ide-sync` so those changes can archive.

## Capabilities

### New Capabilities

- `agent-tool-loop` — multi-turn streaming tool-call loop with cancellation and run state.
- `core-tool-runtime` — workspace-scoped file/search/command tools executed in Rust.
- `tool-approval-gateway` — configurable approval modes, session rules, and audit trail.
- `tool-transcript-rendering` — tool cards, diffs, command output, and approval UI in chat.
- `context-budget-guard` — token budget enforcement with truncation and UI signal.

### Modified Capabilities

- None in `openspec/specs/` (empty). This change implements the tool-approval subset of the unstarted `connector-permission-gateway` change's `permission-provider-broker` capability; that change should be re-scoped to consume this gateway rather than redefine it. `plan-pipeline-harness` phases 6–7 (MCP tools, run queue) plug into this loop — its MCP tools become additional tool providers behind the same gateway.

## Impact

- `src-tauri/src/services/provider_client.rs` — tool schema/call/result types, OpenAI + Anthropic adapters, streaming tool-call deltas.
- `src-tauri/src/services/` — new `agent_loop_service.rs`, `tool_runtime_service.rs`; `native_chat_service.rs` (loop integration, real tool events), `settings_service.rs` (approval modes/rules), `file_service.rs`, `process_helpers.rs`.
- `src-tauri/src/models/` — tool schema/call/event models; approval mode/rule models.
- `src-tauri/src/commands/` — approval responses, run cancellation, tool event queries; `lib.rs` registration.
- `src/lib/native-chat.ts` (tool events, approvals, cancellation), `src/components/panels/ChatPanel.tsx` (tool cards, approval prompts, budget signal), `src/styles/globals.css`.
- SQLite: approval rules table, run-state columns on native sessions; `native_tool_events` gains real payloads.
- Docs: `docs/agents/agent-runtime.md` (loop, tools, approval modes), `DESIGN.md` (tool card/diff/approval UI states).
