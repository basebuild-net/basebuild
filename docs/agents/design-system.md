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
- The always-visible controls live in `.chat-composer-header`; while the catalog
  loads they render `.chat-select-skeleton` placeholders.
- Assistant streaming arrives on the `native-chat://chunk` Tauri event and is
  appended live; offline turns are flagged with `.chat-offline-tag`.

## Screenshot verification

Every UI change requires a screenshot. See
[`testing.md`](./testing.md#visual-verification).
