# Design: Connector Permission Gateway

## Context

Basebuild currently treats OMP as the primary CLI integration and already models runtime profiles, capabilities, permission rules, and audit behavior. The desired 1.0 system needs a broader application layer where OMP and future tools can plug into Basebuild's UI without being modified. Connectors must be local-first, permissioned, auditable, and able to expose either native UI data or a raw terminal/web surface depending on what the underlying tool supports.

## Goals / Non-Goals

**Goals**:
- Define a connector gateway for local IDE/CLI/tool integrations with manifests, capability negotiation, lifecycle, project binding, and typed events.
- Support OMP as the first connector without changing OMP itself.
- Let users toggle between raw OMP terminal and Basebuild-native UI projections of OMP sessions where supported.
- Prompt before importing or registering providers from connector-owned auth state, e.g. "OMP wants to add OpenAI subscription as a provider".
- Gate connector command execution, file access, provider claims, chat sync, web/collab embedding, diagnostics, and analytics through one permission broker.
- Provide a path for Claude Code, Codex, Pi, OpenCode, Cursor Agent, Dream-derived systems, and other local IDE/CLI connectors.

**Non-Goals**:
- Modify OMP or require upstream OMP protocol changes for the first version.
- Build a remote plugin marketplace.
- Allow unreviewed remote code execution.
- Upload chat content, prompt text, source code, provider credentials, terminal output, or diagnostics by default.
- Replace the native harness implementation; this gateway is the integration layer for external tools.

## Decisions

**Decision**: Use a local connector manifest plus capability negotiation model.  
**Rationale**: Basebuild needs to know what each tool can safely expose before rendering UI or offering actions.  
**Alternatives**: Hardcode each tool into React components. That blocks future connectors and duplicates permission logic.

**Decision**: Build the permission broker on the tool-approval gateway substrate shipped by `native-agent-loop` (same approval modes, rules storage, prompt cards, and audit trail), adding connector identity and capability as scope dimensions.
**Rationale**: One permission system. Two parallel prompt/rules/audit stacks would drift, double the settings UI, and teach users two mental models for the same question ("may this actor do X?").
**Alternatives**: Standalone connector-only broker as originally drafted — rejected once `native-agent-loop` was planned; it would duplicate the entire rules/audit layer.

**Decision**: Keep connectors out-of-process and communicate through local IPC/stdio/loopback channels with strict allowlists.  
**Rationale**: External tools should remain independently installable and crash-isolated, while Basebuild controls permissions and UI projection.  
**Alternatives**: Load connector code directly into the Tauri process. That increases crash/security risk and makes third-party connector support harder.

**Decision**: Make provider claims separate from provider credentials.  
**Rationale**: OMP or another tool may know that a provider subscription exists, but Basebuild must not silently adopt credentials or send provider requests without consent.  
**Alternatives**: Auto-import connector provider state. That violates privacy and permission expectations.

**Decision**: Treat raw terminal and native projection as two views over a connector session, not as separate sessions.  
**Rationale**: Users need to debug/control the underlying tool while still benefiting from Basebuild UI sync.  
**Alternatives**: Launch one process for terminal and another for native chat. That risks duplicated side effects and inconsistent state.

**Decision**: Represent web/collab integration as a local bridge with explicit origin and data permissions.  
**Rationale**: Browser-accessible tool UIs can be useful, but embedding/syncing them can leak data if origins and scopes are implicit.  
**Alternatives**: Embed arbitrary localhost/web URLs. That is too broad for a permissioned desktop control plane.

## Risks / Trade-offs

- OMP may not expose structured state for every feature → Mitigation: first version supports raw terminal plus best-effort detection/sync and explicitly marks unsupported capabilities.
- Connector protocol can become too abstract → Mitigation: validate the contract with OMP first, then one second connector before declaring stable.
- Provider prompts can annoy users → Mitigation: support persistent scoped grants, clear copy, and audit visibility, while defaulting to ask.
- Web/collab bridge can widen attack surface → Mitigation: local origins only by default, explicit origin allowlists, no credential injection, and clear user consent.
- Tool state can drift from Basebuild state → Mitigation: connector events carry revision/timestamp/source metadata and UI shows sync confidence/errors.

## Migration Plan

1. Extend the `native-agent-loop` approval rules/audit schema with connector identity scope; add connector registry tables with additive migrations.
2. Implement connector manifest parsing, capability negotiation, lifecycle state, and audit logging behind backend services.
3. Add OMP connector wrapper using existing OMP launch/detection paths and raw terminal process ownership.
4. Add native projection events for whatever OMP can safely expose first: availability, sessions, provider claims, skills/commands, and terminal status.
5. Add permission prompts for provider claims, command/file access, chat sync, diagnostics, and web/collab bridge origins.
6. Add frontend connector settings, raw/native toggle, provider claim prompt, and sync status surfaces.
7. Document connector protocol and add at least one developer example/stub connector.

Rollback: connectors are additive. Disable connector registry entries and fall back to existing runtime profiles/terminal tabs without deleting stored grants or audit records.

## Open Questions

- Should the first connector protocol be JSON-RPC over stdio, named pipes, loopback HTTP/WebSocket, or a small set of transport adapters?
- Which OMP features are available through stable CLI/API surfaces versus only terminal observation?
- What grant scopes are needed: once, session, project, connector, provider, global, or time-limited?
- How should Basebuild display sync confidence when a connector exposes partial or inferred state?
