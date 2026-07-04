# Design: Stabilize and Agent Chat

## Context

Basebuild Desktop has a functional shell but several core interactions are broken. Tab creation silently fails, files don't open, plans don't persist visibly, and the autonomous toolbar is premature. The app needs to stabilize into a VSCode-like shell before adding advanced agent features. A non-terminal agent chat is the first real agent integration.

## Goals / Non-Goals

**Goals**:
- Fix all broken core interactions (tabs, files, plans, sessions)
- Add right-click context menus on sessions
- Add agent chat panel with adapter architecture
- Remove autonomous toolbar
- Keep the public repo clean (gitignore openspec/.env)

**Non-Goals**:
- Full OMP feature parity in chat (streaming, tool calls, file diffs)
- Multi-agent orchestration
- Cloud sync or authentication
- Implementing Claude Code or Codex CLI adapters (just the architecture)

## Decisions

### Decision: Agent adapter trait in Rust
**Rationale**: Keeps agent-specific logic in the backend where PTY and process management already lives. The frontend stays generic.
**Alternatives**: Implement adapters in TypeScript - rejected because agent CLIs need process spawning and stdout streaming which belongs in Rust.

### AgentAdapter trait
```rust
pub trait AgentAdapter: Send + Sync {
    fn name(&self) -> &str;
    fn start(&self, cwd: &str) -> Result<()>;
    fn send(&self, message: &str) -> Result<()>;
    fn on_output(&self, callback: Box<dyn Fn(String) + Send>);
    fn stop(&self) -> Result<()>;
}
```

The `OhMyPiAdapter` spawns `omp` in interactive mode and communicates via stdin/stdout. Output is streamed to the frontend via Tauri events.

### Decision: Chat as a new tab kind
**Rationale**: Consistent with the existing tab model (terminal, file, empty/schematic). Chat tabs are first-class workspace citizens.
**Alternatives**: Chat as a side panel - rejected because chat needs full workspace width.

### Decision: Remove autonomy state entirely
**Rationale**: Autonomy is not implemented, the toolbar is non-functional, and it clutters the UI. When autonomy is ready it will live in the plan section.
**Alternatives**: Hide but keep state - rejected because dead state is confusing.

### Decision: Gitignore openspec/
**Rationale**: The openspec directory is planning scratch space that clutters the public repo. Keep the repo focused on source code.
**Alternatives**: Keep openspec public - rejected by user preference.

## Risks / Trade-offs

- **Agent chat is minimal**: First version won't support streaming or tool-use rendering. Mitigation: architecture is extensible; unsupported features surface as errors.
- **Removing autonomy state may break external references**: Mitigation: search all files and remove every reference.
- **Gitignoring openspec/**: Future contributors won't see planning artifacts. Mitigation: documented in CONTRIBUTING.

## Migration Plan

1. Fix tab creation bugs (immediate, no migration)
2. Remove autonomy toolbar and state (pure deletion)
3. Add context menus (additive)
4. Fix plan CRUD (bug fix, no migration)
5. Add agent chat (additive, new tab kind)
6. Gitignore openspec/ and .env

No database migrations needed. All changes are code-only.

## Open Questions

- Should agent chat support multiple concurrent sessions (one per tab)?
- Should the OMP adapter use the `omp` REPL or a direct API?
