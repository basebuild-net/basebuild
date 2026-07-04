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
  it in `AGENTS.md` and this file (`docs/agents/design-system.md`). Do NOT add
  CSS class names or layout mechanics to `DESIGN.md` — it is visual/non-technical
  only.
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
- The always-visible controls live in `.chat-composer-header`, which is a
  single-line nowrap rail. Provider and model labels truncate, effort remains
  adjacent to model selection, refresh/connect buttons can become icon-only,
  and secondary actions use `.chat-inline-menu` / `.chat-picker` overflow
  surfaces before any wrapping occurs. While the catalog loads the rail renders
  `.chat-select-skeleton` placeholders.
- Assistant streaming arrives on the `native-chat://chunk` Tauri event and is
  appended live; offline turns are flagged with `.chat-offline-tag`.

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
