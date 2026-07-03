# OpenSpec Roadmap

Execution queue for `openspec/changes/`. This directory is committed — it is the
source of truth for planned and in-progress work. Refresh the status table with:

```bash
node scripts/openspec-status.mjs --write
```

## Execution order

### Now (in flight)

1. `plan-pipeline-harness` — idea→plan pipeline, run queue, MCP client, slash commands, workspaces. **Owner: agent A.**
2. `native-agent-loop` — provider tool protocol, tool runtime, approval gateway, transcript UI, budget guard. **Must merge its provider/service layer before `plan-pipeline-harness` phases 6–7** (MCP tools + run queue consume `run_agent_turn` and the gateway).

### Next (specced, ready to start)

3. `strong-testing-suite` — Playwright + CI + crash diagnostics. Start any time; independent of the two above.
4. `native-app-login-mcp` — device-auth account connection + first-party usage sync with basebuild.net.

### Needs re-scope before starting

- `connector-permission-gateway` — written before `native-agent-loop`; its `permission-provider-broker` capability must be re-scoped to *wrap* the tool-approval gateway shipped by `native-agent-loop` instead of redefining it. Re-run `/propose`-level review on it first.
- `desktop-catalog-sync` — has no `tasks.md`; finish its artifacts (`/ff`) or drop it.

### Proposed (no artifacts yet — run `/propose <name>` when its turn comes)

|Plan|Scope|Depends on|
|---|---|---|
|`harness-context-files`|Native harness system-prompt assembly: AGENTS.md discovery, project schematic injection, skills metadata list (omp `context-files` parity).|`native-agent-loop`|
|`session-compaction`|Summarize-and-continue history compaction past the truncation guard; explicitly deferred out of `native-agent-loop`.|`native-agent-loop`|
|`diff-review-workflow`|Per-run diff review UI: inspect/approve/revert agent-made changes before final-touches commit/PR steps.|`native-agent-loop`, `plan-pipeline-harness`|
|`harness-subagents`|Delegate scoped subtasks to parallel native sessions (omp task-tool parity) on top of the run queue + worktrees.|both in-flight changes|

Full artifacts are deliberately **not** pre-generated for proposed plans — the two
in-flight changes reshape the services they'd spec against, and stale specs are
worse than none.

## Status

<!-- status:begin -->
_Last refreshed: 2026-07-03 (`node scripts/openspec-status.mjs --write`)_

|Change|Progress|Status|
|---|---|---|
|`omp-ide-sync`|22/23|in progress|
|`plan-pipeline-harness`|9/51|in progress|
|`stabilize-and-agent-chat`|37/42|in progress|
|`startup-update-splash`|17/20|in progress|
|`connector-permission-gateway`|0/28|not started|
|`native-agent-loop`|0/34|not started|
|`native-app-login-mcp`|0/20|not started|
|`strong-testing-suite`|0/19|not started|
|`desktop-catalog-sync`|0/0|no tasks|
<!-- status:end -->

## Archiving

Changes at `complete — archive` get archived (`/archive <name>`): delta specs
merge into canonical `openspec/specs/` and the folder moves to
`openspec/changes/archive/<date>-<name>/`. First batch (5 changes, 17 canonical
specs) archived 2026-07-03 — new proposals must now check `openspec/specs/`
and mark overlapping capabilities as **Modified**, not New.

The straggler verification tasks for `stabilize-and-agent-chat`,
`startup-update-splash`, and `omp-ide-sync` are phase 1 of `native-agent-loop`.
