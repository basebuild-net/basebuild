# Tasks: Native Harness IDE Chat

## 1. Source Review And Architecture

- [x] 1.1 Review Dream chat, provider, approval, project, terminal, and persistence modules; record which concepts or files are adapted and what MIT attribution is required
- [x] 1.2 Map native harness boundaries onto existing `RuntimeProfile`, `AgentCapability`, permissions, sessions, terminal, and settings services
- [x] 1.3 Design additive SQLite migrations for native chat sessions, messages, tool events, provider metadata, model selections, approvals, workspace restore, layout widths, and OMP-stats-style request metrics

## 2. Native Runtime Core

- [x] 2.1 Add a `basebuild-native` runtime profile seed in `src-tauri/src/services/settings_service.rs` without removing the OMP profile
- [x] 2.2 Implement native harness service methods for starting sessions, sending messages, streaming assistant chunks, recording tool events, closing sessions, and writing per-request metrics
- [x] 2.3 Add provider/model catalog services that expose local provider status, available models, selected defaults, effort levels, and typed provider errors
- [x] 2.4 Route native command/file/tool requests through existing backend permission checks and audit records before execution
- [x] 2.5 Add thin Tauri command wrappers and `src/lib/*.ts` invoke wrappers for native sessions, messages, providers, models, approvals, request metrics, and workspace restore state

## 3. Chat Workspace UI

- [x] 3.1 Refactor `src/components/panels/ChatPanel.tsx` to render structured native chat messages, tool events, approvals, errors, and streamed assistant turns
- [x] 3.2 Add model/provider controls with explicit status/error states and tooltips for every interactive element
- [x] 3.3 Add project-scoped chat history and multi-chat selection in the workspace tab/session model
- [x] 3.4 Keep OMP/runtime-profile chat compatibility through the same ChatPanel contract while native chat is introduced
- [x] 3.5 Update `src/styles/globals.css` only for reusable chat/workspace primitives and maintain 0px border radius

## 4. Workspace 1.0 State And Shell Polish

- [x] 4.1 Persist and restore last focused project, session, chat tab, active workspace tab, side panel section, and panel widths without auto-spawning stale terminal/process tabs
- [x] 4.2 Make center/side columns resizable with persisted per-project widths and keyboard/mouse accessible handles
- [x] 4.3 Simplify the inspector/plans side-panel flow into clear Plans, Files, Source, Chat/Context affordances with consistent icons and labels
- [x] 4.4 Fix buggy or ambiguous icons and ensure every interactive element has a `title` attribute
- [x] 4.5 Preserve empty/stale process states so restoring a project never silently runs a CLI or agent

## 5. Verification And Docs

- [x] 5.1 Add Rust unit tests for native profile seeding, provider/model catalog behavior, request metrics, permission-gated tool requests, audit records, and workspace restore state
- [x] 5.2 Add frontend tests for chat rendering, streamed turns, approval prompts, provider/model controls, request metrics display, project chat restore, and resizable panel persistence
- [x] 5.3 Run `npm run build` and targeted Rust checks/tests for changed Tauri services and commands
- [x] 5.4 Update `DESIGN.md`, `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md`, and `docs/DEVELOPMENT.md` for native harness, provider/model UX, workspace restore, and Dream attribution rules
- [x] 5.5 Smoke-test startup restore, new native chat, provider selection, denied approval, allowed approval, OMP chat compatibility, and stale terminal restore behavior in the desktop app
