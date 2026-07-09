# Basebuild Desktop — Agent Guide

Basebuild is a local-first desktop control plane for AI coding agents — a Tauri
(Rust) + React/TypeScript shell with SQLite local state. **Read this file
before any change.** It wins over other docs on conflict, and a PR that
violates a Mandatory Invariant is rejected regardless of feature quality.

## Architecture posture

Basebuild is **native-first**: the chat system is an in-house Rust agent loop
(`agent_loop_service.rs`) that handles provider streaming, tool calling,
approval gates, and ask_user interactions directly — no external CLI process
required for the primary chat experience. All providers (OpenAI, Anthropic,
Devin, GLM-5.2, etc.) route through this native loop.

OhMyPi (OMP) is a **supported tool**, not the chat transport. OMP may be used
as a terminal panel, a plan runner, and an optional chat profile for users who
want OMP's own tool ecosystem — but it is never the default or required path
for chat. The native agent loop is the default and preferred runtime.

OpenSpec is the **primary planner**. Plan statuses, roadmap tracking, and
change archives all flow through OpenSpec. Basebuild may develop its own
planning system in the future, but OpenSpec is the canonical system today and
any replacement would be a deliberate migration, not a silent substitution.

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
14. **Debug logging on every interaction.** Every button press, panel creation, session start, process spawn, and state transition MUST emit a `addLog("debug", ...)` entry with the action name and key parameters. This is the primary diagnostic surface — when something fails silently, the debug log must show the last action that ran. Use `addLog("debug", "Action name", "details")` at the entry point of every handler, and at every branch that skips or aborts the action. Debug entries are filtered out of the status bar by default but visible in the LogPanel filter.
15. **Slash commands must act, not just notify.** Every builtin slash command in `BUILTIN_COMMANDS` (`src/lib/chatCommands.ts`) MUST have a `category` of `"in-chat"` or `"ui"` and must do something substantial when dispatched:
    - **`"in-chat"`** — does something in the conversation: injects a skill (e.g. `/schematic` injects the project-schematic skill and runs the wizard inline), generates ideas, shows command reference output, or sends a prompt to the provider. The command clears the composer input after dispatch.
    - **`"ui"`** — triggers a substantial Basebuild UI action: opens a picker/modal/tab (e.g. `/model`, `/login`), clears chat (`/clear`), stops a request (`/stop`), refreshes a catalog (`/models refresh`). A command that only shows a static text notice and does nothing else is **not allowed** — either make it do something or remove it.

## Before you yield

Run the full checklist in
[`docs/agents/workflow.md`](./docs/agents/workflow.md#before-you-yield): checks
actually run and passing, tooltips / 0px / styles-in-`globals.css`, behavior
docs updated, roadmap synced if `openspec/changes/**` changed, work on a feature
branch with no silent commits.
