## MODIFIED Requirements

### Requirement: Per-chat header
Each chat column in a grid SHALL render a compact, flat header above its conversation showing: the chat title (inline-editable on double-click), active runtime/engine, provider/model chip, effort level chip, agent-mode pill, queue/run state, current branch and worktree indicator, assigned-plan/OpenSpec-change badge (when bound), a history toggle, and a `…` more-actions menu. The header is a sibling of the scroll region, never scrolls out of view, and uses 0px radius and `title=` tooltips on every interactive element. Detailed progress and context usage MAY move to the context strip under the input to keep the header uncluttered.

#### Scenario: Header shows current model and runtime
- **WHEN** a chat column is open with runtime `native`, provider `umans`, and model `umans-glm-5.2` selected
- **THEN** the header displays runtime/model chips with full ids in `title` tooltips, and clicking the model chip opens the model picker

#### Scenario: Inline rename
- **WHEN** the user double-clicks the chat title in the header
- **THEN** the title becomes an editable input pre-filled with the current title; on Enter or blur the new title is saved with `title_locked` set so auto-titling never overwrites it; on Escape the rename is cancelled

#### Scenario: Header stays visible during scroll
- **WHEN** the user scrolls a long conversation in a chat column
- **THEN** the header remains pinned at the top of the chat column and the conversation scrolls beneath it

#### Scenario: Assigned-plan badge
- **WHEN** a chat has an active OpenSpec-backed plan assigned
- **THEN** the header shows a plan/change badge with reference id, truncated title, status, and a tooltip with full title/change path; clicking it opens the plan in the Planning modal

#### Scenario: Header does not crowd the transcript
- **WHEN** model, plan, branch, queue, and worktree metadata are all present
- **THEN** the header keeps one row where possible and moves overflow detail to tooltips, the context strip, or `…` menu rather than adding a second noisy metadata row

### Requirement: Branch and worktree display
The chat header and context strip SHALL display the project's current git branch and, when the chat is running inside a worktree provisioned by `parallel-workspaces`, the worktree indicator and workspace id. The display is read-only metadata until the user invokes an explicit branch/worktree action.

#### Scenario: Project on main with no worktree
- **WHEN** a chat column is open on a project whose current branch is `main` and no worktree is active
- **THEN** the header shows `main` with a branch icon and no worktree indicator

#### Scenario: Chat running in a worktree
- **WHEN** a chat column is open on a plan run provisioned in worktree `.basebuild/worktrees/bb-x7k2p1-add-dark-mode` on branch `bb/x7k2p1-add-dark-mode`
- **THEN** the header/context strip shows `[worktree]`, branch `bb/x7k2p1-add-dark-mode`, and workspace id/path in `title` tooltips

#### Scenario: Non-git project
- **WHEN** a chat column is open on a project that is not a git repository
- **THEN** the header shows no branch/worktree error and the context strip labels execution as `primary workspace` when applicable

### Requirement: More-actions menu
The chat header SHALL provide a `…` more-actions menu with entries: Rename, Assign plan, Duplicate chat, Close chat, Close chat and delete session, Open OpenSpec change (when assigned), Show worktree, and (when a worktree run has finished) Create pull request. Every entry has a `title` tooltip. Destructive entries, remote-writing entries, and worktree prune actions require explicit confirmation.

#### Scenario: Open more-actions menu
- **WHEN** the user clicks `…` in a chat header
- **THEN** a simple flat menu appears with applicable actions and no unrelated planning/file/source clutter

#### Scenario: Open linked OpenSpec change
- **WHEN** a chat has an assigned OpenSpec change and the user chooses `Open OpenSpec change`
- **THEN** the app opens the change artifacts in the file/modal surface without launching a run

#### Scenario: Assign plan from menu
- **WHEN** the user picks `Assign plan` and selects a `ready` plan
- **THEN** the plan is assigned to this chat per the `plan-chat-assignment` capability and the run starts or queues in this chat
