# Design: parallel-plan-workspaces

## Context

The current center workspace renders one `ChatPanel` per active chat tab.
`chat-first-shell` (in flight) reshapes the shell around a single-column chat
center with a left project/chat column and a floating environment block. This
change layers a multi-chat **grid** on that center and wires an explicit
plan→chat→worktree→PR pipeline.

Reference implementation for the chat harness and grid is the
[dream IDE](https://github.com/dreamide/dream) (MIT). dream is Electron +
zustand + Radix UI + Vercel `ai` SDK; basebuild is Tauri v2 + React 18 +
`globals.css`-only (0px radius, no CSS modules, no UI-primitive library). We
**port the layout logic and visual structure**, not the files or their
dependencies. Attribution: keep a source citation in `docs/agents/` where the
ported components are documented.

Existing substrate we build on (do not re-implement):
- `parallel-workspaces` — `worktree_service.rs` already creates
  `bb/<ref>-<slug>` worktrees for plan runs.
- `plan-run-queue` — `plan_runner_service.rs` already provisions run chat
  sessions and binds a model.
- `plan-final-touches` — already has an "open pull request" step kind
  (default disabled).
- `git.ts` — already exposes `git_branch_list`, `git_branch_switch`,
  `git_branch_create`, `git_push`, `git_fetch`, `git_status`.

## Goals / Non-Goals

**Goals**
- `M×N` multi-chat grid inside persistent per-tab layouts.
- Ported chat harness header + composer rail + transcript, per column.
- Assign a `ready` plan to a chat → run in a fresh worktree branch off
  up-to-date `main`; concurrent runs bounded by per-provider caps.
- PR recommendation on finish (gh CLI or browser), explicit + confirmed.
- Per-provider concurrency + subagent-count settings (global + project).

**Non-Goals**
- Subagent execution mechanics (owned by `harness-subagents`).
- File view/edit/diff content surface (owned by `file-viewer-editor`); the
  per-run diff review gate is owned by `diff-review-workflow`.
- Porting dream's file explorer, changes, terminal, or browser panels.
- Adopting Radix / zustand / the `ai` SDK.
- Replacing `chat-first-shell`'s sidebar / account / menu / native chrome.

## Decisions

**Decision**: Grid state lives in frontend session/tab state, not the backend.
**Rationale**: Layout (order, widths, rows) is pure view state; the backend
already owns sessions, runs, and worktrees. Persisting the grid alongside
existing per-project workspace restore keeps one persistence path.
**Alternatives**: A backend `grid` table — rejected as over-engineering for
view state that must round-trip with the existing local workspace snapshot.

**Decision**: Model the grid as rows of columns: `grid: { rows: string[][] }`
plus `chatColumnWidths: Record<chatId, number>` and per-row heights.
**Rationale**: `1×N` is one row; `M×N` is M rows. Reorder within/across rows is
array splices. Matches dream's `openChatIds` + `chatColumnWidths` shape,
extended with rows for the M×N case dream does not have.
**Alternatives**: A free 2-D coordinate grid — rejected; rows-of-columns keeps
resize/reorder math tractable and matches the ported drag code.

**Decision**: Worktree is created **on run start**, branched from the
**freshly fetched default branch**, and kept until explicit prune.
**Rationale**: The user asked to base off up-to-date `main` and keep results
for review/PR. Creating at assignment would provision worktrees for queued
runs that may never start (concurrency cap). Default branch is auto-detected
(`git symbolic-ref refs/remotes/origin/HEAD`, fallback `main`→`master`→current).
**Alternatives**: Branch from current checkout — rejected (stale, entangles
runs); auto-prune on finish — rejected (no review/PR window).

**Decision**: Concurrency is governed by a new `run-concurrency-limits`
capability keyed **per provider**, default `1`.
**Rationale**: The user noted most providers meter concurrency; a single global
`N × model` (today's `plan-run-queue`) cannot express "Anthropic 1, local 8".
The scheduler tracks in-flight requests per provider (runs + subagents) and
queues excess. `plan-run-queue` and `harness-subagents` both consult this.
**Alternatives**: Keep the single `N` — rejected; can't model per-provider
limits. A separate subagent cap decoupled from provider limits — rejected;
subagents hit the same provider rate limits, so they must count together.

**Decision**: PR step = `gh pr create` when `gh` is detected + authed, else
push + open the GitHub compare URL. No token stored.
**Rationale**: Reuses the user's existing `gh`/browser auth; avoids adding a
credential + trust boundary. `gh` runs through the hidden-process helper
(`CREATE_NO_WINDOW`). Always confirm-gated per Invariant 5 and the
`plan-final-touches` default-disabled contract.
**Alternatives**: GitHub API + stored token — rejected for the extra
credential surface; recommend-only — rejected as too manual for the stated
goal.

**Decision**: One active plan per chat; re-assign confirms + restarts.
**Rationale**: Keeps the mental model "this chat = this plan's run" and a clean
worktree/branch per run. Matches the user's "1 model per chat, no subagents by
default" stance.
**Alternatives**: Per-chat sequential plan queue — deferred; can layer later
without breaking the one-active-plan invariant.

## Risks / Trade-offs

- **Depends on `chat-first-shell`** (unmerged). → Sequence apply after it
  merges; the grid replaces its single-column center's inner region, reusing
  its shell chrome. Track the dependency in ROADMAP; do not start apply until
  the gate clears.
- **Large grids strain resources** (many live PTYs/agents). → Per-provider
  concurrency caps bound *running* agents; idle columns are just mounted views.
  Mount/unmount virtualization follows dream's `use-mounted-chats` pattern.
- **Ported drag/resize code is intricate.** → Port the math with unit tests
  for width clamping and reorder index resolution before wiring the UI.
- **Default-branch detection varies** (no remote, detached HEAD, `master`). →
  Explicit fallback chain + a non-blocking "base may be stale" notice on fetch
  failure.
- **`gh` absent or unauthed.** → Detect and fall back to the browser compare
  URL; never block finish on PR creation.
- **CSS growth** past the 400-line goal. → Reuse `.row`/`.stack`/`.card`
  primitives; audit and document new classes in `design-system.md`.

## Migration Plan

- Additive: existing single-chat tabs load as a `1×1` grid (one column). Tab
  metadata without a `grid` field defaults to a single-column grid built from
  the existing active chat.
- Settings gain per-provider concurrency + subagent fields with safe defaults
  (`1`, subagents off); absent values read as defaults — no migration script
  needed beyond default-fill on read.
- No DB schema change is strictly required for the grid (frontend state); the
  worktree/run/PR fields extend existing run records where present.
- Rollback: the grid is behind the chat tab renderer; reverting to the single
  `ChatPanel` renderer restores prior behavior since chat sessions are
  unchanged.

## Open Questions

- Does `chat-first-shell`'s floating environment block already surface branch
  actions we should reuse rather than duplicate in the chat header? Resolve at
  apply time against the merged `chat-first-shell` code.
- Should the per-run diff review (`diff-review-workflow`) be a hard gate before
  the PR recommendation, or advisory? Coordinate when that change lands.
