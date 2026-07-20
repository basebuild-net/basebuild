---
version: beta
name: Basebuild Mono Desktop
description: Desktop adaptation of the basebuild design system. Two tokenized themes (graphite-grey Dark default, soft-neutral Light), white/near-black type, vibrant semantic status colors for plan/tool/status types, restrained radius scale (6/10/14px + full), and a layered surface aesthetic adapted to a calm desktop tool. All colors are CSS variables, applied via data-bb-theme before React paints. Collapsible columns, icon-only collapse modes, tooltips on every interactive element.
colors:
  dark:
    background: "#18181b"
    chrome: "#131316"
    surface: "#1c1c21"
    surface-high: "#26262c"
    surface-highest: "#2e2e36"
    on-surface: "#f4f4f5"
    on-surface-muted: "rgba(244,244,245,0.55)"
    outline: "#27272a"
    outline-strong: "#3f3f46"
    cta: "#ff5606"
    on-cta: "#ffffff"
    cta-hover: "#ff7a3d"
    positive: "#4ade80"
    negative: "#f87171"
    warning: "#facc15"
    info: "#818cf8"
  light:
    background: "#f4f4f5"
    chrome: "#ececef"
    surface: "#ffffff"
    surface-high: "#f4f4f5"
    surface-highest: "#e4e4e7"
    on-surface: "#18181b"
    on-surface-muted: "rgba(24,24,27,0.55)"
    outline: "#d4d4d8"
    outline-strong: "#a1a1aa"
    cta: "#ff5606"
    on-cta: "#ffffff"
    cta-hover: "#ff7a3d"
    positive: "#16a34a"
    negative: "#dc2626"
    warning: "#ca8a04"
    info: "#4f46e5"
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
  sm: 6px
  md: 10px
  lg: 14px
  full: 9999px
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
  side-panel:
    backgroundColor: "transparent"
    width: 260px
    borderLeft: "1px solid {colors.outline}"
  side-panel-collapsed:
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
    rounded: "{rounded.sm}"
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
    rounded: "{rounded.sm}"
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
    rounded: "{rounded.sm}"
  input-field-focus:
    borderColor: "{colors.cta}"
  badge:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface}"
    padding: "2px 6px"
    rounded: "{rounded.sm}"
  option-list:
    border: "1px solid {colors.outline}"
    rounded: "{rounded.sm}"
  option-list-item:
    textColor: "{colors.on-surface-muted}"
    padding: "4px 8px"
    rounded: "{rounded.sm}"
  option-list-item-active:
    textColor: "{colors.on-surface}"
    backgroundColor: "{colors.surface-container-high}"
    borderBottom: "2px solid {colors.cta}"
  card:
    border: "1px solid {colors.outline}"
    padding: "8px 10px"
    rounded: "{rounded.md}"
  top-bar:
    height: "36px"
    borderBottom: "1px solid {colors.outline}"
  context-menu:
    backgroundColor: "{colors.surface-container-high}"
    border: "1px solid {colors.outline-strong}"
---

## Overview

Basebuild Mono Desktop adapts the basebuild web design system for a
desktop tool. The personality is **layered neutral surfaces, clear type,
vibrant semantic colors for status/tool types, and restrained geometry** —
adapted for a calm, focused workspace. Two tokenized themes (graphite-grey
**Dark** default, soft-neutral **Light**) are applied via `data-bb-theme`
before React paints; all colors are CSS variables in `globals.css`.

The CTA accent is Basebuild orange (`#ff5606`), providing a warm focus point
while plan statuses, tool call types, and context meters use vibrant semantic
colors (green, blue, purple, amber, red) to make state visible at a glance.
Color never acts alone — every state has a word and icon alongside it.

This is a desktop tool, not a marketing site. The UI is **disciplined but
spacious**: a 4px-based spacing scale with more whitespace than the old dense
contract, restrained radius (6/10/14px + full for circular), and clear visual
hierarchy. Tooltips on every interactive element so clarity never costs density.

## Layout

A **single global left column** and a **chat-focused center**. There is no
right side panel — everything that used to live there (source, plans, ideas,
files) now lives either in the left column or as a compact floating block over
the chat. The app shell is a two-region grid: the left column (fixed width,
collapsible to icon-only) and the center chat surface (fills the rest).

- **Left sidebar (240px → 44px collapsed):** The global control surface for the
  whole app, not per-chat. From top to bottom:
  1. **Top action row** — `New chat`, `Search`, and the column collapse toggle.
     These are the primary actions; no other top bar.
  2. **Projects + chats list** — the body of the column. Each project is a
     section with its chats listed underneath. **Only the 5 most recent chats
     per project are shown**, each with a relative timestamp (`5s`, `1min`,
     `2h`, `1mo`) and a pin toggle. A `Show more` row under each project expands
     the older chats for that project. Pinned chats sit in their own section at
     the top of the list (across all projects) and do not count against the 5.
  3. **Bottom account row** — username / avatar and settings. The global update
  indicator sits here too; when an update is detected it becomes a compact
  one-click install button beside the avatar. This is the only non-CTA
  button and is reserved for app updates.

  Collapsing the column to icon-only hides the list and labels; tooltips carry
  the full text.

- **Center chat surface:** The whole center is the active chat. No tool tabs or
  right panel. A compact sticky configuration header sits above the independently
  scrolling transcript, and the composer stays pinned to the bottom. Two things
  float over the chat on the top-right; everything else is the conversation.

### Floating environment info (top-right of chat)

A compact, ~100px-tall block pinned to the top-right of the chat surface. It
  surfaces the project environment at a glance and is the new home for the
  panels that used to live in the right sidebar, each as a foldable tab inside
  the block:

- **Changes / branch / source** — current git branch, ahead/behind, and the
  staged/unstaged/untracked counts. Inline actions: commit, push, pull. The
  diff/list view opens as a popover from the block, not a full column.
- **Plans & Ideas** — the Planning Inspector (`Plans / Ideas / Categories /
  Flow / Changes` tabs) opens as a project modal from the command strip and
  remains available from the environment block. Schematic health and End-goal
  nudge render in this fold when relevant. Generation is still triggered from
  the chat composer's planning menu and runs as a visible chat turn — the block
  is for inspecting and managing, not for generation inputs.
- **Files** — opens a **modal file explorer**, not an inline tree. A single
  button in the block opens a full-window modal with a cleaner, purpose-built
  file browser (tree on the left, preview/detail on the right, fuzzy path
  search at the top). The giant always-visible file list is gone.

The block is collapsible; when folded it shows just the branch name and a
  health dot. It floats above the transcript and never pushes chat content.

### Workspace tabs and project surfaces

Terminal sessions and the file viewer open as **workspace tabs over the
center**. The Project Schematic is project-owned and opens in its dedicated
modal from the top-level Schematic stage; it is not represented as a new chat.
Workspace tabs are per-session and use `terminal`, `file`, and `chat` kinds.
There is no always-visible tab bar; the active tab is indicated in the session
header and switching is via the left column or keyboard. The default tab is the
chat.

### Chat composer

The composer is intentionally minimal: a compact two-line input that grows for
long drafts, plus send/stop. Configuration belongs in one sticky header instead
of being repeated above and below the input.

- **Compact, growing input.** The text field starts at two lines and grows as
  you type, remaining readable for long prompts before it scrolls internally.
  The message list yields space to the input, never the other way around.
- **One configuration header.** Model, effort, textual permission mode, run
  state, context usage, and branch live in the sticky chat header. Model opens
  the provider/model workspace; effort and permission use compact dropdowns.
- **Measured context circle.** A small circular indicator shows the latest
  completed session request against the selected model's context window. Its
  tooltip carries the exact token ratio and percentage. A new chat shows zero,
  never ambiguous “unknown usage” text.
- **Minimal chrome.** The footer contains only the growing input and send/stop.
  Commands have one header icon. Copy/debug/history and other rare actions live
  in the header menu or slash-command flows.
- **Focused surface.** Focusing the textarea outlines the complete composer
  area in the CTA accent so keyboard focus is unambiguous.
- **Pinned, never clipped.** The composer stays at the bottom of the chat panel
  at any window size; the conversation scrolls, the composer does not.
- **Follow latest by default.** New turns and streamed output remain visible
  while the reader is at the bottom. Scrolling upward preserves the reading
  position until the reader returns to the bottom or uses the latest control.
- Every interactive control has a tooltip. Offline (local-coordinator) replies
  carry an amber “Offline” tag so local output is never mistaken for a provider
  answer.

## Collapsible Columns

The left sidebar collapses to icon-only width (44px) via the toggle in its top
action row. The transition is a smooth width animation. In collapsed mode:
- The projects/chats list and all text labels are hidden.
- Top action icons and the account row remain visible.
- Tooltips become essential — hovering shows the full label.

The collapsed state is stored in React state (not persisted yet).

## Product hierarchy

The shell has four ownership levels. A control belongs to one level only:

1. **Global navigation** — project/chat history and account controls (left
   sidebar).
2. **Project command strip** — Schematic, Ideas, Plans, Running, Done. Each
   stage button opens its exact destination; it never creates a surrogate
   chat or defaults to a sibling tab.
3. **Active chat** — transcript/activity timeline and composer.
4. **Project modals** — Schematic, Planning, Changes, Files, Settings.

The top bar is an orientation/action strip, not a telemetry dump. It contains
named project utilities, project/branch/workspace context, and planning stages.
The per-chat sticky header owns provider/model/effort/permission/context; raw
session ids, global request totals, inactive-plan placeholders, and duplicate
model/project badges do not render.

### Borders and accents

Borders are minimal and honest: 1px, full perimeter, or none at all.

- **Never a single-side thick border on a rounded surface.** A 2-3px left or
  top rail on a card, callout, modal, or any container with border radius
  reads as unfinished. If a surface has a border, the border runs all the way
  around at 1px.
- **State is a full-perimeter tint, not a rail.** Connected, warning, and
  error states tint the whole 1px border (mixed toward the semantic color),
  shift the background, or add an icon and word. Examples: connected provider
  cards, requirement rows, approval tool cards.
- **Prefer minimal.** Default surfaces may be borderless and rely on
  background contrast against the parent; use borders to separate
  interactive or nested surfaces from their container.
- **Sanctioned partial accents are flat only.** The 2px active underline on
  tabs and option-list items, and the 2px active bar on flush square list
  rows (sidebar rows, menu rows, pickers), remain allowed because those
  elements have no rounded corner on the accent edge.

### Selection controls

Fixed, roomy settings choices use a **square option list**: a bordered row of
buttons where the active option has a CTA underline, `aria-pressed`, and a
tooltip. Exception: the dense chat header uses square native dropdowns for
effort and permission mode so all configuration fits on one 28px rail without
duplicating controls in the composer. These dropdowns retain radius tokens,
visible text, keyboard support, and `title=` tooltips.

- **Option list** — 2-6 fixed options in forms and settings. All visible, one
  active. Radius tokens, 1px outline border around the group.
- **Compact header dropdown** — effort and permission mode in the chat header.
  Text remains visible; the menu opens only when the user changes configuration.
- **Card catalog** — models and providers only. The searchable card grid
  (provider cards, model rows) stays the single pattern for model selection.
- **Native `<select>`** — also permitted for long dynamic lists (runtime
  profiles, git AI provider/model, category filters) until a dedicated
  list-picker capability replaces them.

### Modal versus popover

Use a popover only for a short, single-step choice that can be understood in
roughly 6-8 rows (chat actions, branch switch, New panel). Use a modal for
search/browse configuration, multi-column content, previews, forms, or catalogs
(provider/model, Schematic, Planning, Changes, Files, Settings). Modal layouts
may obscure the chat: focused configuration is the current task.

### Semantic visual states

Color never acts alone — every state has text/icon redundancy:

- **Connected/success** — green (`#4ade80`). Connected providers, staged files,
  ahead count, completed runs.
- **Unavailable/inactive** — grey (muted). Available providers, inactive stages.
- **Warning** — amber (`#facc15`). Modified files, behind count, setup-required
  providers, stale schematic.
- **Error** — red (`#f87171`). Destructive actions, failed runs, deleted files.
- **Active selection** — foreground CTA (`#f4f4f5`). Selected provider card,
  active project, current tab.

### Loading and errors

Project switching immediately replaces project content with a stable loading
surface. Modal bodies use visible skeleton/loading/error/empty states; Suspense
fallbacks for user-opened surfaces are never blank. Errors include a retry and
are debug-logged with action and project/session identifiers.

## Tooltips
Every interactive element has a tooltip via the `title` attribute. This is
non-negotiable - density requires that users can discover what an icon does
without clicking. For icon-only (collapsed) states, the tooltip is the primary
label.

## Colors

Two tokenized themes applied via `data-bb-theme` before React paints:

### Dark (default, `data-bb-theme="dark"`)

Graphite-grey canvas with layered surfaces and orange CTA accent:

- **Background (`#18181b`):** Graphite canvas. Sidebar, rail, workspace all share it.
- **Chrome (`#131316`):** Shell-level surfaces (taskbar, sidebar, tool-rail, status-bar) for depth.
- **Surface ramp:** `#1c1c21` → `#26262c` (high) → `#2e2e36` (highest).
- **On-surface (`#f4f4f5`):** Primary text.
- **Muted (`rgba(244,244,245,0.55)`):** Secondary text, labels, inactive icons.
- **Outline (`#27272a`) / outline-strong (`#3f3f46`):** 1px hairlines for borders.
- **CTA (`#ff5606` → `#ff7a3d` hover):** Orange accent. Active tool bar, primary
  buttons, active project icon, commit dots.
- **Positive (`#4ade80`):** Success, staged files, ahead count.
- **Negative (`#f87171`):** Destructive actions, deleted files, errors.
- **Warning (`#facc15`):** Modified files, behind count.
- **Info (`#818cf8`):** Untracked files, renamed files.
- **Context meter:** healthy `#4ade80`, warn `#f59e0b`, critical `#f87171`.
- **Update (`#2563eb`):** App update availability and one-click install CTA only.

### Light (`data-bb-theme="light"`)

Soft-neutral canvas with white surfaces and deeper semantic colors:

- **Background (`#f4f4f5`):** Soft neutral canvas.
- **Chrome (`#ececef`):** Shell-level surfaces for subtle depth.
- **Surface ramp:** `#ffffff` → `#f4f4f5` (high) → `#e4e4e7` (highest).
- **On-surface (`#18181b`):** Primary text.
- **Muted (`rgba(24,24,27,0.55)`):** Secondary text, labels, inactive icons.
- **Outline (`#d4d4d8`) / outline-strong (`#a1a1aa`):** 1px hairlines for borders.
- **CTA (`#ff5606` → `#ff7a3d` hover):** Same orange accent.
- **Positive (`#16a34a`), Negative (`#dc2626`), Warning (`#ca8a04`), Info (`#4f46e5`):** Deeper
  semantic colors for light-background contrast.

## Typography

- **Space Grotesk** for all UI text.
- **JetBrains Mono** for paths, hashes, numbers, terminal content, file statuses.
- Uppercase + letter-spacing on section labels and micro-caps for the engineered feel.

## Shapes

**Restrained radius via tokens.** No hardcoded radius values — use CSS variable tokens:

- **`--bb-radius-sm` (6px):** Controls, inputs, badges, option list items.
- **`--bb-radius-md` (10px):** Cards, popovers, modals, context menus, notifications.
- **`--bb-radius-lg` (14px):** Composer, major floating surfaces.
- **`--bb-radius-full` (9999px):** Circular elements — dots, pills, icon buttons, context meter.

The `check-ui-invariants` script enforces that all `border-radius` declarations use either `0` or a `var(--bb-radius-*)` token.

## Hover Effects

Every interactive element has a hover state:
- **Buttons:** Background lifts to `--bb-surface`, border to `--bb-border-strong`.
- **Active items:** Background lifts to `--bb-surface-high`, plus CTA indicator bar.
- **Transitions:** 0.08s for snappy, responsive feel.

## Spacing

4px-based scale via `--bb-space-*` tokens:

- **xs (4px):** Tight internal padding, icon gaps.
- **sm (8px):** List item padding, small gaps.
- **md (12px):** Card padding, standard gaps.
- **lg (16px):** Section padding, large gaps.
- **xl (24px):** Major section separation.
- Top bar height: 36px. Sidebar/rail header: 36px.
- Font sizes: 13px body, 12px secondary, 11px micro/mono.
- Icon sizes: 14px in lists, 18px in rail, 20px in headers (`--bb-icon-sm/md/lg`).

## Planning cockpit surfaces

New surfaces added by the `planning-cockpit` change:

- **Command strip** — session header row with 5 stage icons + counts. Status
  colors: active = CTA pulse, empty = muted, ok = positive green.
  Collapses to a badge; radius tokens on all elements.
- **Destination picker** — managed modal dialog listing open chat panels +
  "New conversation". Uses the standard `.modal-overlay` / `.modal` pattern.
- **Changes panel** — OpenSpec change catalog with artifact chips (P/D/T/S),
  progress bars, phase-grouped task checklists. Radius tokens on all cards,
  chips, and checkboxes.
- **Completion card** — rendered in the Flow board's Finished stage. Shows
  run status, source-control context, and confirm-gated Commit / Create PR
  actions in collapsible `<details>` sections.
- **Confirm dialog** — managed modal replacing `window.confirm`. Destructive
  variant uses negative red border.
- **Quick-reply chips** — small clickable buttons below assistant messages
  with enumerated options. Radius tokens, CTA accent on hover.
- **Wide layouts** — container queries at ≥1100px switch planning and
  source surfaces to master–detail row layout; stacked below.

## Visual Inspection Workflow

After every UI change, visually verify by:
1. Running `npm run tauri dev` and launching the app.
2. Taking a screenshot of the running window.
3. Checking: alignment, spacing, hover states, collapsed/expanded modes, tooltips.
4. Testing the actual interaction (click, hover, collapse, etc.).

Never yield a UI change without visual verification.
