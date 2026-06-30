---
version: beta
name: Basebuild Mono Desktop
description: Desktop adaptation of the basebuild Mono design system. Pure black canvas, pure white type, a single high-contrast orange accent, square geometry (0px radius), and a borderless aesthetic adapted to a dense desktop tool. Collapsible columns, icon-only collapse modes, tooltips on every interactive element.
colors:
  background: "#000000"
  surface: "#0a0a0a"
  surface-container: "#0a0a0a"
  surface-container-high: "#141414"
  surface-container-highest: "#1c1c1c"
  on-surface: "#ffffff"
  on-surface-muted: "rgba(255,255,255,0.55)"
  outline: "#1c1c1c"
  outline-strong: "#2a2a2a"
  primary: "#ffffff"
  on-primary: "#000000"
  cta: "#ff5606"
  on-cta: "#ffffff"
  cta-hover: "#ff7a3d"
  positive: "#4ade80"
  negative: "#f87171"
  warning: "#facc15"
  info: "#818cf8"
typography:
  body-md:
    fontFamily: "Space Grotesk"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: "Space Grotesk"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  label-md:
    fontFamily: "Space Grotesk"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.3
  label-sm:
    fontFamily: "Space Grotesk"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.2
  caption:
    fontFamily: "Space Grotesk"
    fontSize: 11px
    fontWeight: 500
    lineHeight: 1.2
  micro-caps:
    fontFamily: "Space Grotesk"
    fontSize: 10px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0.06em
  section-label:
    fontFamily: "Space Grotesk"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0.04em
  mono-code:
    fontFamily: "JetBrains Mono"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
  mono-sm:
    fontFamily: "JetBrains Mono"
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
  mono-micro:
    fontFamily: "JetBrains Mono"
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.3
rounded:
  none: 0px
  sm: 0px
  md: 0px
  lg: 0px
  xl: 0px
  full: 0px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  sidebar:
    backgroundColor: "transparent"
    width: 220px
    borderRight: "1px solid {colors.outline}"
  sidebar-collapsed:
    width: 36px
  tool-rail:
    backgroundColor: "transparent"
    width: 160px
    borderLeft: "1px solid {colors.outline}"
  tool-rail-collapsed:
    width: 36px
  tool-button:
    textColor: "{colors.on-surface-muted}"
    padding: "7px 10px"
    rounded: "{rounded.none}"
  tool-button-active:
    textColor: "{colors.on-surface}"
    backgroundColor: "{colors.surface-container-high}"
  tool-button-active-bar:
    backgroundColor: "{colors.cta}"
    width: "2px"
  btn:
    border: "1px solid {colors.outline}"
    textColor: "{colors.on-surface}"
    padding: "5px 10px"
    rounded: "{rounded.none}"
  btn-primary:
    backgroundColor: "{colors.cta}"
    textColor: "{colors.on-cta}"
    border: "1px solid {colors.cta}"
  btn-ghost:
    border: "1px solid transparent"
    textColor: "{colors.on-surface-muted}"
  btn-icon:
    padding: "5px"
    textColor: "{colors.on-surface-muted}"
  input-field:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-surface}"
    border: "1px solid {colors.outline}"
    padding: "5px 8px"
    rounded: "{rounded.none}"
  input-field-focus:
    borderColor: "{colors.cta}"
  badge:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface}"
    padding: "2px 6px"
    rounded: "{rounded.none}"
  card:
    border: "1px solid {colors.outline}"
    padding: "8px 10px"
    rounded: "{rounded.none}"
  top-bar:
    height: "36px"
    borderBottom: "1px solid {colors.outline}"
  context-menu:
    backgroundColor: "{colors.surface-container-high}"
    border: "1px solid {colors.outline-strong}"
---

## Overview

Basebuild Mono Desktop adapts the basebuild Mono web design system for a
desktop tool. The personality is preserved — **pure black canvas, pure white
type, a single electric orange (`#ff5606`) accent, and square geometry** — but
adapted for a dense, compact, instrument-like workspace.

This is a desktop tool, not a marketing site. The UI is **extremely compact**:
minimal padding, no wasted whitespace between elements, no large empty regions.
Every pixel earns its place. Tooltips on every interactive element so density
never costs clarity.

## Layout

A three-column grid: left sidebar (projects), center workspace, right tool rail.
**Both left and right columns are collapsible** to icon-only mode via toggle
buttons at the top of each column.

- **Left sidebar (220px → 36px collapsed):** Projects list with add/remove/reveal.
  Toggle button at top collapses to icon-only.
- **Center workspace:** Top bar (title + status) + scrollable content area.
- **Right tool rail (160px → 36px collapsed):** Tool buttons with labels, active
  indicator bar (orange), badges. Toggle button at top collapses to icon-only.

## Collapsible Columns

At the top of both the left sidebar and right tool rail, a toggle button
(chevron icon) collapses the column to icon-only width (36px). The transition
is a smooth width animation. In collapsed mode:
- Text labels, badges, and secondary content are hidden.
- Icons are centered.
- Tooltips become essential — hovering shows the full label.

The collapsed state is stored in React state (not persisted yet).

## Tooltips

Every interactive element has a tooltip via the `title` attribute. This is
non-negotiable — density requires that users can discover what an icon does
without clicking. For icon-only (collapsed) states, the tooltip is the primary
label.

## Colors

Same two-tone + orange system as the web:

- **Background (#000000):** Pure black canvas. Sidebar, rail, workspace all share it.
- **Surface ramp:** `#0a0a0a` (hover) → `#141414` (active/selected) → `#1c1c1c` (highest).
- **On-surface (#ffffff):** Pure white primary text.
- **Muted (rgba(255,255,255,0.55)):** Secondary text, labels, inactive icons.
- **Outline (#1c1c1c) / outline-strong (#2a2a2a):** 1px hairlines for borders.
- **CTA (#ff5606 → #ff7a3d hover):** Orange accent. Active tool bar, primary
  buttons, active project icon, commit dots.
- **Positive (#4ade80):** Success, staged files, ahead count.
- **Negative (#f87171):** Destructive actions, deleted files, errors.
- **Warning (#facc15):** Modified files, behind count.
- **Info (#818cf8):** Untracked files, renamed files.

## Typography

- **Space Grotesk** for all UI text.
- **JetBrains Mono** for paths, hashes, numbers, terminal content, file statuses.
- Uppercase + letter-spacing on section labels and micro-caps for the engineered feel.

## Shapes

**0px radius everywhere.** No exceptions. Buttons, cards, inputs, badges, menus —
all square-cornered. This is non-negotiable.

## Hover Effects

Every interactive element has a hover state:
- **Buttons:** Background lifts to `--bb-surface`, border to `--bb-border-strong`.
- **List items:** Background lifts to `--bb-surface`.
- **Active items:** Background lifts to `--bb-surface-high`, plus orange indicator bar.
- **Transitions:** 0.08s for snappy, responsive feel.

## Density Rules

- No padding larger than 8px on list items.
- No gap larger than 8px between elements.
- Top bar height: 36px.
- Sidebar header / rail header: 36px.
- Font sizes: 12px body, 11px secondary, 10px micro/mono.
- Compact icon sizes: 14px in lists, 18px in rail, 20px in headers.

## Visual Inspection Workflow

After every UI change, visually verify by:
1. Running `npm run tauri dev` and launching the app.
2. Taking a screenshot of the running window.
3. Checking: alignment, spacing, hover states, collapsed/expanded modes, tooltips.
4. Testing the actual interaction (click, hover, collapse, etc.).

Never yield a UI change without visual verification.
