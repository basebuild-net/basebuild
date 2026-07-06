# OpenSpec Roadmap

Execution queue for `openspec/changes/`. This directory is committed — it is the
source of truth for planned and in-progress work. Refresh the status table with:

```bash
node scripts/openspec-status.mjs --write
```

## Execution order

### Merged — awaiting archive

Merged to `main` and implementation-complete; queued for `/archive` (delta
specs → `openspec/specs/`, folder → `openspec/changes/archive/`).

1. `unified-planning-workspace` — merged in **PR #20**. Unified the two
   parallel planning surfaces (`plan_proposals` chat cards + right-panel
   `ideas` catalog) into one `Categories → Ideas → Plans` model: generation
   runs as a visible chat turn (reasoning fold + live transcript + incremental
   idea cards via a `propose_ideas` tool), idea lifecycle gained `rejected`,
   the right panel became a tabbed `Plans / Ideas / Categories` inspector, and
   planning prompts became tunable in Settings → Planning. **BREAKING
   (internal, pre-1.0):** dropped the `plan_proposals` table/commands
   (`planning-system-qol` PR #19) in favor of the `ideas` catalog. 32/34 tasks
   — 8.4 (UI smoke) + 8.5 (freeze watchdog) consciously waived (live-only).
2. `basebuild-planning-skill` — merged in **PR #20**. Portable planning suite:
   `skills/basebuild-planning` (categories → ideas → iterative picking →
   executor-proof plans stored under `.basebuild/`; engine-pluggable — native
   artifacts or detected planning skills like OpenSpec), schematic skill v2
   (Vision section, repo-fact prefill, re-alignment mode, planning pairing),
   removed the stale `basebuild-idea-generation` skill. The `.basebuild` file
   schema is the future app interop contract. 18/18 tasks; no app code touched.
3. `schematic-grounded-planning` — merged in **PR #22**. Reshaped the app
   around a **schematic wizard** (blueprint questionnaire by archetype / team
   size / stage; time-boxed End goals with nudges; structured section-card view
   + health validation replacing the raw dump; the wizard runs as a guided
   chat turn, not a modal) and **grounded generation** (turns run the bundled
   skills agentically, read project context via the tool loop incl. MCP, and
   capture ideas with required grounding + optional focus anchors). **BREAKING**:
   removed hardcoded default categories (now project-derived) and the
   `Generate plans` modal / input boxes. 23/25 tasks — 5.2 (UI smoke) waived
   (live-only). **Spec gap:** the schematic-wizard "AI-enhanced descriptions"
   requirement (task 2.3, per-section Enhance diff action) is **unshipped** —
   `schematic-enhance-ui` in Proposed covers it; note this when archiving.

### Now (in flight)

1. `connector-permission-gateway` — phases 1+2 merged in PR #17 (gateway
   contract, storage, backend permission broker, Tauri commands, TS wrappers;
   9/29 tasks done). Phase 2 OMP connector integration + frontend UX + web
   bridge + verification remain (tasks 2.2 partial, 3.1–6.5). Permission broker
   extends the merged `native-agent-loop` approval substrate (modes, rules,
   prompts, audit trail); the task 1.1 merge gate is satisfied as of PR #9.
2. `chat-first-shell` — full shell redesign around the conversation: one global
   left column (top `New chat`/`Search`, projects+chats list showing 5 recent
   per project with relative timestamps + pinning + `Show more`, bottom account
   row), a chat-focused center, a floating top-right environment block (source/
   branch with commit/push/pull, the relocated Planning Inspector, a Files
   button), a **modal** file explorer replacing the inline tree, composer mic
   (voice-to-text) + context-size/usage readout, and native Windows chrome +
   `File/Edit/View` menu. **BREAKING (UI):** removes the right side panel, the
   in-app top bar, and the always-visible file list. Artifacts complete (5 new
   capabilities + `desktop-shell`/`chat-composer-controls` modified); 0/31
   tasks. Relocates the `unified-planning-workspace` inspector unchanged; reuses
   `file-viewer-editor`'s viewer for modal file content; pairs with
   `diff-review-workflow` in the Changes fold.

### Next (priority order)

Ordered by owner priority. Gated items show their blocking dependency; the
top **ungated** item is what can actually start now.

1. `parallel-plan-workspaces` — ★ **owner-prioritized.** Multi-chat **grid**
   (`M×N`, no fixed cap) in persistent per-tab layouts; ported chat harness
   (per-chat header with model/effort/branch/worktree/agent-mode + plan badge,
   compact composer rail, transcript) modeled on the dream IDE;
   **plan→chat→worktree→PR** pipeline (assign a `ready` plan to a chat → run on
   a fresh branch off freshly-fetched `main` in its own worktree → concurrent
   runs under per-provider caps → PR recommendation on finish via `gh`/browser);
   new **per-provider max-concurrency** + subagent-count governance (global +
   project). New caps `chat-grid-layout`, `chat-header-context`,
   `plan-chat-assignment`, `run-concurrency-limits`; **modifies**
   `desktop-shell`, `ide-workspace-state`, `agent-chat`,
   `chat-composer-controls`, `chat-model-defaults`, `parallel-workspaces`,
   `plan-run-queue`, `plan-final-touches`. **Gate cleared** — `chat-first-shell`
   merged in PR #23; apply in progress on `feat/parallel-plan-workspaces`.
   Coordinates with `harness-subagents` (subagent execution) and
   `diff-review-workflow` (per-run diff gate before PR).
2. `chat-history-persistence` — **live-bug fix + feature; ungated, ready now.**
   Reopening the app does not load chat history. Diagnosed two restore bugs on
   the running `feat/chat-first-shell` build: (1) `save_workspace_restore_state`
   fails every call (`missing field sideCollapsed`) because `AppShell` omits the
   backend-required `sideCollapsed`/`sideWidth`, so `lastSessionId`/`lastTabId`
   never persist; (2) `setLastActiveSession` is imported but never called, so
   reopen falls back to the newest session (`created_at DESC`) not the last
   active one. Plus a scale gap: `ChatPanel` loads/renders the entire history at
   once. Fixes both restore bugs and adds windowed loading (recent page +
   lazy older pages on scroll-up + scroll-anchor + bounded rendered rows). New
   cap `chat-history-loading`; **modifies** `session-lifecycle` (restore
   last-active session) and `ide-workspace-state` (restore-state integrity;
   additive — no conflict with #1). Artifacts generated 2026-07-06 (0/21).
3. `omp-terminal-usage-sync` — day-one OMP workflow on the installed build:
   fix dead PTY output/input/resize plumbing (omp.exe spawns but renders
   nothing), stale-tab disconnected states, omp 16.x telemetry parser drift
   (`reports[].limits[]`), manual Sync-now ungated from auto-sync with
   mandatory outcome feedback, usage sharing default-on after sign-in
   (owner-directed **BREAKING** privacy-default change), skills bundled into
   the installer, terminal-first sessions (no chat rows until chat is used),
   empty-chat hygiene. Diagnosis-complete from 2026-07-05 installed-build
   (v0.0.12) testing. `session-lifecycle` canonical spec landed via
   `planning-system-qol` archive (PR #19) — dependency satisfied.
4. `file-viewer-editor` — file tabs become the single view/edit/diff
   surface: syntax-highlighted virtualized viewing, markdown preview,
   images, explicit-save editing with mtime conflict guard, and unified
   diff mode fed from the Source panel (staged/unstaged/untracked).
   Provides the rendering surface `diff-review-workflow` can reuse.
5. `harness-context-files` — system-prompt assembly: AGENTS.md discovery,
   schematic injection, skills metadata, context inspector. Feeds the merged
   budget guard; no remaining gate.
6. `native-app-login-mcp` — device-auth account connection + first-party usage
   sync with basebuild.net. Independent of everything above.
7. `diff-review-workflow` — per-run changeset baseline, file-level review
   (approve/revert/send-back), review gate before commit/PR final touches.
   **After `plan-pipeline-harness`** (archived PR #15 — gate satisfied);
   pairs with `file-viewer-editor`'s diff surface.
8. `schematic-enhance-ui` — per-section **Enhance** action on the schematic
   tab: plain words → agent-optimized rewrite shown as an approve/discard
   before/after diff (new cap `schematic-enhance`). Fulfills the
   schematic-wizard "AI-enhanced descriptions" requirement left unshipped by
   `schematic-grounded-planning` (task 2.3). Artifacts generated 2026-07-05
   (0/14). Dep `schematic-grounded-planning` merged (PR #22).
9. `session-compaction` — summarize-and-continue history compaction past the
   truncation guard (new cap `session-compaction`; **modifies**
   `context-budget-guard` to prefer compaction over whole-turn dropping).
   Deferred out of `native-agent-loop`. Artifacts generated 2026-07-05 (0/13).
   Unblocked — `native-agent-loop` archived (PR #9).
10. `harness-subagents` — scoped subagent delegation tool: a parent turn spawns
    bounded, worktree-isolated native sub-sessions (omp task-tool parity) on the
    run queue and folds their results back (new cap `harness-subagents`).
    Artifacts generated 2026-07-05 (0/16). Gate satisfied — `plan-pipeline-harness`
    archived (PR #15).
11. `plan-status-rename` — rename plan status `openspec → planned` across
    DB/API/UI with a one-time migration + backward-compat read alias; updates
    AGENTS.md Invariant 9 + `config.yaml` to match the `.basebuild` schema
    (**modifies** `plan-pipeline`, `openspec-artifacts`; new cap
    `plan-status-migration`). Artifacts generated 2026-07-05 (0/12). Dep
    `basebuild-planning-skill` merged (PR #20).
12. `planning-file-ingestion` — app reads/syncs `.basebuild` planning files
    (categories/ideas/plans) into the workspace, non-destructive + idempotent
    (new cap `planning-file-ingestion`). Artifacts generated 2026-07-05 (0/13).
    Deps `basebuild-planning-skill` + `unified-planning-workspace` merged
    (PR #20); pairs with `plan-status-rename` for the `planned` vocabulary.
13. `plan-import` — import pre-existing external plans (unexecuted OpenSpec
    changes etc.) into `.basebuild` plan records with `engine`/`external`/derived
    status, confirmed + idempotent (new cap `plan-import`). Artifacts generated
    2026-07-05 (0/13). Dep `basebuild-planning-skill` merged (PR #20); pairs with
    `planning-file-ingestion`.

### Proposed (no artifacts yet — run `/propose <name>` when its turn comes)

_All six previously-proposed plans had their dependencies satisfied (all deps
merged/archived) and were generated on **2026-07-05**; they now carry full
artifacts and moved to **Next** above. No proposed-without-artifacts plans
remain._

New ideas still land here first: this section stays the holding area for
genuinely unstarted plans whose artifacts should **not** be pre-generated until
their turn comes — stale specs are worse than none.


## Status

<!-- status:begin -->
_Last refreshed: 2026-07-06 (`node scripts/openspec-status.mjs --write`)_

|Change|Progress|Status|Next command|
|---|---|---|---|
|`chat-first-shell`|17/31|in progress|`/apply chat-first-shell`|
|`connector-permission-gateway`|9/29|in progress|`/apply connector-permission-gateway`|
|`plan-import`|11/13|in progress|`/apply plan-import`|
|`chat-history-persistence`|0/21|not started|`/apply chat-history-persistence`|
|`diff-review-workflow`|0/16|not started|`/apply diff-review-workflow`|
|`file-viewer-editor`|0/22|not started|`/apply file-viewer-editor`|
|`harness-context-files`|0/13|not started|`/apply harness-context-files`|
|`harness-subagents`|0/16|not started|`/apply harness-subagents`|
|`native-app-login-mcp`|0/20|not started|`/apply native-app-login-mcp`|
|`omp-terminal-usage-sync`|0/33|not started|`/apply omp-terminal-usage-sync`|
|`plan-status-rename`|0/12|not started|`/apply plan-status-rename`|
|`planning-file-ingestion`|0/13|not started|`/apply planning-file-ingestion`|
|`project-grid-workspace`|0/33|not started|`/apply project-grid-workspace`|
|`schematic-enhance-ui`|0/14|not started|`/apply schematic-enhance-ui`|
|`session-compaction`|0/13|not started|`/apply session-compaction`|
|`parallel-plan-workspaces`|32/32|complete — archive|`/archive parallel-plan-workspaces`|
<!-- status:end -->

## Archiving

Changes at `complete — archive` get archived (`/archive <name>`): delta specs
merge into canonical `openspec/specs/` and the folder moves to
`openspec/changes/archive/<date>-<name>/`. Archive history:

- **2026-07-03** — first batch: 5 changes, 17 canonical specs (see archive/).
- **2026-07-04a** — `native-agent-loop`, `stability-hardening`,
  `strong-testing-suite` archived in PR #13: 10 new canonical specs
  (`agent-tool-loop`, `core-tool-runtime`, `tool-approval-gateway`,
  `tool-transcript-rendering`, `context-budget-guard`, `sqlite-robustness`,
  `main-thread-hygiene`, `freeze-watchdog`, `crash-reporting`,
  `testing-automation`) + 1 modified (`desktop-shell` gained "Renderer Crash
  Visibility").
- **2026-07-04b** — `omp-ide-sync`, `startup-update-splash` archived in PR #14:
  5 new canonical specs (`omp-tab-integration`, `omp-session-telemetry`,
  `omp-account-usage-sync`, `startup-update-gate`, `portable-instant-updates`).
  Straggler tasks (6.3, 5.3–5.5) closed: 5.3 release-workflow dry-run verified
  statically; 5.4 portable update + 5.5 splash screenshots + 6.3 live autosync
  matrix consciously waived (live-only; require published release / running
  Tauri app / OS event simulation). New proposals must check `openspec/specs/`
  and mark overlapping capabilities as **Modified**, not New.
- **2026-07-04c** — `plan-pipeline-harness` archived in PR #15: 8 new canonical
  specs (`plan-pipeline`, `plan-run-queue`, `plan-final-touches`,
  `chat-model-defaults`, `slash-command-registry`, `native-mcp-client`,
  `openspec-artifacts`, `parallel-workspaces`). 51/51 tasks complete.
- **2026-07-05a** — `planning-system-qol` shipped in PR #19 (38/38 tasks) and
  archived: 1 new canonical spec (`session-lifecycle`) + 6 modified
  (`tool-transcript-rendering` gained "Grouped tool activity",
  `testing-automation` gained "Test database isolation", `chat-model-defaults`
  gained "Effort level validity", `core-tool-runtime` gained "Deterministic
  deduplicated glob results", `agent-chat` gained "Reasoning channel
  separation", `plan-pipeline-ui` gained "Structured plan proposal capture" +
  "Proposal selection state persists"). The `plan_proposals` portion is
  superseded by the in-flight `unified-planning-workspace` change, which
  drops that table in favor of the unified `ideas` catalog.
- **Out-of-band** — PR #18 merged OMP credential integration + AI commit
  message generation (Source panel). Not tracked as an OpenSpec change; no
  delta specs. Affects `native_chat_service`, `provider_client`,
  `SourcePanel`, `SettingsModal`.
