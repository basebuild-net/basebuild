# Design: Native Harness IDE Chat

## Context

Basebuild currently wraps terminal-first tools and has an adapter-oriented chat surface. The 1.0 direction needs a first-party harness/chat stack that can run without making OMP the only source of chat behavior, while still supporting OMP through a separate connector gateway. Dream is MIT licensed and contains relevant ideas for multi-agent chat, provider/model UX, tool approvals, git/file context, terminal/browser panes, and persistent project state. Basebuild remains Tauri + React + Rust + SQLite; Electron-specific Dream architecture is not adopted wholesale.

## Dream Review Notes

Reviewed upstream Dream MIT-license and representative modules before implementation: `electron/db/schema.ts` for project/chat/message persistence shape, `electron/api/chat-routes.js` and `electron/api/chat/schema.js` for provider/model/effort request metadata, `electron/api/provider-routes.js` for provider/model and usage-limit surfaces, `src/components/ide/ide-store.ts` and `src/components/ide/ide-shell.tsx` for project/chat/tab hydration, and the component directory layout under `src/components/ide` plus `src/components/ai-elements` for chat composition. No Dream source or assets are copied in this change; the implementation re-creates the useful concepts against Basebuild's Tauri/Rust/SQLite architecture and design system. MIT attribution becomes required only if a later edit copies or substantially adapts Dream code/assets.

## Goals / Non-Goals

**Goals**:
- Provide a Basebuild-native runtime profile that can own chat sessions, tool calls, approvals, skills, models, providers, and terminal/process orchestration.
- Deliver a polished chat workspace suitable as the default 1.0 interaction model: project-scoped history, multiple chats, rich output, model/provider controls, visible approvals, and recoverable errors.
- Support direct provider configuration through explicit local user consent, with no analytics or credential upload.
- Restore last focused project, active session/chat/tab, panel widths, and workspace mode on startup or project open.
- Simplify plans/inspector UI into a predictable supportable side panel with consistent icons, labels, tooltips, and resizable columns.
- Reuse/adapt Dream MIT-licensed concepts only with license preservation and dependency review.

**Non-Goals**:
- Replace the OMP connector or modify OMP itself.
- Add remote collaboration/cloud sync in this change.
- Adopt Electron, Drizzle, Hono, or Dream's backend runtime as Basebuild infrastructure.
- Store provider credentials in project files.
- Enable analytics collection or upload by default.

## Decisions

**Decision**: Implement the native harness as a new runtime profile backed by Rust services and SQLite state.  
**Rationale**: It keeps the existing profile abstraction and lets the same chat UI target native, OMP, Codex, Claude Code, or future adapters.  
**Alternatives**: Fork the OMP path or create a separate React app. That would duplicate UI state and make future connectors harder.

**Decision**: Use Dream as an MIT-licensed reference/adaptation source, not as an Electron subsystem import.  
**Rationale**: Dream's UI/provider/chat ideas are useful, but Basebuild's shell is Tauri, has local-first constraints, one stylesheet, and a different persistence stack.  
**Alternatives**: Vendor large Dream modules directly. That risks dependency bloat, architecture mismatch, and unclear maintenance ownership.

**Decision**: Store provider accounts and model selections as local metadata with secret material delegated to OS-secure storage or provider-owned CLIs where possible.  
**Rationale**: Provider UX must be first-class, but privacy and credential boundaries are load-bearing.  
**Alternatives**: Store all API keys in SQLite. That is simpler but weaker security posture.

**Decision**: Store OMP-stats-style request metrics in a dedicated local request ledger, separate from privacy analytics consent.  
**Rationale**: Users need local operational visibility per request — provider, model, effort, token counts, tokens/sec, TTFT, TTLT, duration, and outcome — even when remote analytics collection/upload remains disabled.  
**Alternatives**: Put these fields in generic analytics events. That loses queryability and confuses local observability with opt-in product analytics.

**Decision**: Model chat sessions independently from terminal tabs.  
**Rationale**: Native chat needs structured messages, tool events, approvals, model metadata, and resumable history that a PTY transcript cannot represent reliably.  
**Alternatives**: Treat chat as a decorated terminal. This breaks rich rendering, replay, model switching, and tool approval auditability.

**Decision**: Persist workspace restore state per project, with safe fallbacks when a process-backed tab is stale.  
**Rationale**: Restoring focus improves flow, but Basebuild must not silently spawn processes on startup.  
**Alternatives**: Always restore and spawn every previous tab. That violates no-silent-side-effects.

## Risks / Trade-offs

- Dream-derived code may introduce dependency, licensing, or architecture drift → Mitigation: copy/adapt only reviewed modules, preserve MIT notices, record attribution, and reject Electron-only abstractions.
- Native provider support can blur credential ownership → Mitigation: explicit consent prompts, local-only storage, audit entries, and no provider import without user action.
- Workspace restore can accidentally launch tools → Mitigation: restore UI selection and metadata first; require explicit user action to reconnect terminal/process-backed tabs.
- Chat rendering can become a second design system → Mitigation: use `src/styles/globals.css`, 0px radius, existing fonts/colors, and document any new primitives in `DESIGN.md`.
- Scope is large → Mitigation: land in milestones: data model, native runtime, chat UI, provider/model UX, workspace restore, polish, verification.

## Migration Plan

1. Add SQLite tables for native chat sessions/messages/tool events/provider metadata/model selections/approvals/workspace layout/request metrics with forward-compatible nullable columns.
2. Seed a `basebuild-native` runtime profile without changing the default adapter until the native harness passes smoke tests.
3. Implement native harness commands/services behind typed wrappers and feature-ready UI controls.
4. Add chat UI support for native structured messages while preserving OMP adapter compatibility.
5. Add provider/model settings and consent flows.
6. Add workspace restore and resizable panel persistence without auto-spawning stale process tabs.
7. Simplify plans/inspector UI and icon behavior after core chat behavior is working.
8. Switch the recommended/default profile only after verification; keep existing OMP profile selectable.

Rollback: keep migrations additive, preserve existing runtime profile settings, and allow users to switch default chat profile back to OMP or terminal-backed adapters.

## Open Questions

- Which provider credential backends are acceptable for 1.0 on Windows, macOS, and Linux: OS keychain only, CLI-owned credentials, or user-managed API keys?
- Should native chat use a provider SDK abstraction directly, a local JSON-RPC provider process, or a hybrid depending on provider?
- Which Dream components are worth adapting after license/dependency review, and which should be reimplemented against Basebuild's design system?
- Should last-focused chat restore globally or strictly per project/session?
