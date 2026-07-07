# parallel-workspaces Specification

<!-- Merges: MODIFIED from 'parallel-plan-workspaces' (archived 2026-07-06). -->

## Requirements
### Requirement: Worktree-backed workspaces
The system SHALL create isolated workspaces for concurrent plan runs using `git worktree`, each on a fresh branch named from the plan reference (`bb/<reference-id>-<slug>`) branched from the repository's default branch (auto-detected `main`/`master`) after fetching the remote, located under a managed directory outside the primary checkout. The worktree SHALL be created when the run starts (not at plan assignment). After the run reaches a terminal state the worktree and branch SHALL be retained until the user explicitly prunes; the branch is always kept even after prune. Workspaces SHALL be listed with their plan, branch, and path, and the chat header of a chat running in a worktree SHALL display the worktree indicator and branch.

#### Scenario: Parallel runs get separate worktrees
- **WHEN** the queue starts two plans concurrently with workspaces enabled
- **THEN** each run's session and final touches execute in a distinct worktree on its own branch, the primary checkout is untouched, and each run's auto-provisioned chat column header shows `[worktree] [bb/<ref>-<slug>]`

#### Scenario: Branch is based on the fetched default branch
- **WHEN** a run starts on a git project whose default branch is `main`
- **THEN** the system fetches the remote, detects the default branch, and creates `bb/<ref>-<slug>` from the fetched default branch tip (not from whatever branch was previously checked out), so each run starts from up-to-date `main`

#### Scenario: Fetch unavailable falls back to local default
- **WHEN** a run starts but the remote fetch fails (offline or no remote configured)
- **THEN** the branch is created from the local default branch tip, and the chat surfaces a non-blocking notice that the base may be stale

#### Scenario: Worktree retained until pruned
- **WHEN** a run reaches `finished` (or `cancelled`)
- **THEN** its worktree and branch remain on disk for review, listed in the workspaces view, and are removed only when the user explicitly prunes

#### Scenario: Prune after completion
- **WHEN** a run has reached a terminal state and the user prunes its workspace
- **THEN** the worktree is removed via git (never bare directory deletion), the branch is kept, and pruning a workspace with uncommitted changes requires explicit confirmation

#### Scenario: Manual branch switch from chat header
- **WHEN** the user opens the branch dropdown in a chat header and switches to another existing local branch
- **THEN** the system calls `git_branch_switch` for the project path, the chat header updates to the new branch, and no worktree is auto-created or auto-pruned by the switch

### Requirement: Graceful degradation
When the project is not a git repository, worktrees are unsupported, or workspaces are disabled, concurrent runs SHALL fall back to sequential execution in the primary checkout with a visible notice. The chat header SHALL show no worktree indicator and no branch indicator in this case, and no pull-request recommendation SHALL be offered.

#### Scenario: Non-git project
- **WHEN** the user assigns plans to two chats on a non-git project
- **THEN** the runs execute sequentially in place, the UI shows why parallelism and worktrees are unavailable, and chat headers in this project show no branch or worktree indicator
