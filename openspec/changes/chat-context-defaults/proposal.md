# Proposal: Chat Context Defaults

## Why

`Generate plans` → `Generate from context` currently closes the modal into a placeholder plan path instead of opening an agent conversation, so the user sees no new center tab, terminal, or chat. Basebuild also needs a durable product direction: OMP-first chat and terminal workflows today, with modular adapters for future Basebuild CLI, other CLIs, and IDE-backed chat surfaces.

## What Changes

- Route `Generate from context` into the workspace chat by default:
  - If a chat tab is already open in the active session, focus it and place the generated context prompt into the chat input.
  - If no chat tab is open, create a new chat tab, focus it, and place the generated context prompt into the chat input.
  - Do not auto-send the prompt unless an explicit user default allows it.
- Replace placeholder plan generation with an agent-launch workflow that uses the same chat surface users can inspect and edit.
- Formalize a modular agent runtime around OMP as the default adapter and Basebuild CLI as a first-class future adapter, without coupling the chat UI to one executable.
- Add settings for default terminal, default chat provider/adapter/model, prompt send behavior, and permission gates for commands or file/context access.
- Surface agent capabilities for skills, messages, chat, information, providers, and commands through typed frontend/backend APIs.
- Add privacy-first usage analytics foundations: analytics disabled until explicit opt-in, local-only collection separate from upload permission, redacted event taxonomy, export/delete controls, and permission audit trails.
- Add first-run foundation setup, integration health checks, action registry seams, and local data controls so future features share defaults, permissions, and availability checks from the start.
- Expand contributor guidance into `docs/agents/*`, then reduce root `AGENTS.md` to a minimal routing index that references the detailed workflow docs.
- Update implementation, testing, and design docs affected by the new chat/defaults/permissions workflow.

## Capabilities

### New Capabilities

- `agent-runtime-defaults` - persistent defaults and permission gates for terminal/chat agent execution.
- `agent-docs` - maintainable `docs/agents/*` documentation structure with root `AGENTS.md` as an index.
- `privacy-usage-analytics` - opt-in usage analytics, local analytics ledger, upload permissions, redaction rules, and permission audit trail.
- `foundation-platform` - first-run setup, capability health checks, action registry, and local data controls.

### Modified Capabilities

- `agent-chat` - OMP-first chat surface with reusable adapter capabilities and draft prompt injection.
- `plan-pipeline-ui` - `Generate from context` launches or focuses chat instead of silently creating placeholders.
- `desktop-shell` - chat becomes a default workspace tab target with deterministic focus behavior.

## Impact

- Frontend: `src/components/layout/AppShell.tsx`, `GeneratePlanModal.tsx`, `SettingsModal.tsx`, `WorkspaceTabs.tsx`, `src/components/panels/ChatPanel.tsx`, `src/lib/agent.ts`, `src/lib/sessions.ts`, `src/state/sessions.ts`, new settings/defaults state wrappers as needed.
- Backend: `src-tauri/src/services/agent_service.rs`, `storage_service.rs`, `session_service.rs`, new settings/defaults service/model/commands as needed, command registration in `src-tauri/src/lib.rs`.
- Data: local SQLite settings/defaults tables, permission/audit/analytics tables, runtime profile state, first-run setup state, and any session tab metadata needed for chat draft routing.
- Docs: root `AGENTS.md`, `DESIGN.md`, `docs/DEVELOPMENT.md`, `docs/SECRETS.md` if analytics/upload behavior is introduced, new `docs/agents/*`, and `.basebuild/project-schematic.md` if plan/chat model semantics change.
- Verification: unit tests for prompt routing/defaults/privacy gates, Rust checks for settings/agent/analytics services, typecheck/build, and UI visual verification with screenshot because this changes visible workflow.
