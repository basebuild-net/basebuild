# Proposal: PR #26 Security & Correctness Fixes

## Why

PR #26 (`codex/mvp-workflow-audit`) introduces a chat command palette with
`/skill:<name>`, a plan-run assignment path, and native-first chat routing.
Code review identified three P0 issues that must be fixed before merge:

1. **Path traversal via `/skill:<name>`.** The `read_skill` Tauri command
   joins user-supplied `skill_name` directly to `skill_dir()` without
   validation (`src-tauri/src/commands/skills.rs:28-31`). The new
   `/skill:<name>` slash command (`ChatPanel.tsx:1276-1288`) makes this a
   first-class user-facing input. A skill name containing `..` or path
   separators can read arbitrary `SKILL.md` files outside the allowed
   roots. `SkillRegistryService::read_content` has the same gap
   (`skill_registry_service.rs:87-97`).

2. **Cross-project plan/chat assignment.** `PlanRunnerService::assign_to_chat`
   (`plan_runner_service.rs:824-932`) validates that the plan and chat session
   exist, but never checks they belong to the same project. A plan from
   project A can be bound to a chat session/worktree from project B, causing
   cross-project context injection and worktree provisioning in the wrong
   workspace.

3. **Native profile silently routes through OMP RPC.** The architecture
   direction (PR comment 5) declares native-first: all providers route
   through the in-house Rust agent loop. But `native_chat_service.rs:759-767`
   still marks bespoke API kinds without `base_url` as `uses_omp_rpc`, and
   lines 854-889 start a persistent OMP RPC session as the chat transport.
   `provider_client.rs:299-313` defaults bespoke kinds to `OmpRpcClient`.
   Native profile should never launch OMP as chat transport unless the
   user explicitly selected an OMP profile.

## What Changes

### Skill name validation
- Add a shared `validate_skill_name()` function that enforces a strict slug
  pattern (`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`), rejecting path separators,
  `..`, null bytes, and absolute paths.
- Apply it in `read_skill`, `read_skill_content`, and
  `SkillRegistryService::read_content` before any path join.
- Canonicalize resolved paths and verify they fall under the bundled or
  user skills root.

### Cross-project assignment guard
- In `assign_to_chat`, load the plan's session and compare its
  `project_path` to the chat session's `project_path`. Reject mismatched
  projects with a typed error.
- Add Rust tests: same-project succeeds, cross-project rejected, missing
  plan/chat still rejected.

### Native-first transport routing
- Remove the implicit `uses_omp_rpc` fallback for native profile.
- Native profile: if a provider/model has no native transport, return a
  typed `SetupRequired` / `TransportUnavailable` result instead of
  silently launching OMP.
- Keep OMP RPC only behind explicit OMP profile selection or the
  `omp://openai-codex` sentinel for backward compat.
- `provider_client.rs`: bespoke kinds without `base_url` return
  `TransportUnavailable` instead of defaulting to `OmpRpcClient`.

## Non-Goals

- OMP RPC feature improvements or write paths to OMP's database.
- Credential update UI (tracked in `provider-parity-workspace-fixes` task 4.3).
- Launch profile provider/model/effort controls (recovery plan Phase 2).
- De-duplication of `ask_user` handling (recovery plan Phase 3).
- Schematic wizard end-to-end verification (recovery plan Phase 4).
