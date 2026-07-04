# Tasks: Native Agent Loop & Tool Runtime

## 1. Straggler Verification Pass

- [ ] 1.1 Run the 5 open `stabilize-and-agent-chat` smoke checks (tab creation, file opening, plan CRUD, session context menus, agent chat send/receive); mark them `[x]` in that change.
- [ ] 1.2 Run the 3 open `startup-update-splash` checks (release workflow dry-run, portable update path, splash screenshots) and the 1 open `omp-ide-sync` smoke (per-message provider/plan/model/effort in raw OMP tab); mark them done.
- [ ] 1.3 Archive any of the three changes whose tasks are now complete (`/archive`), merging their delta specs.

## 2. Provider Tool Protocol

- [x] 2.1 Add `ToolSchema`, `ToolCallRequest`, tool-result `ChatMsg`, `ProviderRequest.tools`, `ProviderResponse.tool_calls`, and a `tool_call` emit channel to `provider_client.rs` types and trait.
- [x] 2.2 OpenAI-compatible adapter: send `tools`, assemble fragmented `tool_calls` argument deltas, round-trip role-`tool` results; SSE-fixture unit tests.
- [x] 2.3 Anthropic adapter: send `tools`, parse `tool_use` / `input_json_delta` blocks, return `tool_result` blocks; verify ordering with extended-thinking responses; SSE-fixture unit tests.
- [x] 2.4 Catalog capability gate: `supports_tools` flag on models (default true for network providers, false for `basebuild-local`); plain-chat degradation path.

- [ ] 3.1 `tool_runtime_service.rs`: `ToolDef` registry (schema, ReadOnly/Mutating kind, execute fn); JSON-schema definitions for all six tools.
- [ ] 3.2 Implement `read_file` (ranges, truncation markers), `write_file`, `edit_file` (exact-match + occurrence validation), `list_files` (glob), `search_files` (Rust regex walker, workspace-scoped).
- [ ] 3.3 Workspace scoping: canonicalize + symlink-resolved prefix check shared by all file tools; denial audit events.
- [ ] 3.4 `run_command`: supervised child process with cwd validation, 120s default timeout, size-capped streamed output, Windows job-object (or `taskkill /T /F`) and Unix process-group kill via `process_helpers`.
- [ ] 3.5 Rust unit tests: edit occurrence mismatch, path escapes (dot-dot + symlink), command timeout/cancel kill, output capping.

## 4. Approval Gateway

- [ ] 4.1 Schema migration: per-project `approval_mode` (default `balanced`), persistent rules table; models for modes/rules/decisions.
- [ ] 4.2 Gateway resolution in `settings_service.rs` + `agent_loop_service.rs`: mode → auto-allow/deny/prompt; session rules (tool kind, command prefix); decision + provenance recorded on `native_tool_events`.
- [ ] 4.3 Pending-approval flow: approval-request event to frontend, resolve command, 10-minute timeout → deny + pause run.
- [ ] 4.4 Replace the `request_tool_approval` stub with the gateway; keep command signature compatibility or migrate callers.
- [ ] 4.5 Settings UI: mode switcher per project, persistent rule list editor, audit view entry point; tooltips everywhere.
- [ ] 4.6 Tests: mode matrix (safe/balanced/auto × read/write/command), prefix rules, deny-feeds-model, timeout denial.

## 5. Agent Loop

- [ ] 5.1 `agent_loop_service.rs`: iteration loop (cap 25), per-run `CancellationToken`, dedicated thread per run, incremental message/tool-event persistence, run-state column + startup interrupted-run sweep.
- [ ] 5.2 Concurrency policy: parallel read-only calls, sequential mutating calls, results keyed by call id.
- [ ] 5.3 Wire into `native_chat_service::send` (tools-capable models start a loop; others single turn); expose `run_agent_turn` entry point for future callers (plan runner).
- [ ] 5.4 Cancellation command aborting stream + killing in-flight tools; `src/lib/native-chat.ts` wrappers for cancel, approvals, tool events.
- [ ] 5.5 Context budget guard: token estimate vs catalog window (32k conservative default) minus output margin; whole-turn oldest-first truncation preserving system prompt + latest user turn + current iteration results; head+tail capping of oversized tool results (full output stored locally).
- [ ] 5.6 Rust tests: loop termination (no-tool response, cap, cancel), truncation pairing invariants (no dangling tool results), interrupted-run sweep.

## 6. Transcript UI

- [ ] 6.1 Tool cards in `ChatPanel.tsx`: collapsed cards with name/args summary/status/duration, live updates, expand for full args/results; styles in `globals.css` (0px radius, tooltips).
- [ ] 6.2 Unified diff rendering for `edit_file`/`write_file`; file-path links into the file viewer.
- [ ] 6.3 Command cards: command text, streaming output, exit code, "open in terminal" action (opens tab at cwd, does not re-run).
- [ ] 6.4 Inline approval cards: allow once / allow for session (kind or command prefix) / deny; pending state while the loop waits.
- [ ] 6.5 System rows: truncation, iteration cap, run-interrupted notices; approval-mode indicator + switcher in the composer rail.

## 7. Verification & Docs

- [ ] 7.1 Playwright/browser tests with mocked Tauri commands: tool card rendering, approval card flow, cancel button, budget notice (extends the strong-testing-suite seams).
- [ ] 7.2 Live smoke on Windows: real provider turn that reads, edits, and runs `npm run build` in a scratch project under `balanced` mode; cancel mid-command; `auto` mode full run.
- [ ] 7.3 `npx tsc --noEmit`, `npm run build`, `cargo check`, `cargo test` full pass.
- [ ] 7.4 Update `docs/agents/agent-runtime.md` (loop, tools, approval modes, budget guard), `DESIGN.md` (tool card/diff/approval/system-row states), `.basebuild/project-schematic.md` priorities if user approves.
- [ ] 7.5 Coordinate with `plan-pipeline-harness`: confirm `run_agent_turn` satisfies the queue's session provisioning needs and MCP tools can register as `ToolDef`s behind the same gateway; note integration points in that change's design if adjustments are needed.
