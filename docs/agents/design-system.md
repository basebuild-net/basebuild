# Design System

`DESIGN.md` is the canonical visual design reference. Read it before any UI
change. This document links to it and adds agent-specific rules.

## Core principles

- **Pure black canvas** (`#000000`), pure white text (`#ffffff`), single orange
  accent (`#ff5606`). Exception: app update install CTAs use blue (`#2563eb`)
  so releases are visually distinct from normal actions.
- **0px border radius everywhere.** No exceptions.
- **No decorative borders.** Layer on whitespace, hover lifts, and uppercase
  typography.
- **Fonts:** Space Grotesk (UI), JetBrains Mono (numbers, paths, code, terminal).
- **Compact and dense.** Minimal padding, no wasted space.
- **Tooltips on every interactive element** (`title` attribute). Verify with
  `title=`, not just `aria-label`.

## CSS rules

- `src/styles/globals.css` is the only stylesheet. No CSS modules, no styled
  components, no inline styles.
- Keep CSS under 400 lines is the goal — audit before adding.
- Before adding a new class, find an existing one. If you must add one, document
  it in this file (`docs/agents/design-system.md`). Do NOT add CSS class names
  or layout mechanics to `DESIGN.md` — it is visual/non-technical only.
- Prefer layout primitives (`.stack`, `.row`, `.card`) over bespoke component CSS.

## Reusable classes

Current classes include `.btn`, `.btn-primary`, `.btn-update`, `.btn-ghost`,
`.btn-icon`, `.btn-icon-sm`, `.btn-sm`, `.card`, `.badge`, `.pill`, `.input`,
`.pre`, `.stack`, `.stack-sm`, `.row`, `.row-between`, `.text-muted`,
`.text-sm`, `.text-ok`, `.text-danger`, `.mono`, `.spin`.

## Component reuse

- A pattern that appears twice should be a component or utility.
- A pattern that appears three times must be a component or utility.
- Modals share one overlay/class contract; use the existing modal shape.
- Keep business logic in `src/lib/` and `src-tauri/src/services/`, not inline
  in components.

## Chat composer layout (technical)

The composer must be structurally impossible to clip:

- The full height chain is `min-height: 0` bounded: `.app-shell` uses
  `grid-template-rows: minmax(0, 1fr)` + `min-height: 0`; `.workspace-panel` and
  `.workspace-scroll` are `min-height: 0`.
- `.chat-panel` is a flex column; `.chat-messages { flex: 1 1 0; min-height: 0 }`
  absorbs all overflow so the composer never grows the panel.
- `.chat-input-area` is a `flex-shrink: 0` footer and a **sibling** of the scroll
  region (never inside it), with a `min-height` and a top border so it is always
  visible even when empty.
- The input is a `.chat-input` textarea inside `.chat-input-row`. It is
  auto-growing: on each change its height is reset to `scrollHeight`, capped
  (see `ChatPanel.tsx`) so it grows tall enough for long drafts before
  scrolling internally. `.chat-messages` yields the space, so growth never
  clips the composer.
- The always-visible controls live in `.chat-composer-header`, a single-line
  rail. Model picker and effort selector stay visible at all times (labels may
  truncate; effort stays adjacent to model). Keep the rail minimal — prefer
  slash-command accelerators (`/login`, `/model`, `/models refresh`) over
  adding buttons; reserve `.chat-inline-menu` / `.chat-picker` surfaces for
  genuinely secondary actions, not for the model/effort essentials. While the
  catalog loads the rail renders `.chat-select-skeleton` placeholders.
- Assistant streaming arrives on the `native-chat://chunk` Tauri event and is
  appended live; offline turns are flagged with `.chat-offline-tag`.
- Reasoning/thinking tokens render in a `.reasoning-fold` collapsed section
  above the reply (muted label + chevron; expanded body is `.text-muted` on
  `var(--bb-surface)` with a top divider). The fold auto-expands while
  streaming and collapses on completion; reasoning is never concatenated into
  the persisted content string.
- Consecutive tool calls in one assistant turn collapse into a
  `.tool-card-group` row (running count + aggregate status + latest summary).
  The expanded list `.tool-card-group-list` is height-capped and auto-follows
  the newest call while the run is active; a long run must not push
  conversation text out of view.
- Structured ideas render as `.chat-idea-card` rows inside the chat
  transcript (title, description, `.chat-idea-card-actions` with `Promote` /
  `Reject`). Promoted cards show a `Planned` status badge; rejected cards
  show `Rejected`. Cards are append-only and reload with the session.
- The Planning Inspector (`.planning-inspector`) has three tabs
  (`.inspector-tab`): Plans, Ideas, and Categories. The Ideas tab has
  status filter chips (`.inspector-filter-chip`) and per-idea promote/reject
  actions. The Categories tab lists `.inspector-category-card` entries with
  idea counts and drill-down detail.

## Project schematic tab (technical)

The schematic tab (`.project-schematic-tab`) renders `.basebuild/project-schematic.md`
as a structured section-card view by default, with a raw-markdown toggle:

- Toolbar: `.project-schematic-toolbar` + `.project-schematic-toolbar-title`,
  hosting `Start wizard`, raw-view toggle, and edit actions.
- Health badge: `.schematic-health-badge` with `.is-complete` (positive),
  `.is-partial` (warning), `.is-missing` (negative) states. Rendered in the
  schematic toolbar and the Planning Inspector; it is a button (opens raw view
  in the tab; opens the wizard from the inspector) and needs `title=`.
- Nudge bar: `.schematic-nudge` — warning-tinted row for missing/stale end
  goals ("Set a year-end and a month-end goal…") with a wizard-scoped action.
- Section cards: `.schematic-section-card` (+ `.is-missing`/`.is-placeholder`
  warning tint), `.schematic-section-header`, `.schematic-section-title`,
  `.schematic-section-state` fill-state micro-label (`.is-filled` /
  `.is-placeholder` / `.is-missing`), `.schematic-section-body`,
  `.schematic-section-placeholder`, `.schematic-section-actions` (per-section
  `Fill` buttons that start the wizard scoped to that section).
- End goals: `.schematic-end-goal-row` with mono `.schematic-end-goal-period`
  and `.schematic-end-goal-stale` tag.
- Raw view: `.schematic-raw` mono block.
- Empty state uses `.empty-state-actions` (button row) offering `Start wizard`
  first.

The wizard itself is not a modal: entry points inject a guided prompt into the
chat (skill-driven turn). The chat soft-gate notice is a full-width button
(`.chat-command-notice-button`) that opens the schematic tab.

Idea grounding/anchor flags on idea cards and inspector rows:
`.idea-grounding` (muted evidence line), `.idea-anchor` (CTA-colored anchor
line), `.idea-outside-focus` (warning italic flag). All have `title=` tooltips.

## Plan run queue and final touches (technical)

The plans side panel includes a run queue section (`.plan-queue-section`)
below the plan list. It contains:
- A profile selector (`.plan-queue-concurrency` input + `.plan-queue-start` /
  `.plan-queue-pause` buttons) with tooltips.
- Enqueue buttons for ready plans (`.plan-queue-enqueue-btn`).
- A queue list (`.plan-queue-list`) with per-entry status
  (`.plan-queue-run-status-*` classes for running/succeeded/failed/cancelled).
  All interactive elements have `title=` tooltips and 0px radius.

Settings → Final Touches tab uses `.final-touch-list`, `.final-touch-step`,
`.final-touch-toggle`, and `.final-touch-add` classes. All inputs, selects,
and buttons use 0px radius and `var(--bb-surface)` backgrounds.

## Screenshot verification

Every UI change requires a screenshot. See
[`testing.md`](./testing.md#visual-verification).
