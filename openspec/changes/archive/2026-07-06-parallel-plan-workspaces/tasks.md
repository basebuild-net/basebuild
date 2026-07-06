# Tasks: parallel-plan-workspaces

> Depends on `chat-first-shell` merged. Do not start apply until that gate clears.

## 1. Foundation — grid state & port scaffolding

- [x] 1.1 Extend `src/state/sessions.ts` tab model with a `grid` field (`rows: string[][]`, `chatColumnWidths: Record<string, number>`, per-row heights); default legacy tabs to a `1×1` grid from the existing active chat.
- [x] 1.2 Extend the chat/session model with `assignedPlanId`, `worktreePath`, `branch`, and `agentMode` fields (nullable; safe defaults on read).
- [x] 1.3 Add pure helpers (with unit tests): grid width clamping/rebalance, reorder index resolution within/across rows, `M×N` reflow from a flat chat list. Port the math from the reference `chat-stack`/`standard-tabs` drag logic.
- [x] 1.4 Add per-provider concurrency + subagent settings to the settings model and `src/lib/settings.ts` wrappers (global defaults, per-project override; defaults: provider `1`, subagents off).

## 2. Chat harness UI port
- [x] 2.1 Extract the conversation + message rendering out of `ChatPanel.tsx` into a slim panel that renders inside a grid column; keep reasoning fold, tool cards, and idea cards intact.
- [x] 2.2 Build `ChatHeader.tsx` (`chat-header-context`): title inline-rename, model/effort chips, agent-mode pill, plan badge, branch + worktree indicator, history toggle, more-actions menu — 0px radius, `title=` on every control.
- [x] 2.3 Build `ChatComposerRail.tsx` (`chat-composer-controls`): port the compact single-line rail (provider/model/effort/connect/refresh + overflow menu) with truncation and per-column independence; preserve the existing single-line/setup-state contract.
- [x] 2.4 Build the branch switch/create dropdown in the header using existing `git_branch_list`/`git_branch_switch`/`git_branch_create`; confirm on uncommitted changes (stash/discard/cancel).
## 3. Multi-chat grid

- [x] 3.1 Build `ChatGrid.tsx` (`chat-grid-layout`): render `rows × columns`, mount only visible/streaming chats (port `use-mounted-chats`), empty-state when zero chats.
- [x] 3.2 Vertical + horizontal splitters with min-width/min-height clamping and live resize; persist widths/heights to the tab's grid state.
- [x] 3.3 Column reorder within a row and across rows via header drag (threshold, live offset, drop index), with `M×N` reflow on add/remove.
- [x] 3.4 Animated close (collapse to zero width, rebalance neighbors, retain session); "Add chat beside" and "Duplicate chat" from the header menu.
- [x] 3.5 Wire `WorkspaceTabs.tsx` so a chat tab renders `ChatGrid`; each tab keeps its own grid; grid persists per tab across tab-switch and restart (extend `ide-workspace-state` restore).

## 4. Worktree lifecycle (backend)

- [x] 4.1 `worktree_service.rs`: default-branch detection (`origin/HEAD` → `main` → `master` → current) + remote fetch before branch creation; non-blocking "base may be stale" signal on fetch failure.
- [x] 4.2 Create-on-run-start of `bb/<ref>-<slug>` from the fetched default branch; keep worktree + branch until explicit prune; list + prune commands (prune confirms on uncommitted changes; branch always kept).
- [x] 4.3 `src/lib/git.ts` thin wrappers for worktree list/prune, default-branch detection, and current-branch/worktree lookup for the header display.

## 5. Concurrency scheduler & plan→chat assignment

- [x] 5.1 `plan_runner_service.rs`: replace the single `N` cap with a per-provider in-flight scheduler (runs + subagents counted per provider); queue excess with a visible reason; start queued runs as slots free.
- [x] 5.2 Assign-a-plan flow (`plan-chat-assignment`): assign a `ready` plan to a chat column (one active per chat; re-assign confirms + restarts); provision worktree on run start; seed the chat from the plan + schematic; bind one model; stream in that column.
- [x] 5.3 Surface auto-provisioned run chats as grid columns; reuse the assigned chat when one is bound instead of minting a new column.
- [x] 5.4 Concurrency + subagent settings UI (global + per-project) with effective-value display and tooltips; gate subagents off by default; delegation declines with a visible notice when disabled.

## 6. Pull-request recommendation

- [x] 6.1 `pull_request_service.rs`: `gh` availability+auth probe (via hidden-process helper), `gh pr create`, branch push, and GitHub compare-URL construction; no token stored.
- [x] 6.2 `PrRecommendationCard.tsx`: on a finished worktree run, show branch, ahead/behind, changed-file summary, and a confirm-gated "Create pull request" action (gh path or browser fallback); dismiss keeps the branch.
- [x] 6.3 Wire the `plan-final-touches` open-pull-request step to the new service (explicit + confirmed; default disabled preserved).
## 7. Integration & testing

- [x] 7.1 Unit tests: grid width clamp/rebalance, reorder index math, `M×N` reflow, per-provider scheduler, default-branch detection fallback chain.
- [x] 7.2 Playwright e2e (mocked Tauri/git/gh, `BASEBUILD_E2E=1`): create `1×2`/`1×3`/`2×2` grids, reorder, resize, close; per-tab persistence across tab-switch and reload.
- [x] 7.3 Playwright e2e: assign plan → run in worktree → finish → PR recommendation (gh path and browser fallback); concurrency cap queues the third run.
- [x] 7.4 `npx tsc --noEmit`, `npm run build`, `cd src-tauri && cargo check`, `cargo test`.
- [x] 7.5 UI smoke: branch/worktree display + manual switch; per-column model independence; no-silent-side-effects (no auto push/PR/worktree on restore).

## 8. Docs & roadmap

- [x] 8.1 `docs/agents/desktop-shell.md` — chat tabs as grids, `M×N` layout, per-tab persistence, plan→chat assignment.
- [x] 8.2 `docs/agents/design-system.md` — new classes (grid, splitters, header, composer rail, PR card, concurrency settings); cite the reference IDE as the port source.
- [x] 8.3 `docs/agents/agent-runtime.md` — per-provider concurrency + subagent governance; worktree base-branch + PR flow. `DESIGN.md` visual pass if surfaces changed.
- [x] 8.4 Refresh `openspec/ROADMAP.md` narrative and run `node scripts/openspec-status.mjs --write` in the same commit.
