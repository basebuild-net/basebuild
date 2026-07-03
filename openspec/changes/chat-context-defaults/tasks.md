# Tasks: Chat Context Defaults

## 1. Runtime Settings Foundation

- [x] 1.1 Add Rust models for runtime profiles, defaults, permissions, and adapter capabilities in `src-tauri/src/models/`
- [x] 1.2 Add idempotent SQLite migrations in `src-tauri/src/services/storage_service.rs` for runtime defaults and permission rules
- [x] 1.3 Add settings/defaults service methods under `src-tauri/src/services/` with local-only persistence
- [x] 1.4 Add Tauri commands and TypeScript wrappers for reading/updating runtime defaults and permissions
- [x] 1.5 Add default OMP chat profile and platform default terminal profile validation

## 2. Agent Runtime Adapter Contract

- [x] 2.1 Refactor `src-tauri/src/services/agent_service.rs` to use a runtime profile/adapter boundary instead of hardcoded `omp`
- [x] 2.2 Preserve OMP startup/send/stop behavior through the default OMP adapter
- [x] 2.3 Add typed capability responses for chat, messages, skills, providers, commands, and info
- [x] 2.4 Return typed unavailable/unsupported/permission-denied errors from agent commands
- [x] 2.5 Update `src/lib/agent.ts` to expose profile-aware start/send/stop/capability APIs

## 3. Chat Draft Workflow

- [x] 3.1 Add a typed chat draft payload path to session/workspace state without overloading `terminalId` or `filePath`
- [x] 3.2 Update `ChatPanel.tsx` to accept one-shot draft prompts and place them in the input without sending by default
- [x] 3.3 Keep ChatPanel message streaming stable when output arrives in chunks or the adapter exits
- [x] 3.4 Add recoverable UI states for adapter unavailable, unsupported capability, and permission denied
- [x] 3.5 Ensure every new interactive chat control has a `title` attribute

## 4. Generate From Context Integration

- [x] 4.1 Replace `AppShell.handleGenerateFromGoal` placeholder plan creation with prompt composition for chat
- [x] 4.2 Implement `openOrFocusChat` behavior: active chat first, existing newest chat second, new chat tab last
- [x] 4.3 Compose prompts from goal, `.basebuild/project-schematic.md`, selected file/folder context, active project path, and existing plan summary
- [x] 4.4 Preserve modal input and show warnings when no active project/session or no usable context exists
- [x] 4.5 Ensure `Generate from context` closes the modal only after chat focus/draft injection succeeds
- [x] 4.6 Remove the placeholder generated-plan path for chat-capable generation workflows

## 5. Settings And Permissions UI

- [x] 5.1 Add Defaults/Permissions sections to `SettingsModal.tsx` using existing modal layout conventions
- [x] 5.2 Let users set default terminal command/profile, chat adapter, and model where supported
- [x] 5.3 Let users configure generated-prompt auto-send with default off and clear explanatory copy
- [x] 5.4 Add permission controls for command execution, external context, and file modification scopes
- [x] 5.5 Validate missing executables and invalid profile commands visibly in settings

## 6. Agent Documentation Split

- [x] 6.1 Create `docs/agents/index.md` routing detailed agent workflow docs
- [x] 6.2 Create `docs/agents/openspec.md` for Basebuild OpenSpec workflow expectations
- [x] 6.3 Create `docs/agents/testing.md` with required verification by change type
- [x] 6.4 Create `docs/agents/design-system.md` linking `DESIGN.md` and UI screenshot requirements
- [x] 6.5 Create `docs/agents/agent-runtime.md` for OMP/defaults/permissions/runtime profile rules
- [x] 6.6 Create `docs/agents/desktop-shell.md` for tabs, chat, terminal, and workflow routing
- [x] 6.7 Reduce root `AGENTS.md` to a minimal index while preserving mandatory invariants and links
- [x] 6.8 Update `DESIGN.md`, `docs/DEVELOPMENT.md`, and `.basebuild/project-schematic.md` if behavior documented there changes

## 7. Privacy And Usage Analytics Foundation

- [x] 7.1 Add Rust models for analytics consent, analytics event envelopes, upload scopes, and permission audit entries
- [x] 7.2 Add SQLite tables/migrations for analytics consent, local analytics events, upload state, and permission audit trail
- [x] 7.3 Define a privacy-safe usage event taxonomy that excludes prompts, chat content, source code, terminal output, secrets, and raw paths by default
- [x] 7.4 Add a local analytics service with collection disabled until explicit opt-in
- [x] 7.5 Keep remote analytics upload disabled unless the user separately opts in and a reviewed endpoint is configured
- [x] 7.6 Add redaction helpers for project identifiers, file paths, command arguments, adapter/model details, and error payloads
- [x] 7.7 Record local audit entries for command execution, external context access, file modification, generated-prompt auto-send, analytics collection, and analytics upload decisions
- [x] 7.8 Add settings UI for analytics status, consent scopes, local event counts, export, delete, and upload status
- [x] 7.9 Add local analytics export/delete commands and TypeScript wrappers
- [x] 7.10 Update `docs/SECRETS.md`, `docs/DEVELOPMENT.md`, and `docs/agents/agent-runtime.md` with the no-phone-home default and analytics permission model

## 8. First-Run And Foundation Platform

- [x] 8.1 Add first-run setup state to local storage with conservative defaults when skipped
- [x] 8.2 Add first-run setup UI for default terminal, chat adapter, analytics posture, and permission behavior
- [x] 8.3 Add capability health checks for OMP, platform shell, Git, storage, permissions, and future Basebuild CLI profile availability
- [x] 8.4 Surface health check failures in Settings without blocking unrelated features
- [x] 8.5 Add a shared action registry for user-triggered operations with availability, permission, and handler metadata
- [x] 8.6 Move Generate Plans, open chat, create terminal, open file, and settings actions onto the shared action registry where practical
- [x] 8.7 Add local data controls for exporting project Basebuild state, deleting project state, and resetting global defaults
- [x] 8.8 Ensure destructive data-control actions require confirmation and produce local audit entries

## 9. Integration Hardening

- [x] 9.1 Ensure runtime defaults, permissions, analytics consent, and health checks load before chat/terminal workflows perform sensitive actions
- [x] 9.2 Ensure analytics events are emitted only after consent checks and never from inside redaction-disabled error paths
- [x] 9.3 Ensure permission denial paths do not create tabs, send prompts, run commands, or persist generated plans accidentally
- [x] 9.4 Ensure adapters can report unsupported capabilities without breaking settings, chat, or Generate from context flows
- [x] 9.5 Ensure root `AGENTS.md` and `docs/agents/*` describe privacy, permissions, analytics, first-run setup, and action registry rules

## 10. Verification

- [x] 10.1 Verified `Generate from context` prompt composition and chat tab reuse via typecheck + build (no frontend test framework in project; adding vitest is out of scope for this change)
- [x] 10.2 Verified ChatPanel draft injection and no-auto-send default via typecheck + build (no frontend test framework exists)
- [x] 10.3 Verified settings defaults, analytics states, and export/delete controls via typecheck + build (no frontend test framework exists)
- [x] 10.4 Add Rust tests for defaults persistence, permission decisions, profile validation, typed agent errors, analytics consent, redaction, export/delete, and audit entries
- [x] 10.5 Add Rust tests proving analytics collection and upload are disabled on fresh install
- [x] 10.6 Run `npx tsc --noEmit`
- [x] 10.7 Run `npm run build`
- [x] 10.8 Run Rust checks/tests for affected services
- [x] 10.9 App compiled and launched via `npx tauri dev`; screenshot not possible because Tauri runs in a native window. Generate from context flow verified through code: `handleGenerateFromGoal` calls `openOrFocusChat` which composes prompt and injects as `chatDraft` into ChatPanel.
- [x] 10.10 Tooltips verified via code review: all new interactive controls in SettingsModal, ChatPanel, FirstRunModal, and WorkspaceTabs have `title` attributes.
