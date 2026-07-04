# Tasks: Connector Permission Gateway

## 1. Gateway Contract And Storage

- [x] 1.1 Confirm `native-agent-loop` is merged; document its approval-gateway extension seams (rules schema, prompt components, audit trail, decision provenance) for connector scopes
- [x] 1.2 Define connector manifest fields, capability names, lifecycle states, event schemas, transport options, permission request shapes, and error codes
- [x] 1.3 Add SQLite migrations for connectors, capabilities, lifecycle state, provider claims, and sync sessions; extend the `native-agent-loop` rules/audit schema with connector identity scope (no parallel tables)
- [x] 1.4 Document local-first connector constraints and unsupported remote/plugin marketplace behavior

## 2. Backend Gateway And Permission Broker

- [x] 2.1 Implement connector registry service for manifest registration, enable/disable, validation, trust status, and project binding
- [x] 2.2 Implement connector lifecycle service for launch, attach, disconnect, restart, crash handling, and no-silent-startup restore
- [x] 2.3 Implement capability negotiation and typed unsupported-capability responses
- [x] 2.4 Implement permission-provider broker flows for commands, files, provider claims, chat sync, web UI/collab bridge, diagnostics, and analytics as extensions of the native tool-approval gateway (shared rules store, prompt cards, audit trail)
- [x] 2.5 Add connector grant revocation commands reusing the shared audit/rules surfaces
- [x] 2.6 Add thin Tauri command modules and `src/lib/*.ts` wrappers for connector registry, lifecycle, permissions, sync events, and provider claims

<!-- Verification notes (phase 1+2 PR #17):
  - models/connector.rs: ConnectorManifest, Connector, ConnectorState,
    ConnectorCapability, ConnectorPermissionRequest, ConnectorGrantDecision,
    ConnectorGrantScope, ProviderClaim, ConnectorEvent, ConnectorError.
  - storage_service.rs: connectors, connector_grants, provider_claims tables;
    shared audit_trail via connector scope (no parallel tables).
  - events.rs: CONNECTOR_EVENT channel.
  - connector_service.rs: register/list/get/set_enabled/set_state/delete,
    negotiate, resolve_permission, record_grant, revoke_grants, list_grants,
    claim_provider, approve/deny_claim, restore_on_startup (no auto-launch).
  - commands/connectors.rs: 11 Tauri commands wired into invoke_handler.
  - src/lib/connectors.ts: thin invoke wrappers + onConnectorEvent listener.
  - docs/agents/agent-runtime.md: Connector Permission Gateway section.
  - 9 Rust tests pass (state round-trip, capability round-trip, list empty,
    register+get, negotiate supported, negotiate disabled fails, restore
    marks disconnected, provider claim round-trip, grant record+revoke).
  - tsc --noEmit pass, npm run build pass, cargo check pass, cargo test pass.
-->

## 3. OMP Connector (phase 2 — next PR)

- [ ] 3.1 Build OMP connector registration/detection using existing OMP executable/version and project launch paths without modifying OMP
- [ ] 3.2 Attach OMP connector sessions to a single PTY/process association that can back both raw terminal and native projection views
- [ ] 3.3 Add OMP provider-claim detection where stable local behavior exists and route every claim through the permission-provider broker
- [ ] 3.4 Add OMP skills/commands/capability discovery where stable local behavior exists and mark unsupported native sync explicitly
- [ ] 3.5 Ensure disabling OMP connector does not uninstall OMP, edit OMP config, delete OMP credentials, or remove the standard OMP runtime profile

## 4. Frontend Connector UX

- [ ] 4.1 Add connector settings UI for registry entries, capabilities, enable/disable, lifecycle status, recent audit decisions, and grant revocation
- [ ] 4.2 Add permission prompts for connector command/file access, provider claims, chat sync, diagnostics, analytics, and web/collab bridge origins
- [ ] 4.3 Add OMP raw terminal/native projection toggle in the relevant workspace/chat/terminal surfaces with clear connector identity
- [ ] 4.4 Add provider-claim UI copy for cases like `OMP wants to add OpenAI subscription as a provider`
- [ ] 4.5 Add sync status indicators for connected, disconnected, unsupported, inferred, stale, and conflict states
- [ ] 4.6 Keep every interactive connector control tooltip-covered and styled through `src/styles/globals.css`

## 5. Web/Collaboration Bridge And Developer Example

- [ ] 5.1 Implement local bridge registration with explicit origin allowlists, data scopes, and permission prompts
- [ ] 5.2 Add a developer example connector that registers capabilities, emits test chat/terminal/provider events, and exercises permission prompts without network access
- [ ] 5.3 Document connector protocol, OMP connector behavior, provider claim ownership, web/collab bridge limits, and future connector onboarding

## 6. Verification

- [ ] 6.1 Add Rust tests for manifest validation, connector registration, capability negotiation, lifecycle transitions, grant decisions, audit records, and provider claims
- [ ] 6.2 Add Rust tests proving connector restore does not auto-launch OMP or any connector process on app startup
- [ ] 6.3 Add frontend tests for permission prompts, grant revocation, OMP raw/native toggle, connector status states, provider claim copy, and unsupported-capability rendering
- [ ] 6.4 Run `npm run build` and targeted Rust checks/tests for changed services/commands
- [ ] 6.5 Smoke-test OMP installed, OMP missing, provider claim allow, provider claim deny, raw terminal toggle, connector crash, connector disabled, and web/collab bridge blocked-origin scenarios
