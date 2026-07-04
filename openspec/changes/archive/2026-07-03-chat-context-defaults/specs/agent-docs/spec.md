## ADDED Requirements

### Requirement: Agent Documentation Index
The repository SHALL keep root `AGENTS.md` minimal and route detailed maintainer instructions through `docs/agents/*`.

#### Scenario: Root agent guide is opened
- **WHEN** an agent or contributor reads `AGENTS.md`
- **THEN** it sees a concise project purpose, mandatory routing links, and the high-level invariants needed before selecting detailed docs

#### Scenario: Detailed docs are needed
- **WHEN** an agent needs implementation, testing, design, OpenSpec, runtime, or documentation workflow details
- **THEN** `AGENTS.md` points to the matching `docs/agents/*` document instead of embedding all details inline

### Requirement: Agent Workflow Documents
The repository SHALL document reusable agent workflows in focused files under `docs/agents/`.

#### Scenario: Testing guidance needed
- **WHEN** an agent changes UI, Rust services, settings/defaults, or adapter behavior
- **THEN** `docs/agents/testing.md` explains the required verification path, including typecheck/build, Rust checks, and screenshot-based UI verification for visual changes

#### Scenario: Runtime guidance needed
- **WHEN** an agent changes terminal/chat/CLI adapter behavior
- **THEN** `docs/agents/agent-runtime.md` explains OMP-first adapter rules, Basebuild CLI extensibility, permissions, and no-silent-side-effect constraints

#### Scenario: OpenSpec guidance needed
- **WHEN** an agent starts or applies planned work
- **THEN** `docs/agents/openspec.md` explains how to use `openspec/changes/*`, specs, design, and tasks for this repository

#### Scenario: Design guidance needed
- **WHEN** an agent changes UI or CSS
- **THEN** `docs/agents/design-system.md` points to `DESIGN.md`, central CSS constraints, tooltip rules, and screenshot verification

### Requirement: Documentation Consistency
The system SHALL update project documentation when agent runtime, plan pipeline, design, or testing conventions change.

#### Scenario: Runtime docs change
- **WHEN** adapter/defaults/permissions behavior changes
- **THEN** `docs/agents/agent-runtime.md`, `docs/DEVELOPMENT.md`, and any affected project schematic text are updated in the same change

#### Scenario: Design docs change
- **WHEN** settings, chat, or tab UI behavior changes visible design conventions
- **THEN** `DESIGN.md` and `docs/agents/design-system.md` are updated in the same change
