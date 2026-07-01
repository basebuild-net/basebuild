# Design System

`DESIGN.md` is the canonical visual design reference. Read it before any UI
change. This document links to it and adds agent-specific rules.

## Core principles

- **Pure black canvas** (`#000000`), pure white text (`#ffffff`), single orange
  accent (`#ff5606`).
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
  it in `AGENTS.md` and `DESIGN.md`.
- Prefer layout primitives (`.stack`, `.row`, `.card`) over bespoke component CSS.

## Reusable classes

Current classes include `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-icon`,
`.btn-icon-sm`, `.card`, `.badge`, `.pill`, `.input`, `.pre`, `.stack`,
`.stack-sm`, `.row`, `.row-between`, `.text-muted`, `.text-sm`, `.text-ok`,
`.text-danger`, `.mono`.

## Component reuse

- A pattern that appears twice should be a component or utility.
- A pattern that appears three times must be a component or utility.
- Modals share one overlay/class contract; use the existing modal shape.
- Keep business logic in `src/lib/` and `src-tauri/src/services/`, not inline
  in components.

## Screenshot verification

Every UI change requires a screenshot. See
[`testing.md`](./testing.md#visual-verification).
