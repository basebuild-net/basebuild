# Proposal: AI Workbench Course Correction

## Why

The MVP hardening work made the backend workflow substantially stronger, but a
live desktop audit on 2026-07-08 still found a prototype-shaped interaction
model: duplicate navigation, stage buttons opening the wrong views, hidden
agent work, provider/model choices that did not reflect authentication or
transport capability, a broken settings layout, and manual plan creation in a
workflow that is meant to be AI-generated.

Basebuild needs one legible product hierarchy: projects and chats at the left,
the active agent conversation in the center, compact project context above it,
and exact top-level destinations for Schematic, Ideas, Plans, Runs, and Changes.
The visual restraint and chat-first density of
[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) are useful reference
points, while Basebuild keeps its own local-first planning, OpenSpec, worker,
worktree, and approval systems.

## What Changes

- Establish a single AI-workbench navigation contract. Project Schematic is a
  dedicated project modal, Ideas and Plans open their exact tabs, and duplicate
  chat-level planning entry points are removed.
- Make plan creation AI-only. Plans originate by promoting structured ideas or
  importing validated artifacts; there is no blank/manual "Create plan" path.
- Make agent work visible. Context reads, reasoning availability, tool calls,
  questions, captures, approvals, errors, and completion appear in one ordered
  activity timeline instead of an inert "gathering information" message.
- Make provider/model selection truthful and sticky. Connected providers come
  first, models are provider-scoped, session selections survive restart, effort
  options are capability-scoped, and transports that cannot expose tools do
  not advertise planning support.
- Normalize modal and compact-window behavior, including side-by-side settings,
  viewport-safe popovers, responsive planning content, and a stable loading
  boundary during project switching.
- Replace cramped dropdown configuration with modal-first, high-density
  workspaces. Provider/model selection uses a two-pane modal, a provider grid,
  explicit green Connected and grey Available states, capability badges, and
  enough vertical space to scan large catalogs.
- Audit every persistent top-bar control and remove duplicates, raw ids, and
  ambiguous status pills. Small menus remain popovers; browsing/configuration
  and multi-step work use named modals that can own the screen.
- Add a focused UI harness that asserts exact routing, persistence, capability
  truth, visible agent activity, 960x640 behavior, and absence of manual plan
  creation.

## Capabilities

### New Capabilities

- `ai-workbench-shell` — the product hierarchy, exact stage routing, compact
  context header, project-modal ownership, and responsive layout contract.

### Modified Capabilities

- `plan-pipeline-ui` — AI-only plan origin, exact Ideas/Plans destinations, and
  visible generation/approval flow.
- `provider-model-catalog` — connected-first ordering, provider-scoped models,
  capability truth, and session selection restoration.
- `tool-transcript-rendering` — one ordered agent activity timeline with clear
  running, waiting, approval, failure, and completion states.
- `schematic-inspector` — a dedicated project-modal questionnaire and activity
  surface instead of treating Schematic as a chat or Plans alias.
- `ide-workspace-state` — restored project/chat/panel/provider/model focus and a
  no-stale-content switching boundary.
- `testing-automation` — course-correction interaction and compact-layout gates.

## Impact and Ordering

- Primary frontend surfaces: `AppShell`, `CommandStrip`, `ChatPanel`,
  `ChatComposerRail`, `PlanningInspector`, `PlanPanel`, `SettingsModal`, and
  `globals.css`.
- Runtime work may touch native chat/OMP event normalization and catalog
  capability mapping, but SHALL reuse domain services and thin invoke wrappers.
- This change supersedes the "Planning Inspector unchanged" assumption in
  `chat-first-shell`. Finish or explicitly retire that change's overlapping
  shell/composer tasks before applying phases 3-6 here.
- `provider-parity-workspace-fixes` remains the owner of protocol routing and
  the vendored OMP catalog. This change consumes its api-kind/auth/capability
  truth and owns the user-facing ordering, persistence, and unsupported states.
- No new UI framework is introduced. Existing design invariants remain:
  `globals.css` only, 0px radius, tooltips, local-first data, debug logging.
