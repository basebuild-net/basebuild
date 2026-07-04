## ADDED Requirements

### Requirement: Worktree-backed workspaces
The system SHALL create isolated workspaces for concurrent plan runs using `git worktree`, each on a fresh branch named from the plan reference (`bb/<reference-id>-<slug>`), located under a managed directory outside the primary checkout. Workspaces SHALL be listed with their plan, branch, and path, and SHALL be removable (prune) after their run reaches a terminal state.

#### Scenario: Parallel runs get separate worktrees
- **WHEN** the queue starts two plans concurrently with workspaces enabled
- **THEN** each run's session and final touches execute in a distinct worktree on its own branch, and the primary checkout is untouched

#### Scenario: Prune after completion
- **WHEN** a run finishes and the user prunes its workspace
- **THEN** the worktree is removed via git (never bare directory deletion), the branch is kept, and pruning a workspace with uncommitted changes requires explicit confirmation

### Requirement: Graceful degradation
When the project is not a git repository, worktrees are unsupported, or workspaces are disabled, concurrent runs SHALL fall back to sequential execution in the primary checkout with a visible notice.

#### Scenario: Non-git project
- **WHEN** the user sets concurrency 4 on a non-git project
- **THEN** the queue runs plans sequentially in place and the profile UI shows why parallelism is unavailable
