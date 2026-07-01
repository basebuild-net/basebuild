# Proposal: Basebuild Ideas and Plan Pipeline

## Why

The first foundation of Basebuild Desktop gives us projects, terminal panes, source control, and OMP. The next high-leverage layer is the **idea-to-execution pipeline**. Today, turning a vague project goal into scoped work is a manual, scattered process: the user thinks, prompts the agent, copies tasks somewhere, and tries to track progress across terminal scrollback.

Basebuild should make this a first-class, visual workflow:

- State a final goal (or don't — just brainstorm).
- Press a button to get AI-generated MVP plans, prioritized for the current project.
- Approve, edit, or merge plans.
- Generate more plans with full context of what already exists.
- Push a plan into a focused work mode where Basebuild opens the right terminal/context and tracks status.
- Mark finished plans as complete so the workspace stays clean.

This turns Basebuild from a terminal multiplexer into a **cursive self-improvement surface** for the project it manages.

## What Changes

- Promote the existing **Ideas** concept from a tab into a persistent, right-side **Plan Panel** that is minimizable but always one click away.
- Move the **OMP** panel content into the **Debug** panel so the core tools are **Terminal / Source / Plans**.
- Redesign the plan data model to support the status lifecycle **draft → openspec → waiting → in_progress → finished / cancelled**.
- Add plan fields for a user-facing **title**, longer **description**, optional **final goal / target result**, a stable **reference id**, and a **focus context** (files, notes, last terminal output).
- Add AI plan generation flow: user enters (or accepts default) project goal, clicks **Generate Plans**, and a skill-backed prompt returns prioritized MVP plans.
- Add **Suggest More Plans** flow that sends the full existing plan list + goal + project context back to the model and appends new draft plans.
- Add manual **Create Task** with title/description and an **AI Enhance** button that rewrites/extends a plan before saving.
- Add a plan **Focus** mode that opens a modal with the plan details, context, and actions to copy its reference id or open it directly in a terminal/OMP session.
- Add a **Mark Finished** action that moves a completed plan into a collapsed **Finished** pile.
- Add subtle animations and progress information to the plan lanes.
- Keep the plan panel UI dense, compact, and consistent with the Basebuild Mono Desktop design system (DESIGN.md).

## Capabilities

### New Capabilities

- `plan-pipeline-ui`

### Modified Capabilities

- `desktop-shell` — promoted plan panel becomes a primary column.
- `project-workspaces` — plans are scoped to the active project/session.
- `omp-rpc-integration` — OMP/status moved into Debug panel.

## Impact

- Redefines the main workspace from a three-column shell (projects / workspace / tools) into a three-column creative shell (projects / workspace / plans).
- Replaces the current static idea categories/list with a living plan board.
- Keeps AI generation local and skill-driven instead of depending on a backend.
- Makes the existing `basebuild-idea-generation` skill feed the new plan board instead of a standalone Ideas tab.
- Lays the groundwork for OpenSpec integration: plans in `openspec` status can later spawn real OpenSpec changes.

## Out of Scope

- Cloud-synced plans / basebuild.net backend.
- Automatic plan execution beyond opening a terminal with the plan context injected.
- Real OpenSpec file generation from the `openspec` status (that is a follow-up change).
- GitHub Issues/PRs integration for plan storage.
