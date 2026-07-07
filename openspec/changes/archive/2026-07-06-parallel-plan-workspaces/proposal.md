# Proposal: parallel-plan-workspaces

## Why

Today the center workspace shows one chat at a time and plans run one-by-one
through a queue. There is no way to watch several agents work in parallel, no
explicit "assign this plan to this chat and run it in its own branch", and no
built-in push-toward-a-PR when a run finishes. Users running multi-plan work
have to babysit a single serial queue and reconcile branches by hand.

This change builds a full parallel-work surface: a multi-chat **grid** (any
`M×N` layout) inside persistent workspace **tabs**, a ported polished chat
harness (model / effort / branch / agent-mode controls, dropdowns, and
transcript rendering modeled on the [dream IDE](https://github.com/dreamide/dream)
as the visual reference), and a plan→chat→worktree→PR pipeline: assign a
`ready` plan to a chat, it runs on a fresh branch off up-to-date `main` in its
own git worktree, several such runs proceed concurrently under per-provider
concurrency caps, and when a run finishes the chat recommends opening a pull
request.

Depends on `chat-first-shell` (in flight): that change centers the shell on
the conversation; this change layers the multi-chat grid, per-chat harness,
and worktree/plan orchestration on top of that center after it merges.

## What Changes

### Multi-chat grid + tabs
- Render a chat tab as a **grid container** holding N chat columns with
  `1×N` and `M×N` layouts, no fixed cap (viewport-bounded); drag-reorder,
  drag-resize splitters (column widths + row heights), animated close.
- Each workspace **tab holds its own grid**; a `1×2` tab and a `1×3` tab
  coexist; grid membership, order, and sizes persist per tab across restarts.
- Port the chat harness UI (adapted to `globals.css`, 0px radius, no Radix,
  no CSS modules): per-chat **header** (title inline-rename, model/effort
  chips, branch + worktree indicator, agent-mode pill, plan badge,
  more-actions), the **compact composer rail**, and reasoning/tool-card
  transcript rendering.

### Branch + worktree in the chat header
- Show `[worktree] [branch]` in each chat header; read-only display plus a
  **manual** branch switch / create dropdown (reuses `git_branch_list` /
  `git_branch_switch` / `git_branch_create`). No auto-switch on
  create/restore.

### Plan → chat → worktree → PR pipeline
- **Assign** a `ready` plan to a chat column (empty or free-form). One active
  plan per chat; re-assign confirms + restarts.
- Assignment **provisions a worktree on run start**: fresh branch
  `bb/<ref>-<slug>` from the **freshly fetched default branch** (`main`/
  `master`, auto-detected), seeds the chat from the plan + schematic, binds
  one model, streams the run in that chat column, and keeps the worktree +
  branch until the user prunes.
- **Concurrent runs**: multiple chats each run their own assigned plan at
  once, each in its own worktree/branch.
- **PR recommendation on finish**: when a worktree run finishes, the chat
  recommends opening a pull request — `gh pr create` when `gh` is installed +
  authed, otherwise push branch + open the GitHub compare URL. Always
  explicit + confirmed; never auto-pushed.

### Per-provider concurrency governance
- New **per-provider max-concurrency** setting (global default + per-project
  override), default `1` (one model per chat). The scheduler queues runs
  beyond a provider's cap rather than failing.
- **Subagents off by default**; opt-in with a configurable max count
  (global + project). Subagent *execution* stays owned by the in-flight
  `harness-subagents` change; this change owns the *governance* (permit +
  count, counted against provider caps).

### New Capabilities
- `chat-grid-layout` — multi-chat grid container: add/remove/reorder/resize
  columns and rows, `M×N` layouts, per-tab persistence, mount/close animation.
- `chat-header-context` — per-chat header: title rename, model/effort chips,
  branch + worktree display, branch switch dropdown, agent-mode pill, plan
  badge, more-actions menu.
- `plan-chat-assignment` — assign a `ready` plan to a chat; one active plan
  per chat; provision worktree on run start; concurrent runs; PR
  recommendation on finish.
- `run-concurrency-limits` — per-provider max concurrency (global + project),
  subagent enable + count governance, scheduler enforcement, settings surface.

### Modified Capabilities
- `desktop-shell` — chat tabs become grid containers; workflow chat targeting
  addresses chat columns.
- `ide-workspace-state` — persist/restore per-tab grid layout (membership,
  widths, rows); restored worktree runs are never auto-resumed.
- `agent-chat` — the chat panel renders inside a grid column with a per-chat
  header and composer rail; draft injection targets a specific column.
- `chat-composer-controls` — the rail is the ported per-column rail; the
  single-line / truncation / setup-state / tooltip contract is preserved.
- `chat-model-defaults` — per-column provider/model/effort; project default
  follows the most recently changed column.
- `parallel-workspaces` — worktree base is the fetched default branch; created
  on run start; retained until prune; surfaced in the chat header; manual
  branch switch added.
- `plan-run-queue` — concurrency governed by `run-concurrency-limits`
  (per-provider caps, not a single `N`); runs surface as grid columns; an
  assigned chat is reused instead of minting a new column.
- `plan-final-touches` — the open-pull-request step uses `gh` CLI or the
  browser compare URL, explicit + confirmed, no stored token.

## Impact

- **Frontend**:
  - `WorkspaceTabs.tsx` — chat tab renders a `ChatGrid` (not a single panel).
  - New: `ChatGrid.tsx`, `ChatHeader.tsx`, `ChatComposerRail.tsx`,
    `PrRecommendationCard.tsx`, `AssignPlanMenu.tsx`.
  - `ChatPanel.tsx` — slimmed to conversation + message rendering; header and
    rail extracted.
  - `src/state/sessions.ts` — tabs gain a `grid` field (ordered chat ids,
    column widths, row layout); chats gain `assignedPlanId`, `worktreePath`,
    `branch`, `agentMode`.
  - `src/lib/git.ts` — reuse existing branch commands; add thin wrappers for
    worktree list/prune, default-branch detection, `gh`-availability probe,
    push, and compare-URL construction (backend commands).
  - `src/lib/settings.ts` — per-provider concurrency + subagent limits.
  - `src/styles/globals.css` — grid, splitters, header, rail, PR card,
    concurrency settings classes; audit against the 400-line goal.
- **Backend (Rust)**:
  - `worktree_service.rs` — default-branch detection + remote fetch before
    branch creation; create-on-run-start; keep-until-prune; list/prune.
  - `plan_runner_service.rs` — per-provider concurrency scheduler replacing a
    single `N`; assigned-chat binding; queue-on-cap.
  - New: `pull_request_service.rs` — `gh` detection, `gh pr create`, branch
    push, compare-URL construction; no token stored.
  - Settings model — per-provider concurrency + subagent counts (global +
    project); commands validate and map errors; one service per domain.
- **Dependencies**: none added. dream's Radix/zustand/ai-sdk stack is **not**
  adopted; only its layout logic and visual structure are ported into the
  existing React + `globals.css` stack.
- **Tests**: Playwright e2e for grid add/remove/reorder/resize + per-tab
  persistence + assign→run→PR-recommend flow (mocked git/gh); unit tests for
  grid width clamping, reorder index math, per-provider scheduler, and
  default-branch detection.
- **Security / trust boundaries**:
  - Worktree creation, branch switch, push, and PR creation are
    explicit-user-action and (for remote writes) confirm-gated — no silent
    side effects (AGENTS.md Invariant 5).
  - `gh` is invoked via the hidden-process helper (`CREATE_NO_WINDOW`); no
    credential is stored by this change — `gh`'s own auth is used, or the
    browser handles auth.
  - No new network upload of user data; the only new outbound actions are the
    user-confirmed git push and PR creation.
  - Untrusted plan/idea text is never executed as a shell command; it seeds
    prompt context only.
- **Depends on**: `chat-first-shell` merged. Coordinates with
  `harness-subagents` (subagent execution) and `file-viewer-editor` /
  `diff-review-workflow` (the run's diff review before the PR step).
