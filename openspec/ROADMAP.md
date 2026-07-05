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

### Next (specced, ready to start)

2. `omp-terminal-usage-sync` — day-one OMP workflow on the installed build:
   fix dead PTY output/input/resize plumbing (omp.exe spawns but renders
   nothing), stale-tab disconnected states, omp 16.x telemetry parser drift
   (`reports[].limits[]`), manual Sync-now ungated from auto-sync with
   mandatory outcome feedback, usage sharing default-on after sign-in
   (owner-directed **BREAKING** privacy-default change), skills bundled into
   the installer, terminal-first sessions (no chat rows until chat is used),
   empty-chat hygiene. Diagnosis-complete from 2026-07-05 installed-build
   (v0.0.12) testing. `session-lifecycle` canonical spec landed via
   `planning-system-qol` archive (PR #19) — dependency satisfied.
3. `file-viewer-editor` — file tabs become the single view/edit/diff
   surface: syntax-highlighted virtualized viewing, markdown preview,
   images, explicit-save editing with mtime conflict guard, and unified
   diff mode fed from the Source panel (staged/unstaged/untracked).
   Provides the rendering surface `diff-review-workflow` can reuse.
4. `harness-context-files` — system-prompt assembly: AGENTS.md discovery,
   schematic injection, skills metadata, context inspector. Feeds the merged
   budget guard; no remaining gate.
5. `native-app-login-mcp` — device-auth account connection + first-party usage
   sync with basebuild.net. Independent of everything above.
6. `diff-review-workflow` — per-run changeset baseline, file-level review
   (approve/revert/send-back), review gate before commit/PR final touches.
   **After `plan-pipeline-harness`** (archived PR #15 — gate satisfied);
   pairs with `file-viewer-editor`'s diff surface.

### Proposed (no artifacts yet — run `/propose <name>` when its turn comes)

|Plan|Scope|Depends on|
|---|---|---|
|`schematic-enhance-ui`|Per-section **Enhance** action on the schematic tab: plain words → agent-optimized rewrite shown as an approve/discard before/after diff. Fulfills the schematic-wizard "AI-enhanced descriptions" spec requirement left unshipped by `schematic-grounded-planning` (task 2.3).|`schematic-grounded-planning` merged (PR #22)|
|`session-compaction`|Summarize-and-continue history compaction past the truncation guard; explicitly deferred out of `native-agent-loop`.|unblocked — `native-agent-loop` archived (PR #9)|
|`harness-subagents`|Delegate scoped subtasks to parallel native sessions (omp task-tool parity) on top of the run queue + worktrees.|`plan-pipeline-harness` archived (PR #15) — gate satisfied|
|`plan-status-rename`|App DB/UI status rename `openspec → planned` + AGENTS.md Invariant 9, matching the `.basebuild` file schema.|`basebuild-planning-skill` merged (PR #20)|
|`planning-file-ingestion`|App reads/syncs `.basebuild` planning files (ideas/plans/categories) into the planning workspace.|`basebuild-planning-skill` + `unified-planning-workspace` merged (PR #20)|
|`plan-import`|Import pre-existing external plans (unexecuted openspec changes etc.) into `.basebuild` plan records.|`basebuild-planning-skill` merged (PR #20)|

Full artifacts are deliberately **not** pre-generated for proposed plans —
stale specs are worse than none.


## Status

<!-- status:begin -->
_Last refreshed: 2026-07-05 (`node scripts/openspec-status.mjs --write`)_

|Change|Progress|Status|Next command|
|---|---|---|---|
|`connector-permission-gateway`|9/29|in progress|`/apply connector-permission-gateway`|
|`schematic-grounded-planning`|23/25|in progress|`/apply schematic-grounded-planning`|
|`unified-planning-workspace`|32/34|in progress|`/apply unified-planning-workspace`|
|`chat-first-shell`|0/31|not started|`/apply chat-first-shell`|
|`diff-review-workflow`|0/16|not started|`/apply diff-review-workflow`|
|`file-viewer-editor`|0/22|not started|`/apply file-viewer-editor`|
|`harness-context-files`|0/13|not started|`/apply harness-context-files`|
|`native-app-login-mcp`|0/20|not started|`/apply native-app-login-mcp`|
|`omp-terminal-usage-sync`|0/33|not started|`/apply omp-terminal-usage-sync`|
|`basebuild-planning-skill`|18/18|complete — archive|`/archive basebuild-planning-skill`|
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
