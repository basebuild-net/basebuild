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
5. `harness-context-files` — system-prompt assembly: AGENTS.md discovery, schematic injection, skills metadata, context inspector. **After `native-agent-loop`** (feeds its budget guard).
6. `connector-permission-gateway` — re-scoped 2026-07-03: permission broker now extends the `native-agent-loop` tool-approval substrate (task 1.1 gates on that merge).
7. `diff-review-workflow` — per-run changeset baseline, file-level review (approve/revert/send-back), review gate before commit/PR final touches on queue runs. **After both in-flight changes.**

### Proposed (no artifacts yet — run `/propose <name>` when its turn comes)

|Plan|Scope|Depends on|
|---|---|---|
|`session-compaction`|Summarize-and-continue history compaction past the truncation guard; explicitly deferred out of `native-agent-loop`.|`native-agent-loop`|
|`harness-subagents`|Delegate scoped subtasks to parallel native sessions (omp task-tool parity) on top of the run queue + worktrees.|both in-flight changes|

Full artifacts are deliberately **not** pre-generated for proposed plans — the two
in-flight changes reshape the services they'd spec against, and stale specs are
worse than none.

## Status

<!-- status:begin -->
_Last refreshed: 2026-07-03 (`node scripts/openspec-status.mjs --write`)_

|Change|Progress|Status|Next command|
|---|---|---|---|
|`omp-ide-sync`|22/23|in progress|`/apply omp-ide-sync`|
|`plan-pipeline-harness`|19/51|in progress|`/apply plan-pipeline-harness`|
|`stabilize-and-agent-chat`|37/42|in progress|`/apply stabilize-and-agent-chat`|
|`startup-update-splash`|17/20|in progress|`/apply startup-update-splash`|
|`connector-permission-gateway`|0/29|not started|`/apply connector-permission-gateway`|
|`diff-review-workflow`|0/16|not started|`/apply diff-review-workflow`|
|`harness-context-files`|0/13|not started|`/apply harness-context-files`|
|`native-agent-loop`|0/34|not started|`/apply native-agent-loop`|
|`native-app-login-mcp`|0/20|not started|`/apply native-app-login-mcp`|
|`strong-testing-suite`|0/19|not started|`/apply strong-testing-suite`|
<!-- status:end -->

## Archiving

Changes at `complete — archive` get archived (`/archive <name>`): delta specs
merge into canonical `openspec/specs/` and the folder moves to
`openspec/changes/archive/<date>-<name>/`. First batch (5 changes, 17 canonical
specs) archived 2026-07-03 — new proposals must now check `openspec/specs/`
and mark overlapping capabilities as **Modified**, not New.

The straggler verification tasks for `stabilize-and-agent-chat`,
`startup-update-splash`, and `omp-ide-sync` are phase 1 of `native-agent-loop`.
