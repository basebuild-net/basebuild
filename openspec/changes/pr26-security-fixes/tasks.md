# Tasks: PR #26 Security & Correctness Fixes

## 1. Skill Name Validation

- [ ] 1.1 Add `validate_skill_name(name: &str) -> Result<(), String>` to
      `src-tauri/src/commands/skills.rs` enforcing
      `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`; reject path separators, `..`,
      null bytes, colons, whitespace, empty.
- [ ] 1.2 Call `validate_skill_name` in `read_skill` and
      `read_skill_content` before any path join.
- [ ] 1.3 Call `validate_skill_name` in
      `SkillRegistryService::read_content` before path joins for user
      and bundled skill roots.
- [ ] 1.4 Add Rust tests: valid name resolves; `../x`, `x/../../y`,
      `x\y`, empty, null-byte, 129-char names rejected; user override
      wins for valid names.

## 2. Cross-Project Assignment Guard

- [ ] 2.1 In `PlanRunnerService::assign_to_chat`
      (`src-tauri/src/services/plan_runner_service.rs`), load the plan's
      session via `SessionService::get(&plan.session_id)` and compare
      `project_path` to `chat_session.project_path`; reject mismatched
      projects with a typed error naming both paths.
- [ ] 2.2 Handle the plan-session-missing case with a
      `"Plan's session not found"` error.
- [ ] 2.3 Add Rust tests: same-project succeeds; cross-project rejected;
      plan session missing rejected; existing plan-not-found and
      chat-not-found tests still pass.

## 3. Native-First Transport Routing

- [ ] 3.1 In `src-tauri/src/services/provider_client.rs`, change
      `resolve_client_for_model` so bespoke `api_kind` without `base_url`
      returns a `TransportUnavailable` error instead of defaulting to
      `OmpRpcClient`. Keep `OmpRpcClient` for the `omp://openai-codex`
      sentinel only.
- [ ] 3.2 In `src-tauri/src/services/native_chat_service.rs`, remove the
      `uses_omp_rpc` computation (lines 759-767) and the OMP RPC session
      start/send block (lines 854-939). Replace with a transport
      availability check that returns `SetupRequired` when the provider
      has no native transport.
- [ ] 3.3 Update the `resolve_client_for_model` tests: bespoke kind +
      no base URL → `TransportUnavailable` (not `OmpRpcClient`); sentinel
      still routes to `OmpRpcClient`; custom base URL still routes to
      `OpenAiCompatibleClient`.

## 4. Verification

- [ ] 4.1 `cd src-tauri && cargo test skill` — skill validation tests pass.
- [ ] 4.2 `cd src-tauri && cargo test plan_runner` — assignment guard
      tests pass.
- [ ] 4.3 `cd src-tauri && cargo test provider_client` — transport
      routing tests pass.
- [ ] 4.4 `cd src-tauri && cargo check` — compiles clean.
- [ ] 4.5 `npx tsc --noEmit` — frontend type check passes.
- [ ] 4.6 `npm run build` — frontend build passes.

## 5. Docs & Roadmap

- [ ] 5.1 Refresh `openspec/ROADMAP.md` via
      `node scripts/openspec-status.mjs --write`.
