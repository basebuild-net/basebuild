# Proposal: Stabilize and Agent Chat

## Why

The app's core interactions are broken: clicking "+" to create terminal/schematic tabs does nothing, files don't open in tabs, plans don't work, and session context menus are missing. The autonomy toolbar is premature and clutters the workspace. The app needs to be a stable, VSCode-like shell for AI agent workflows before any advanced features are added.

## What Changes

### Bug fixes
- Fix tab creation: clicking "+" → Terminal and "+" → Schematic must create and switch to the new tab
- Fix file opening: clicking a file in the Files panel must open it in a workspace tab
- Fix plan creation/editing: plans must persist and update in the side panel
- Fix plan status transitions: moving plans through draft → in_progress → finished must work
- Remove the AutonomousToolbar from the workspace tab bar (moved to plan section as future feature)

### Session context menu
- Right-click a session in the sidebar → context menu with: Rename, Delete, Duplicate
- Right-click a project → context menu with: New Session, Open in Explorer, Hide, Remove

### Generate plans with file selection
- Generate Plan modal gets a "Select context file" button that opens a file picker
- Selected file content is read and included as context for plan generation
- Validation: if no project schematic and no file selected, show a warning

### Agent chat (new capability)
- Add a non-terminal chat panel that communicates with OMP (or any CLI agent) via structured RPC
- Architecture is agent-agnostic: an `AgentAdapter` trait/interface with `OhMyPiAdapter` as the first implementation
- Chat messages render as a scrollable list (user + assistant turns)
- Unsupported OMP features are caught and surfaced in the error UI as "unsupported" errors
- Chat tab kind added to workspace tabs alongside terminal/file/schematic

### Cleanup
- `.gitignore` the `openspec/` directory and `.env` files to keep the public repo clean
- Remove all `autoMode`, `autoCommit`, `autoPr`, `autoGroupPr`, `autoAgents` state from AppShell

## Capabilities

### New Capabilities
- `agent-chat` - non-terminal agent chat panel with adapter architecture for multiple CLI agents

### Modified Capabilities
- `desktop-shell` - tab creation, context menus, autonomy removal, file opening
- `plan-pipeline-ui` - file selection for plan generation, plan CRUD fixes
