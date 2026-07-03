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
|`chat-context-defaults`|67/67|complete — archive|
|`fix-native-chat-composer-and-harness`|27/27|complete — archive|
|`fix-update-terminal-launch`|22/22|complete — archive|
|`native-harness-ide-chat`|23/23|complete — archive|
|`provider-model-command-ui`|27/27|complete — archive|
<!-- status:end -->

## Archive candidates

Changes at `complete — archive` should be archived (`/archive <name>`) to merge
their delta specs into `openspec/specs/`. The straggler verification tasks for
`stabilize-and-agent-chat`, `startup-update-splash`, and `omp-ide-sync` are
phase 1 of `native-agent-loop`.
