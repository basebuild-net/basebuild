# Tasks: Connector Permission Gateway

## 1. Gateway Contract And Storage

- [ ] 1.1 Define connector manifest fields, capability names, lifecycle states, event schemas, transport options, permission request shapes, and error codes
- [ ] 1.2 Add SQLite migrations for connectors, capabilities, lifecycle state, provider claims, grants, audit records, sync sessions, and web/collab bridge origins
- [ ] 1.3 Document local-first connector constraints and unsupported remote/plugin marketplace behavior

## 2. Backend Gateway And Permission Broker

- [ ] 2.1 Implement connector registry service for manifest registration, enable/disable, validation, trust status, and project binding
- [ ] 2.2 Implement connector lifecycle service for launch, attach, disconnect, restart, crash handling, and no-silent-startup restore
- [ ] 2.3 Implement capability negotiation and typed unsupported-capability responses
- [ ] 2.4 Implement permission-provider broker flows for commands, files, provider claims, chat sync, web UI/collab bridge, diagnostics, and analytics
- [ ] 2.5 Add audit trail storage and grant revocation commands for connector decisions
- [ ] 2.6 Add thin Tauri command modules and `src/lib/*.ts` wrappers for connector registry, lifecycle, permissions, sync events, and provider claims

## 3. OMP Connector

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
