# Proposal: Connector Permission Gateway

## Why

Basebuild should make OMP, Claude Code, Codex, Pi, and future AI IDEs/CLIs feel native in the UI without forking or modifying those tools. A connector/plugin gateway with explicit permissions lets external tools sync chats, providers, skills, terminals, and collaboration surfaces into Basebuild while preserving local-first privacy and preventing silent side effects.

## What Changes

- Add a connector/plugin gateway that external tools can use to register capabilities, lifecycle state, project bindings, chat surfaces, provider claims, skills, commands, and raw terminal access.
- Treat OMP as the first supported extension: Basebuild can detect/run OMP as-is, toggle between native UI chat and raw OMP terminal, and sync supported OMP capabilities through the gateway.
- Extend the native tool-approval gateway (shipped by `native-agent-loop`) into a connector permission/moderation layer: one approval substrate (modes, rules, prompts, audit trail) with connector identity as an additional scope dimension, covering provider additions such as "OMP wants to add OpenAI subscription as a provider", command execution, file access, chat sync, external web UI/collaboration access, diagnostics, and analytics.
- Define a supportable web-UI/collaboration bridge so tools with browser-accessible chat or collab systems can be embedded or synchronized only after local permission checks.
- Make the gateway extensible for future connectors such as Claude Code, Codex, Pi, OpenCode, Cursor Agent, Dream-derived native systems, and local IDE integrations.
- Keep underlying tools unmodified; Basebuild wraps, observes, launches, and communicates through documented connector boundaries.
- **Depends on** `native-agent-loop`: its approval modes, rules storage, prompt components, and audit trail must be merged before this change starts; the broker builds on those seams rather than redefining them.

## Capabilities

### New Capabilities

- `connector-plugin-gateway` - local connector registry, manifests, lifecycle, capability negotiation, IPC, and extension isolation for external tools/IDEs/CLIs.
- `permission-provider-broker` - centralized prompts, rules, audits, and consent flows for provider imports, command/file access, chat sync, web UI embedding, diagnostics, and analytics. Extends the `tool-approval-gateway` capability from `native-agent-loop`; introduces no second rules store, prompt stack, or audit trail.
- `external-tool-sync` - project, chat, terminal, skill, model/provider, and collaboration sync between Basebuild and supported external tools.
- `omp-extension-integration` - first-class OMP connector that works without modifying OMP and supports raw terminal toggle plus native UI synchronization.

### Modified Capabilities

## Impact

- New `src-tauri/src/services/*` connector gateway, permission broker, provider-claim broker, OMP connector, and web/collab bridge services.
- New `src-tauri/src/commands/*` command modules for connector registration, lifecycle, permissions, provider claims, sync events, and raw terminal/native UI switching.
- Existing `settings_service.rs`, `agent_service.rs`, `terminal_service.rs`, `omp_service.rs`, `session_service.rs`, and storage migrations for connector manifests, grants, audit records, synced sessions, and provider claims.
- `src/lib/*.ts`, `src/state/*`, `ChatPanel`, `TerminalPanel`, `OmpPanel`, settings/provider UI, workspace tabs, and side panels for connector capability display, consent prompts, raw/native toggles, and sync states.
- Local IPC or loopback-only connector protocol documentation and developer-facing examples.
- `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md`, `docs/DEVELOPMENT.md`, and `.basebuild/project-schematic.md` if connector semantics change the high-level project model.
