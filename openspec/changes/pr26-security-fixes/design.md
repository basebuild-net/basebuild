# Design: PR #26 Security & Correctness Fixes

## Context

PR #26 adds user-facing features (command palette with `/skill:<name>`,
plan-run assignment) on top of existing surfaces that have unvalidated
inputs. The native-first architecture direction means OMP RPC should not
be the default chat transport. Three issues need fixing before merge.

## Key Decisions

### D1: Skill name validation — strict slug + canonicalization

**Decision:** Validate skill names with a strict regex before any path
operation. Canonicalize the resolved path and verify it falls under an
allowed root.

**Rationale:** The existing `skill_dir().join(skill_name)` pattern is
inherently unsafe with arbitrary input. A regex prevents traversal
characters at the input boundary. Canonicalization + prefix-check is
defense-in-depth: even if the regex is bypassed, the resolved path
cannot escape the allowed roots.

**Pattern:** `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`
- Alphanumeric start (no leading `-` or `_` for filesystem safety).
- Up to 128 chars (reasonable skill name length).
- No `/`, `\`, `..`, `:`, null, or whitespace.

**Implementation locations:**
- `src-tauri/src/commands/skills.rs` — `validate_skill_name()` helper,
  called in `read_skill`, `read_skill_content`.
- `src-tauri/src/services/skill_registry_service.rs` — same helper,
  called in `read_content`.
- The helper lives in one place and is imported by both.

**Root verification:** After joining, canonicalize with
`std::fs::canonicalize` (or `std::path::Path::canonicalize` on the
parent if the file doesn't exist yet) and check the result starts with
either `skill_dir()` or `user_skill_dir()`.

### D2: Cross-project assignment — project_path equality check

**Decision:** In `assign_to_chat`, load the plan's session via
`SessionService::get(&plan.session_id)` and compare its `project_path`
to `chat_session.project_path`. Reject if they differ.

**Rationale:** The plan's session determines the project context, and
the chat session determines the worktree workspace. Mismatched projects
would inject plan context from one project into a chat/worktree bound to
another, causing confusion and potential file writes in the wrong
workspace.

**Error:** `"Plan belongs to project '{plan_project}' but chat session
belongs to project '{chat_project}'. Cross-project assignment is not
allowed."`

**Edge cases:**
- Plan's session missing → existing "Plan not found" or new
  "Plan's session not found" error.
- Chat session missing → existing "Chat session not found" error.
- Both project paths empty → allow (defensive, shouldn't happen).

### D3: Native-first transport routing — remove implicit OMP fallback

**Decision:** In `native_chat_service.rs`, remove the `uses_omp_rpc`
computation that routes native-profile chat through OMP RPC. Instead,
if a provider/model has no native transport, return a typed error.

**Rationale:** The architecture direction says native-first. OMP RPC
is an optional profile, not the default. Silently launching OMP for
bespoke providers violates the user's expectation and the documented
architecture.

**Changes:**
1. `native_chat_service.rs`: Remove the `uses_omp_rpc` branch
   (lines 759-767, 854-939). Replace with a transport availability
   check: if `resolve_client_for_model` returns a transport that
   requires OMP and the profile is native, return
   `SetupRequired { message: "Provider '{label}' requires an OMP profile
   for chat. Switch to the OMP profile or configure a native provider." }`.
2. `provider_client.rs`: Change the bespoke-kind fallback from
   `OmpRpcClient` to a `TransportUnavailable` error. Keep `OmpRpcClient`
   only for:
   - Explicit `omp://openai-codex` sentinel (backward compat).
   - Explicit OMP profile selection (future, not in this change).
3. The `OmpRpcClient` struct and its implementation remain for the OMP
   profile path; we just stop defaulting to it from native profile.

**What stays:**
- `OmpRpcClient` struct and implementation (used by OMP profile).
- `omp://openai-codex` sentinel routing (backward compat).
- `omp_available()` probe (used for setup-required messaging).

**What's removed:**
- The implicit `uses_omp_rpc` computation in `native_chat_send`.
- The OMP RPC session start/send block in `native_chat_send`.
- The `OmpRpcClient` default in `resolve_client_for_model` for bespoke
  kinds without `base_url`.

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Existing OMP RPC users lose chat | OMP profile path still works; only native profile changes |
| Skill validation breaks existing skills | Regex allows all existing skill names (alphanumeric + `-`/`_`) |
| Cross-project check blocks valid use | Same-project is always allowed; only mismatched projects blocked |
| TransportUnavailable breaks bespoke providers | They were already broken (404 on Connect RPC); now they get a clear message |
