# OpenSpec Roadmap

Execution queue for `openspec/changes/`. This directory is committed — it is the
source of truth for planned and in-progress work. Refresh the status table with:

```bash
node scripts/openspec-status.mjs --write
```

## Execution order

### Now (in flight)

1. `unified-planning-workspace` — unifies the two parallel planning surfaces
   (`plan_proposals` chat cards + right-panel `ideas` catalog) into one
   `Categories → Ideas → Plans` model. Generation runs as a visible chat turn
   (reasoning fold + live transcript + incremental idea cards via a
   `propose_ideas` tool), the discarded `ideas` streaming channel is removed,
   idea lifecycle gains `rejected`, the right panel becomes a tabbed
   `Plans / Ideas / Categories` inspector, and planning prompts become
   tunable in Settings → Planning. **BREAKING (internal, pre-1.0):** drops the
   just-shipped `plan_proposals` table/commands (`planning-system-qol` PR #19)
   in favor of the richer `ideas` catalog — see proposal's Supersedes note.
   Tasks 1.1–7.2 + 8.1–8.3 + 9.1–9.3 done (32/34); 8.4 (UI smoke) + 8.5
   (freeze watchdog) consciously waived — live-only, require running Tauri
   app + connected provider. All static checks pass: `tsc --noEmit`,
   `npm run build`, `cargo test` (188), e2e (10). Implementation-complete,
   ready to archive on the next PR. Depends on `planning-system-qol`
   (archived below).
2. `connector-permission-gateway` — phases 1+2 merged in PR #17 (gateway
   contract, storage, backend permission broker, Tauri commands, TS wrappers;
   9/29 tasks done). Phase 2 OMP connector integration + frontend UX + web
   bridge + verification remain (tasks 2.2 partial, 3.1–6.5). Permission broker
   extends the merged `native-agent-loop` approval substrate (modes, rules,
   prompts, audit trail); the task 1.1 merge gate is satisfied as of PR #9.
3. `basebuild-planning-skill` — portable planning suite: `skills/basebuild-planning`
   (categories → ideas → iterative picking → executor-proof plans stored under
   `.basebuild/`; engine-pluggable — native artifacts or detected planning
   skills like OpenSpec), schematic skill v2 (Vision section, repo-fact
   prefill, re-alignment mode, planning pairing), removes the stale
   `basebuild-idea-generation` skill. The `.basebuild` file schema is the
   future app interop contract. **Complete — pending archive** (18/18 tasks):
   skills + specs implemented and verified (schema dry-run, read_skill
   frontmatter compat, tsc/build/cargo test 188 pass — no app code touched).
   No app-code overlap with `unified-planning-workspace` (SQLite/UI vs files).

### Next (specced, ready to start)

4. `omp-terminal-usage-sync` — day-one OMP workflow on the installed build:
   fix dead PTY output/input/resize plumbing (omp.exe spawns but renders
   nothing), stale-tab disconnected states, omp 16.x telemetry parser drift
   (`reports[].limits[]`), manual Sync-now ungated from auto-sync with
   mandatory outcome feedback, usage sharing default-on after sign-in
   (owner-directed **BREAKING** privacy-default change), skills bundled into
   the installer, terminal-first sessions (no chat rows until chat is used),
   empty-chat hygiene. Diagnosis-complete from 2026-07-05 installed-build
   (v0.0.12) testing. `session-lifecycle` canonical spec landed via
   `planning-system-qol` archive (PR #19) — dependency satisfied.
5. `file-viewer-editor` — file tabs become the single view/edit/diff
   surface: syntax-highlighted virtualized viewing, markdown preview,
   images, explicit-save editing with mtime conflict guard, and unified
   diff mode fed from the Source panel (staged/unstaged/untracked).
   Provides the rendering surface `diff-review-workflow` can reuse.
6. `harness-context-files` — system-prompt assembly: AGENTS.md discovery,
   schematic injection, skills metadata, context inspector. Feeds the merged
   budget guard; no remaining gate.
7. `native-app-login-mcp` — device-auth account connection + first-party usage
   sync with basebuild.net. Independent of everything above.
8. `diff-review-workflow` — per-run changeset baseline, file-level review
   (approve/revert/send-back), review gate before commit/PR final touches.
   **After `plan-pipeline-harness`** (archived PR #15 — gate satisfied);
   pairs with `file-viewer-editor`'s diff surface.
9. `schematic-grounded-planning` — reshapes the app around two primary
   features: a **schematic wizard** (blueprint questionnaire by archetype,
   team size, stage; time-boxed End goals with nudges; AI-enhanced section
   descriptions; structured section-card view + health validation replacing
   the raw dump) and **schematic-grounded planning** (generation turns run the
   bundled skills agentically, read project context via the tool loop incl.
   MCP, and capture ideas with required grounding + optional focus anchors).
   **BREAKING**: removes hardcoded default categories (now project-derived)
   and the `Generate plans` modal / input boxes (inspector becomes an
   input-free catalog; generation lives in the chat menu). **After
   `unified-planning-workspace`** (builds on its catalog/prompts/menu/
   inspector); uses the skills from `basebuild-planning-skill`.

### Proposed (no artifacts yet — run `/propose <name>` when its turn comes)

|Plan|Scope|Depends on|
|---|---|---|
|`session-compaction`|Summarize-and-continue history compaction past the truncation guard; explicitly deferred out of `native-agent-loop`.|unblocked — `native-agent-loop` archived (PR #9)|
|`harness-subagents`|Delegate scoped subtasks to parallel native sessions (omp task-tool parity) on top of the run queue + worktrees.|`plan-pipeline-harness` archived (PR #15) — gate satisfied|
|`plan-status-rename`|App DB/UI status rename `openspec → planned` + AGENTS.md Invariant 9, matching the `.basebuild` file schema.|`basebuild-planning-skill`|
|`planning-file-ingestion`|App reads/syncs `.basebuild` planning files (ideas/plans/categories) into the planning workspace.|`basebuild-planning-skill`, `unified-planning-workspace`|
|`plan-import`|Import pre-existing external plans (unexecuted openspec changes etc.) into `.basebuild` plan records.|`basebuild-planning-skill`|

Full artifacts are deliberately **not** pre-generated for proposed plans —
stale specs are worse than none.


## Status

<!-- status:begin -->
_Last refreshed: 2026-07-05 (`node scripts/openspec-status.mjs --write`)_

|Change|Progress|Status|Next command|
|---|---|---|---|
|`connector-permission-gateway`|9/29|in progress|`/apply connector-permission-gateway`|
|`unified-planning-workspace`|32/34|in progress|`/apply unified-planning-workspace`|
|`diff-review-workflow`|0/16|not started|`/apply diff-review-workflow`|
|`file-viewer-editor`|0/22|not started|`/apply file-viewer-editor`|
|`harness-context-files`|0/13|not started|`/apply harness-context-files`|
|`native-app-login-mcp`|0/20|not started|`/apply native-app-login-mcp`|
|`omp-terminal-usage-sync`|0/33|not started|`/apply omp-terminal-usage-sync`|
|`schematic-grounded-planning`|0/25|not started|`/apply schematic-grounded-planning`|
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
