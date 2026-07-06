# chat-header-context Specification

<!-- Merges: ADDED from 'parallel-plan-workspaces' (archived 2026-07-06). -->

## Requirements

### Requirement: Per-chat header
Each chat column in a grid SHALL render a compact header above its conversation showing: the chat title (inline-editable on double-click), the active provider/model chip, the effort level chip, the agent-mode pill, the current branch and worktree indicator, an assigned-plan badge (when a plan is bound), a history toggle, and a more-actions menu. The header is a sibling of the scroll region, never scrolls out of view, and uses 0px radius and `title=` tooltips on every interactive element.

#### Scenario: Header shows current model
- **WHEN** a chat column is open with provider `umans` and model `umans-glm-5.2` selected
- **THEN** the header displays a chip labeled `umans-glm-5.2` with the full model id in its `title` tooltip, and clicking the chip opens the model picker

#### Scenario: Inline rename
- **WHEN** the user double-clicks the chat title in the header
- **THEN** the title becomes an editable input pre-filled with the current title; on Enter or blur the new title is saved with `title_locked` set so auto-titling never overwrites it; on Escape the rename is cancelled

#### Scenario: Header stays visible during scroll
- **WHEN** the user scrolls a long conversation in a chat column
- **THEN** the header remains pinned at the top of the chat column and the conversation scrolls beneath it

#### Scenario: Assigned-plan badge
- **WHEN** a chat has an active plan assigned
- **THEN** the header shows a plan badge with the plan reference id and title (truncated), the plan status, and a `title` tooltip with the full title; clicking it opens the plan in the Planning Inspector

### Requirement: Branch and worktree display
The chat header SHALL display the project's current git branch and, when the chat is running inside a worktree provisioned by `parallel-workspaces`, the worktree indicator. The display is read-only metadata; switching branches is a separate explicit action.

#### Scenario: Project on main with no worktree
- **WHEN** a chat column is open on a project whose current branch is `main` and no worktree is active
- **THEN** the header shows `⎇ main` (or equivalent branch icon + name) and no worktree indicator

#### Scenario: Chat running in a worktree
- **WHEN** a chat column is open on a plan run provisioned in worktree `.basebuild/worktrees/bb-x7k2p1-add-dark-mode` on branch `bb/x7k2p1-add-dark-mode`
- **THEN** the header shows `[worktree] [bb/x7k2p1-add-dark-mode]` with the worktree path in the `title` tooltip, so the user can immediately see which isolated workspace this chat is operating in

#### Scenario: Non-git project
- **WHEN** a chat column is open on a project that is not a git repository
- **THEN** the header shows no branch and no worktree indicator, and no error is surfaced

### Requirement: Manual branch switch dropdown
The chat header SHALL provide a branch dropdown that lists all local branches (via `git_branch_list`) and lets the user switch the active branch (via `git_branch_switch`). Switching branches is an explicit user action; the system SHALL NOT auto-switch branches on chat creation or tab activation. Uncommitted changes SHALL prompt for confirmation before switch.

#### Scenario: Open branch dropdown
- **WHEN** the user clicks the branch chip in a chat header
- **THEN** a dropdown lists all local branches with the current branch marked, and a "Create branch…" entry at the bottom

#### Scenario: Switch to an existing branch
- **WHEN** the user picks `feature-x` from the branch dropdown
- **THEN** the system calls `git_branch_switch` for the project path with `feature-x`, the header updates to `⎇ feature-x`, and the chat continues running in the new branch's working tree

#### Scenario: Uncommitted changes block switch
- **WHEN** the user attempts to switch to another branch while the working tree has uncommitted changes
- **THEN** a confirmation prompt lists the changed file count and offers "Stash & switch", "Cancel", and (if applicable) "Discard & switch"; on confirm the appropriate git action runs before the switch

#### Scenario: Create new branch from dropdown
- **WHEN** the user picks "Create branch…" from the dropdown and enters a name
- **THEN** the system calls `git_branch_create` then `git_branch_switch`, and the header updates to the new branch

### Requirement: Agent-mode pill
The chat header SHALL display the current agent mode (e.g. `plan` vs `build`) as a pill that toggles on click, mapping to the underlying permission modes through the existing approval gateway. The pill's `title` tooltip describes the current mode's permission posture.

#### Scenario: Toggle from plan to build
- **WHEN** the user clicks the `plan` pill in a chat header
- **THEN** the pill switches to `build`, the chat's permission rules update to the build-mode posture (allow-edits), and the tooltip updates to describe the new posture

#### Scenario: Mode persists across sessions
- **WHEN** the user sets a chat to `build` mode and restarts the app
- **THEN** the restored chat header shows the `build` pill and the permission rules reflect build mode

### Requirement: More-actions menu
The chat header SHALL provide a more-actions menu (`⋯`) with entries: Rename, Assign plan, Duplicate chat, Close chat, Close chat and delete session, and (when a worktree run has finished) Create pull request. Every entry has a `title` tooltip. Destructive entries (delete session) and remote-writing entries (create pull request) require explicit confirmation.

#### Scenario: Open more-actions menu
- **WHEN** the user clicks `⋯` in a chat header
- **THEN** a menu appears with Rename, Assign plan, Duplicate chat, Close chat, Close chat and delete session entries, each with `title` tooltips

#### Scenario: Delete session requires confirmation
- **WHEN** the user picks "Close chat and delete session"
- **THEN** a confirmation prompt appears warning that the chat history will be permanently deleted; on confirm the chat column animates out and the session row is deleted from the database

#### Scenario: Duplicate chat
- **WHEN** the user picks "Duplicate chat"
- **THEN** a new chat column is added beside the current one with a copy of the current chat's provider/model/effort/agent-mode settings but an empty conversation, ready for a fresh turn

#### Scenario: Assign plan from menu
- **WHEN** the user picks "Assign plan" and selects a `ready` plan
- **THEN** the plan is assigned to this chat per the `plan-chat-assignment` capability and (when allowed) the run starts in this chat
