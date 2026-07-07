# Basebuild Desktop — Agent Guide

Basebuild is a local-first desktop control plane for AI coding agents — a Tauri
(Rust) + React/TypeScript shell over OMP and terminal tools, with SQLite local
state. **Read this file before any change.** It wins over other docs on
conflict, and a PR that violates a Mandatory Invariant is rejected regardless of
feature quality.

## Read before you work

Detailed, verbose guides live in `docs/agents/`. Read the one that matches your
task before touching that area:

| Task area | Doc |
|---|---|
| Start / apply / archive an OpenSpec change; roadmap sync | [`docs/agents/openspec.md`](./docs/agents/openspec.md) |
| Verify a change before yielding; CI, crash/freeze drills | [`docs/agents/testing.md`](./docs/agents/testing.md) |
| Contributor workflow: branches, commits, docs upkeep, yield checklist | [`docs/agents/workflow.md`](./docs/agents/workflow.md) |
| UI, CSS, layout, visual conventions | [`docs/agents/design-system.md`](./docs/agents/design-system.md) (+ `DESIGN.md`, visual-only) |
| Chat, terminal, OMP, adapters, permissions, analytics, defaults | [`docs/agents/agent-runtime.md`](./docs/agents/agent-runtime.md) |
| Tabs, panels, workspace routing, session state | [`docs/agents/desktop-shell.md`](./docs/agents/desktop-shell.md) |
| Build, architecture, project layout, releases, secrets | [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md), [`docs/SECRETS.md`](./docs/SECRETS.md) |

## Mandatory Invariants

Non-negotiable and enforced in review. Rationale and how-to in
[`docs/agents/workflow.md`](./docs/agents/workflow.md).

1. **One stylesheet** — `src/styles/globals.css` only. No CSS modules, no inline styles.
2. **0px border radius.** No exceptions.
3. **Tooltips (`title=`) on every interactive element.** Blue (`#2563eb`) is reserved for app-update CTAs.
4. **Local-first.** No data-uploading network calls unless explicitly specified.
5. **No silent side effects.** Ask before destructive actions, commits, PRs, or installs.
6. **`type` over `interface`** for sidecar object shapes.
7. **Lib files are thin Tauri invoke wrappers** — no React state logic.
8. **One service per domain.** Commands validate input, call the service, map errors.
9. **Statuses are `snake_case`.** Plans: `draft → openspec → ready → running → finished` (`cancelled` reachable from any non-terminal). Ideas: `concept → picked → rejected → archived`.
10. **Commit in verified milestones.** No silent commits — report commit points unless the user asked for commits ([workflow.md](./docs/agents/workflow.md#commit-milestones-invariant-10)).
11. **Feature branches only.** Never build on or push to `main` ([workflow.md](./docs/agents/workflow.md#feature-branches-invariant-11)).
12. **Roadmap tracks OpenSpec.** Any `openspec/changes/**` edit ships in the same commit with `node scripts/openspec-status.mjs --write` **and** a `openspec/ROADMAP.md` narrative pass ([openspec.md](./docs/agents/openspec.md)).
13. **Archive when complete.** When all tasks in a change's `tasks.md` are `[x]`, run `/archive <name>` in the same session — do not leave completed changes in `openspec/changes/`. The roadmap status table + narrative MUST reflect the archive in the same commit ([openspec.md](./docs/agents/openspec.md#archiving-a-change)).

## Before you yield

Run the full checklist in
[`docs/agents/workflow.md`](./docs/agents/workflow.md#before-you-yield): checks
actually run and passing, tooltips / 0px / styles-in-`globals.css`, behavior
docs updated, roadmap synced if `openspec/changes/**` changed, work on a feature
branch with no silent commits.
