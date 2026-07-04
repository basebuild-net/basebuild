# OpenSpec Roadmap

Execution queue for `openspec/changes/`. This directory is committed — it is the
source of truth for planned and in-progress work. Refresh the status table with:

```bash
node scripts/openspec-status.mjs --write
```

## Execution order

### Now (in flight)

1. `plan-pipeline-harness` — phases 7–10 remain: run queue, final touches,
   parallel worktrees, docs/verification. **Unblocked** — `native-agent-loop`
   archived (PR #9), so phases 7+ can consume `run_agent_turn` and the approval
   gateway. **Owner: agent A.**

### Next (specced, ready to start)

2. `connector-permission-gateway` — permission broker extends the merged
   `native-agent-loop` approval substrate (modes, rules, prompts, audit trail);
   the task 1.1 merge gate is satisfied as of PR #9.
3. `harness-context-files` — system-prompt assembly: AGENTS.md discovery,
   schematic injection, skills metadata, context inspector. Feeds the merged
   budget guard; no remaining gate.
4. `native-app-login-mcp` — device-auth account connection + first-party usage
   sync with basebuild.net. Independent of everything above.
5. `diff-review-workflow` — per-run changeset baseline, file-level review
   (approve/revert/send-back), review gate before commit/PR final touches.
   **After `plan-pipeline-harness`** (its only remaining gate).

### Proposed (no artifacts yet — run `/propose <name>` when its turn comes)

|Plan|Scope|Depends on|
|---|---|---|
|`session-compaction`|Summarize-and-continue history compaction past the truncation guard; explicitly deferred out of `native-agent-loop`.|unblocked — `native-agent-loop` archived (PR #9)|
|`harness-subagents`|Delegate scoped subtasks to parallel native sessions (omp task-tool parity) on top of the run queue + worktrees.|`plan-pipeline-harness` phases 7 + 9|

Full artifacts are deliberately **not** pre-generated for proposed plans —
`plan-pipeline-harness` still reshapes the services they'd spec against, and
stale specs are worse than none.


## Status

<!-- status:begin -->
_Last refreshed: 2026-07-04 (`node scripts/openspec-status.mjs --write`)_

|Change|Progress|Status|Next command|
|---|---|---|---|
|`connector-permission-gateway`|0/29|not started|`/apply connector-permission-gateway`|
|`diff-review-workflow`|0/16|not started|`/apply diff-review-workflow`|
|`harness-context-files`|0/13|not started|`/apply harness-context-files`|
|`native-app-login-mcp`|0/20|not started|`/apply native-app-login-mcp`|
|`plan-pipeline-harness`|51/51|complete — archive|`/archive plan-pipeline-harness`|
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

