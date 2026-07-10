# parallel-workspaces Specification

## ADDED Requirements

### Requirement: Workspace context is always visible
Every assigned/running chat and run-board row SHALL show project, branch, workspace/worktree path, plan, run state, and merge readiness. At compact sizes labels MAY collapse into a context control, but the information SHALL remain one click and keyboard action away. Sequential/non-Git fallback SHALL be explicitly labeled.

#### Scenario: Four worktree workers are open at compact size
- **WHEN** four plan chats run in isolated worktrees at 960×640
- **THEN** each panel identifies its distinct branch/worktree and plan without clipping the composer, and the run board exposes full paths and merge readiness
