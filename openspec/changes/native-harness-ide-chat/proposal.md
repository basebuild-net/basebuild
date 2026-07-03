# Proposal: Native Harness IDE Chat

## Why

Basebuild needs a first-party AI coding harness and chat surface so it can work even when OMP or another CLI is not the active runtime. Dream demonstrates useful MIT-licensed patterns for multi-agent chat, provider/model selection, project tabs, git/files/terminal integration, and approval UX that can accelerate Basebuild's native 1.0 direction without replacing the existing Tauri/local-first architecture.

## What Changes

- Add a Basebuild-owned native agent harness that exposes chat, tool approvals, skills, model/provider selection, command execution, terminal bridging, and project context through the existing runtime-profile contract.
- Build a production-grade chat workspace inspired by Dream's MIT-licensed UI/runtime concepts: multiple project chats, rich message rendering, model picker, provider status, approvals, chat history, and side-by-side project context.
- Add Basebuild-native provider and model management that can use user-configured subscriptions or API keys only after explicit consent and local persistence.
- Improve 1.0 desktop workflow state: restore last focused project, last opened chat/session, active workspace tab, and panel widths when a project starts.
- Simplify the current right-side plan/inspector experience, fix icon inconsistencies, and make main columns/panels resizable while preserving the zero-radius design contract.
- Treat Dream as an MIT-licensed reference/adaptable source only after dependency review, license attribution, and Tauri integration review; do not wholesale-port Electron architecture into Basebuild.

## Capabilities

### New Capabilities

- `native-agent-harness` - Basebuild-owned agent runtime with chat, tools, skills, providers, models, approvals, and terminal/process orchestration.
- `native-chat-workspace` - first-party chat UI with project-scoped conversations, rich rendering, model/provider controls, history, approvals, and multi-chat workflows.
- `ide-workspace-state` - 1.0 desktop workspace persistence, resizable columns, simplified plans/inspector surfaces, and consistent icon behavior.

### Modified Capabilities

## Impact

- `src-tauri/src/services/agent_service.rs`, `settings_service.rs`, `terminal_service.rs`, `session_service.rs`, and new native harness/provider services for runtime orchestration, provider catalog state, approvals, and persisted chat sessions.
- `src-tauri/src/commands/agent.rs`, `settings.rs`, `sessions.rs`, `terminal.rs`, and new command modules for native harness/provider APIs.
- `src/lib/*.ts` thin wrappers for native chat, providers, models, approvals, and workspace state.
- `src/components/panels/ChatPanel.tsx`, `OmpPanel.tsx`, `TerminalPanel.tsx`, right-side panel components, workspace tabs, and `src/styles/globals.css` for the 1.0 chat/workspace UI.
- Local SQLite schema for provider metadata, model choices, chat sessions/messages, approvals, workspace layout, and last-focused project/chat state.
- `DESIGN.md`, `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md`, and `docs/DEVELOPMENT.md` for native harness, provider, workspace-state, and Dream-attribution behavior.
- Dream MIT license attribution if any source, UI assets, or substantial code patterns are copied or adapted.
