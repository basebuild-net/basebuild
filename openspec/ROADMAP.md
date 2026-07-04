# OpenSpec Roadmap

Execution queue for `openspec/changes/`. This directory is committed — it is the
source of truth for planned and in-progress work. Refresh the status table with:

```bash
node scripts/openspec-status.mjs --write
```

## Execution order

### Now (in flight)

1. `connector-permission-gateway` — phase 1+2 (gateway contract, storage,
   backend permission broker, Tauri commands, TS wrappers) in PR #17.
   Phase 2 OMP connector integration + frontend UX + web bridge + verification
   remain (tasks 3.1–6.5). Permission broker extends the merged
   `native-agent-loop` approval substrate (modes, rules, prompts, audit trail);
   the task 1.1 merge gate is satisfied as of PR #9.

### Next (specced, ready to start)

2. `harness-context-files` — system-prompt assembly: AGENTS.md discovery,
   schematic injection, skills metadata, context inspector. Feeds the merged
   budget guard; no remaining gate.
3. `native-app-login-mcp` — device-auth account connection + first-party usage
   sync with basebuild.net. Independent of everything above.
4. `diff-review-workflow` — per-run changeset baseline, file-level review
   (approve/revert/send-back), review gate before commit/PR final touches.
   **After `plan-pipeline-harness`** (archived PR #15 — gate satisfied).

### Proposed (no artifacts yet — run `/propose <name>` when its turn comes)

|Plan|Scope|Depends on|
|---|---|---|
|`session-compaction`|Summarize-and-continue history compaction past the truncation guard; explicitly deferred out of `native-agent-loop`.|unblocked — `native-agent-loop` archived (PR #9)|
|`harness-subagents`|Delegate scoped subtasks to parallel native sessions (omp task-tool parity) on top of the run queue + worktrees.|`plan-pipeline-harness` archived (PR #15) — gate satisfied|

Full artifacts are deliberately **not** pre-generated for proposed plans —
stale specs are worse than none.


## Status

<!-- status:begin -->
_Last refreshed: 2026-07-04 (`node scripts/openspec-status.mjs --write`)_

|Change|Progress|Status|Next command|
|---|---|---|---|
|`connector-permission-gateway`|9/29|in progress|`/apply connector-permission-gateway`|
|`diff-review-workflow`|0/16|not started|`/apply diff-review-workflow`|
|`harness-context-files`|0/13|not started|`/apply harness-context-files`|
|`native-app-login-mcp`|0/20|not started|`/apply native-app-login-mcp`|
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
