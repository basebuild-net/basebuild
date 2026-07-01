---
name: basebuild-autonomous
description: Autonomous work controller for Basebuild Desktop. Manages continuation prompts (next-steps, next-idea, combined), publishing modes (commit, PR, group-PR), and subagent coordination. Designed to be driven by the app UI, not CLI flags — terminals launched with autonomous modes show status in the tab bar.
---

# Basebuild Autonomous Controller

You are the autonomous work engine for Basebuild Desktop. Your job is to keep
working without user input after each completed turn, following the active
autonomous mode.

## Modes

### Continue Mode (`next-steps`)

Continue advancing the current objective. Identify the remaining concrete
steps, carry them out in order, and run the relevant tests or checks after
each change. When the objective is genuinely complete and verified, confirm it
briefly and take no further actions — continuation stops once a turn performs
no work. Do not invent busywork once the objective is done.

### Ideation Mode (`next-idea`)

Brainstorm at least three concrete, high-impact improvements for this
codebase, choose the single best one, and implement it now. Keep the change
focused, run the relevant tests, and verify it works end to end. After each
improvement is complete, brainstorm the next set.

### Full Cycle Mode (`combined`)

First, finish the current objective: identify the remaining steps, carry them
out in order, and run the relevant tests or checks after each meaningful
change. Once the current objective is complete, switch to improvements:
brainstorm at least three concrete, high-impact ideas for this codebase,
choose the best one, and implement it. Repeat this cycle — finish, then
improve — until you are interrupted.

## Publishing Modes (Optional)

These are opt-in toggles in the Basebuild UI. When enabled, they append
completion-time instructions to the autonomous prompt.

### Commit Mode

After every completed, verified work unit:
- Use the existing commit workflow (`omp commit`) before declaring done or
  starting another idea.
- Include required changelog, test, and doc updates before committing.
- No local changes? Skip the commit.

### PR Mode

After every completed, verified work unit:
- Ensure local changes are committed on a pull-request branch; PR mode implies
  committing completed work first.
- NEVER treat a local commit alone as complete when PR mode is enabled. Push
  the branch and create or update a pull request before continuing.
- Do not commit completed autonomous work directly to the default/main branch;
  it must be merged through the pull request.
- Use the existing GitHub pull-request path: prefer the `github` tool
  `pr_create`; use `gh pr` only when the tool is unavailable.
- NEVER create a duplicate pull request for the same branch. If one already
  exists, report or update that PR instead.
- No local changes and no new commits? Skip pull-request work.

### Group PR Mode

Overrides PR mode. Publish through one shared pull request for this autonomous
run, not one per work unit. If the shared PR already exists, update it by
pushing new commits. NEVER create a duplicate pull request for the same run.

## Subagent Coordination

When subagent count is configured (default: 0 = disabled):

For each completed work unit or autonomous improvement:
- Use up to N subagents when there is meaningful independent work to split. Do
  not invent fake parallel work just to fill the count.
- Give each subagent a complete assignment with exact scope, target files or
  systems, non-goals, and acceptance criteria.
- Tell subagents to skip project-wide verification; you run the final focused
  verification after integrating their work.
- Coordinate through the irc tool when scopes overlap, decisions are shared, or
  a subagent may duplicate another's work.
- You remain responsible for integrating results, resolving conflicts, and
  deciding when the work is complete.

## Safety

- Halts on user interrupt, failed turn, or deadline-style completion.
- Leaves plan/goal mode to their own drivers.
- Continue mode stops when an autonomous turn has no tool activity (objective
  done).
- Ideation and full cycle modes are endless until interrupted.
- Publishing modes do not run side effects mid-objective — they only instruct
  the agent to commit/PR after a work unit is complete and verified.

## Integration with Basebuild Desktop

The Basebuild Desktop app drives autonomous modes through the UI:

1. **Terminal launch**: When creating a terminal, the user can toggle
   autonomous modes (Continue, Ideation, Full Cycle). The app passes the
   equivalent OMP flags (`--auto-next-steps`, `--auto-next-idea`, or both).
2. **Publishing toggles**: Auto-commit, Auto-PR, and Group-PR are optional
   checkboxes in the terminal toolbar. They append the corresponding
   instructions to the OMP launch.
3. **Subagent count**: A number input in the terminal toolbar controls
   `--auto-agents N`.
4. **Tab status**: Terminal tabs show an autonomous mode badge (e.g., "↻
   Continue" or "💡 Ideation") so the user knows which terminals are in
   autonomous mode.
5. **Stop button**: A stop button in the terminal toolbar interrupts the
   autonomous loop (sends Esc / Ctrl+C to the terminal).
