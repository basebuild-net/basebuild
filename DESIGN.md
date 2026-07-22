---
version: beta
name: Basebuild Mono Desktop
description: Desktop adaptation of the basebuild design system. Two tokenized themes (graphite-green Dark default, soft-neutral Light), high-contrast type on graphite surfaces, restrained green CTA accent with amber/red semantic status, restrained radius scale (6/10/14px + full), and a layered surface aesthetic adapted to a calm desktop tool. All colors are CSS variables, applied via data-bb-theme before React paints. Single-surface workspace with split-tree layout, collapsible columns, icon-only collapse modes, tooltips on every interactive element.
colors:
  dark:
    background: "#101211"
    chrome: "#0c0e0d"
    surface: "#171a18"
    hover: "#1e221f"
    selected: "#272c28"
    surface-high: "#1e221f"
    surface-highest: "#272c28"
    on-surface: "#eef2ef"
    secondary: "#c8cec9"
    on-surface-muted: "rgba(238,242,239,0.55)"
    muted: "#98a19a"
    faint: "#7c857e"
    outline: "#303632"
    outline-strong: "#3a413c"
    cta: "#6ea97a"
    on-cta: "#0b140d"
    cta-hover: "#7cba88"
    positive: "#6ea97a"
    negative: "#cf7373"
    danger: "#cf7373"
    warning: "#d0a04a"
    info: "#b8c0ba"
    update: "#3b82f6"
  light:
    background: "#f5f6f3"
    chrome: "#ebeee8"
    surface: "#ffffff"
    hover: "#f0f2ee"
    selected: "#e4e8e2"
    surface-high: "#f0f2ee"
    surface-highest: "#e4e8e2"
    on-surface: "#1a1d1b"
    secondary: "#4a524d"
    on-surface-muted: "rgba(26,29,27,0.55)"
    muted: "#6b746e"
    faint: "#8a938c"
    outline: "#d4d8d3"
    outline-strong: "#a8b0aa"
    cta: "#4d8a5a"
    on-cta: "#ffffff"
    cta-hover: "#427a52"
    positive: "#4d8a5a"
    negative: "#b85858"
    danger: "#b85858"
    warning: "#a87826"
    info: "#6b7570"
    update: "#2563eb"
typography:
  chat-reading:
    fontFamily: "Space Grotesk"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.55
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
    fontSize: 11px
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
  target-absolute: 24px
  target-repeated: 28px
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
    backgroundColor: "{colors.surface-high}"
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
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    border: "1px solid {colors.outline}"
    padding: "5px 8px"
    rounded: "{rounded.sm}"
  input-field-focus:
    borderColor: "{colors.cta}"
  badge:
    backgroundColor: "{colors.surface-high}"
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
    backgroundColor: "{colors.surface-high}"
    borderBottom: "2px solid {colors.cta}"
  card:
    border: "1px solid {colors.outline}"
    padding: "8px 10px"
    rounded: "{rounded.md}"
  top-bar:
    height: "36px"
    borderBottom: "1px solid {colors.outline}"
  context-menu:
    backgroundColor: "{colors.surface-high}"
    border: "1px solid {colors.outline-strong}"
---

## Overview

Basebuild Mono Desktop adapts the basebuild web design system for a
desktop tool. The personality is **layered graphite surfaces, clear type,
a restrained green CTA accent, and semantic amber/red status** — adapted
for a calm, focused workspace. Two tokenized themes (graphite-green
**Dark** default, soft-neutral **Light**) are applied via `data-bb-theme`
before React paints; all colors are CSS variables in `globals.css`.

The CTA accent is Basebuild green (`#6ea97a`), providing a calm focus
point. Plan statuses, tool call types, and context meters use restrained
semantic colors (green, amber, red, neutral) to make state visible at a
glance. Color never acts alone — every state has a word and icon
alongside it.

This is a desktop tool, not a marketing site. The UI is **disciplined but
spacious**: a 4px-based spacing scale with more whitespace than the old dense
contract, restrained radius (6/10/14px + full for circular), and clear visual
hierarchy. Tooltips on every interactive element so clarity never costs density.

## Layout

A **single global left column** and a **surface-focused center**. There is no
right side panel — everything that used to live there (source, plans, ideas,
files) now lives either in the left column or as a compact floating block over
the chat. The app shell is a two-region grid: the left column (fixed width,
collapsible to icon-only) and the center workspace (fills the rest).

- **Left sidebar (220px → 36px collapsed):** The global control surface for the
  whole app, not per-chat. From top to bottom:
  1. **Top action row** — `New` (opens the shared typed creation menu),
     `Search`, and the column collapse toggle. These are the primary actions;
     no other top bar.
  2. **Projects + surfaces list** — the body of the column. Each project is a
     section with a compact **Current layout** group listing its visible
     surfaces in depth-first split-tree order, followed by active hidden
     surfaces as sibling rows without the visible marker. One state icon/word
     per surface replaces redundant colors and dots. History is a separate
     collapsed drawer destination at the bottom of each project section.
  3. **Bottom account row** — username / avatar and settings. The global update
     indicator sits here too; when an update is detected it becomes a compact
     one-click install button beside the avatar. This is the only non-CTA
     button and is reserved for app updates.

  Collapsing the column to icon-only hides the list and labels; tooltips carry
  the full text.

- **Center workspace:** A split tree of independent surfaces. Each leaf owns
  exactly one surface — a Basebuild Chat, Oh My Pi Chat, or Terminal. There
  are no tab arrays inside leaves. The split tree supports horizontal and
  vertical splits to any depth. One surface is focused at a time; the focused
  leaf receives an active outline.

### Floating environment info (top-right of chat)

A compact, ~100px-tall block pinned to the top-right of the chat surface. It
  surfaces the project environment at a glance and is the new home for the
  panels that used to live in the right sidebar, each as a foldable section
  inside the block:

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

### Workspace surfaces

The center workspace is a split tree of independent surfaces, not tabs. Each
leaf owns exactly one surface — a Basebuild Chat, Oh My Pi Chat, or Terminal.

- **Split tree.** Horizontal (left/right) and vertical (top/bottom) splits to
  any depth. A split node owns direction, ratio, and focus; a leaf node
  references one surface id. The tree persists per project across restarts.
- **One surface per leaf.** A leaf displays one Chat, Oh My Pi Chat, or
  Terminal. Splitting creates a new leaf; closing moves the surface to
  History. There is no tab bar inside any leaf.
- **Active registry.** Every active surface — visible or hidden — is retained
  in a project-scoped active registry and listed under its project in the
  sidebar. Visible surfaces are flat rows under **Linked group**, in
  depth-first tree order; active hidden surfaces are flat rows under
  **Unlinked**. These labels describe placement, not a parent/child hierarchy.
  One state icon/word per surface replaces redundant project colors, agent
  dots, and timestamps.
- **Selection and placement.** Selecting a visible sidebar row focuses its
  existing leaf. Selecting an unlinked surface replaces the focused leaf; the
  displaced surface stays active unlinked. Dragging a surface title bar onto
  another visible surface moves it to the chosen edge; dropping it on the
  sidebar unlink target removes it from the layout without closing. Sidebar
  rows can be dragged between the linked layout and unlinked section. `Open
  beside` and `Open below` explicitly split the focused leaf. `Close` moves
  the surface to retained History. Reopening returns it active unlinked,
  preserving the current layout.
- **Capacity.** Chat and Oh My Pi Chat leaves require 440px minimum width;
  Terminal leaves require 320px. A split computes both children's minimums
  before mutation; splitter ratios clamp against pixel minimums. On window
  shrink, least-recently-focused nonfocused leaves are hidden
  deterministically until all visible leaves fit; they remain active hidden.
  New placement that cannot fit is rejected with `Replace focused` as the
  primary alternative.
- **Creation.** One shared typed menu offers Basebuild Chat, Oh My Pi Chat
  (when OMP is installed), and Terminal. All plus/New actions invoke the same
  component and transaction. Default creation replaces/fills when no capacity
  is available; explicit beside/below placement is offered when capacity
  permits.

### Chat header and composer

Stable chat configuration lives in a pinned header; the composer is minimal.

- **Pinned header (28–32px).** Title, model, plan/build mode, context usage,
  run state, and secondary actions. The header is pinned at the top of the
  chat surface and never scrolls out of view. Every control has a `title=`
  tooltip.
- **Composer.** A textarea, send/stop, and one compact permission/effort
  disclosure. The textarea starts at two lines and auto-grows, remaining
  readable for long prompts before it scrolls internally. The message list
  yields space to the input, never the other way around. Focusing the textarea
  outlines the complete composer area in the CTA accent so keyboard focus is
  unambiguous.
- **Pinned, never clipped.** The composer stays at the bottom of the chat
  surface at any window size; the conversation scrolls, the composer does not.
- **Interaction workbench.** Pending questions take over the composer area
  exactly as before; the pinned header remains visible throughout.
- **Empty state.** A transcript-owned empty state first directs model
  configuration, then offers a few project-grounded starter prompts.
- **Follow latest by default.** New turns and streamed output remain visible
  while the reader is at the bottom. Scrolling upward preserves the reading
  position until the reader returns to the bottom or uses the latest control.
- Every interactive control has a tooltip. Offline (local-coordinator) replies
  carry an amber "Offline" tag so local output is never mistaken for a
  provider answer.

### Oh My Pi Chat surface

Oh My Pi Chat is an install-gated optional workspace surface that wraps one
OMP PTY. It is additive — never required for native Chat or planning.

- Labeled `Oh My Pi Chat` with secondary `OMP terminal session` ownership copy.
- One PTY per surface. States: creating, running, disconnected, exited, error,
  restart.
- xterm shell colors derive from computed CSS tokens, not hardcoded values.
  Fitting uses a requestAnimationFrame-batched `ResizeObserver` on the
  container, not window resize.
- Bounded scrollback; the unbounded React-line rendering path is removed.

## Collapsible Columns

The left sidebar collapses to icon-only width (36px) via the toggle in its top
action row. The transition is a smooth width animation. In collapsed mode:
- The projects/surfaces list and all text labels are hidden.
- Top action icons and the account row remain visible.
- Tooltips become essential — hovering shows the full label.

The collapsed state is stored in React state (not persisted yet).

## Product hierarchy

The shell has four ownership levels. A control belongs to one level only:

1. **Global navigation** — project/surface history and account controls (left
   sidebar).
2. **Project command strip** — Schematic, Ideas, Plans, Running, Done. Each
   stage button opens its exact destination; it never creates a surrogate
   chat or defaults to a sibling surface.
3. **Active chat** — transcript/activity timeline and composer.
4. **Project modals** — Schematic, Planning, Changes, Files, Settings.

The top bar is an orientation/action strip, not a telemetry dump. It contains
named project utilities, project/branch/workspace context, and planning stages.
The pinned chat header owns provider/model/effort/permission/context; raw
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
  option-list items and the 2px active bar on flush square list rows (sidebar
  rows, menu rows, pickers) remain allowed because those elements have no
  rounded corner on the accent edge.

### Selection controls

Fixed, roomy settings choices use a **square option list**: a bordered row of
buttons where the active option has a CTA underline, `aria-pressed`, and a
tooltip. Exception: the dense chat header uses square native dropdowns for
effort and permission mode so all configuration fits on one 28–32px pinned
header without duplicating controls in the composer. These dropdowns retain
radius tokens, visible text, keyboard support, and `title=` tooltips.

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
roughly 6-8 rows (chat actions, branch switch, New surface). Use a modal for
search/browse configuration, multi-column content, previews, forms, or catalogs
(provider/model, Schematic, Planning, Changes, Files, Settings). Modal layouts
may obscure the chat: focused configuration is the current task.

### Semantic visual states

Color never acts alone — every state has text/icon redundancy:

- **Connected/success** — green (CTA `#6ea97a`). Connected providers, staged
  files, ahead count, completed runs.
- **Unavailable/inactive** — grey (muted `#98a19a`). Available providers,
  inactive stages.
- **Warning** — amber (`#d0a04a`). Modified files, behind count,
  setup-required providers, stale schematic.
- **Error** — red (`#cf7373`). Destructive actions, failed runs, deleted files.
- **Active selection** — CTA green (`#6ea97a`). Selected provider card, active
  project, focused surface.
- **Context meter** — healthy green, warn amber, critical red.

### Loading and errors

Project switching immediately replaces project content with a stable loading
surface. Modal bodies use visible skeleton/loading/error/empty states; Suspense
fallbacks for user-opened surfaces are never blank. Errors include a retry and
are debug-logged with action and project/session identifiers.

## Tooltips

Every interactive element has a tooltip via the `title` attribute. This is
non-negotiable — density requires that users can discover what an icon does
without clicking. For icon-only (collapsed) states, the tooltip is the primary
label.

## Colors

Two tokenized themes applied via `data-bb-theme` before React paints:

### Dark (default, `data-bb-theme="dark"`)

Graphite canvas with layered surfaces and green CTA accent:

- **Background (`#101211`):** Graphite canvas. Sidebar, rail, workspace all
  share it.
- **Chrome (`#0c0e0d`):** Shell-level surfaces (taskbar, sidebar, tool-rail,
  status-bar) for depth.
- **Surface (`#171a18`):** Primary surface for cards, inputs, popovers.
- **Hover (`#1e221f`):** Hover and surface-high. Interactive hover lift.
- **Selected (`#272c28`):** Selected and surface-highest. Active item
  background.
- **On-surface (`#eef2ef`):** Primary text.
- **Secondary (`#c8cec9`):** Secondary text and labels.
- **Muted (`#98a19a`):** Inactive icons, placeholder text.
- **Faint (`#7c857e`):** De-emphasized metadata.
- **Outline (`#303632`) / outline-strong (`#3a413c`):** 1px hairlines for
  borders.
- **CTA (`#6ea97a` → `#7cba88` hover/focus):** Green accent. Active surface
  indicator, primary buttons, focus rings, active project icon.
- **On-CTA (`#0b140d`):** Text on CTA-colored surfaces.
- **Positive (`#6ea97a`):** Success, staged files, ahead count, connected
  providers.
- **Negative/Danger (`#cf7373`):** Destructive actions, deleted files, errors.
- **Warning (`#d0a04a`):** Modified files, behind count, stale schematic.
- **Info (`#b8c0ba`):** Neutral informational accent.
- **Context meter:** healthy `#6ea97a`, warn `#d0a04a`, critical `#cf7373`.
- **Update (`#3b82f6`):** App update availability and one-click install CTA
  only.

### Light (`data-bb-theme="light"`)

Soft-neutral canvas with white surfaces and deeper semantic colors:

- **Background (`#f5f6f3`):** Soft neutral canvas.
- **Chrome (`#ebeee8`):** Shell-level surfaces for subtle depth.
- **Surface (`#ffffff`):** Primary surface.
- **Hover (`#f0f2ee`):** Hover and surface-high.
- **Selected (`#e4e8e2`):** Selected and surface-highest.
- **On-surface (`#1a1d1b`):** Primary text.
- **Secondary (`#4a524d`):** Secondary text and labels.
- **Muted (`#6b746e`):** Inactive icons, placeholder text.
- **Faint (`#8a938c`):** De-emphasized metadata.
- **Outline (`#d4d8d3`) / outline-strong (`#a8b0aa`):** 1px hairlines.
- **CTA (`#4d8a5a` → `#427a52` hover):** Deeper green accent for light
  contrast.
- **On-CTA (`#ffffff`):** White text on CTA.
- **Positive (`#4d8a5a`), Negative (`#b85858`), Warning (`#a87826`), Info
  (`#6b7570`):** Deeper semantic colors for light-background contrast.
- **Update (`#2563eb`):** App update CTA.

### Dither texture

One static CSS pseudo-element supplies a subtle Basebuild brand texture:

- ~4px grid, tokenized neutral/green opacity.
- Limited to fixed shell chrome and selected branded empty regions.
- `pointer-events: none`; no animation, filter, or blur.
- Never applied to scrolling or reading surfaces (transcripts, terminals,
  composers, file viewers).

## Typography

- **Space Grotesk** for all UI text.
- **JetBrains Mono** for paths, hashes, numbers, terminal content, file
  statuses.
- Uppercase + letter-spacing on section labels and micro-caps for the
  engineered feel.

Baselines:

- **11px micro** — captions, mono-micro, status tags.
- **12px control** — buttons, labels, inputs, secondary text.
- **13px shell** — sidebar, headers, session titles, body text.
- **14px / 1.55 chat-reading** — transcript message text.

Hit-target baselines:

- **24px absolute minimum** — icon buttons, compact controls.
- **28–30px repeated standard** — sidebar rows, menu items, header controls.

## Shapes

**Restrained radius via tokens.** No hardcoded radius values — use CSS
variable tokens:

- **`--bb-radius-sm` (6px):** Controls, inputs, badges, option list items.
- **`--bb-radius-md` (10px):** Cards, popovers, modals, context menus,
  notifications.
- **`--bb-radius-lg` (14px):** Composer, major floating surfaces.
- **`--bb-radius-full` (9999px):** Circular elements — dots, pills, icon
  buttons, context meter.

The `check-ui-invariants` script enforces that all `border-radius`
declarations use either `0` or a `var(--bb-radius-*)` token.

## Hover Effects

Every interactive element has a hover state:
- **Buttons:** Background lifts to hover, border to outline-strong.
- **Active items:** Background lifts to selected, plus CTA indicator bar.
- **Transitions:** 0.08s for snappy, responsive feel.

## Spacing

4px-based scale via `--bb-space-*` tokens:

- **xs (4px):** Tight internal padding, icon gaps.
- **sm (8px):** List item padding, small gaps.
- **md (12px):** Card padding, standard gaps.
- **lg (16px):** Section padding, large gaps.
- **xl (24px):** Major section separation.
- Top bar height: 36px. Sidebar/rail header: 36px.
- Font sizes: 14px chat-reading, 13px shell, 12px control, 11px micro.
- Icon sizes: 14px in lists, 18px in rail, 20px in headers
  (`--bb-icon-sm/md/lg`).

## Accessibility

Accessibility is structural, not cosmetic:

- **Menus** use semantic `menu`/`menuitem` roles, `aria-expanded`, focus
  entry/return, and arrow/Home/End/Escape keyboard navigation.
- **Splitters** are focusable separators with `role="separator"`,
  `aria-valuenow`/`aria-valuemin`/`aria-valuemax`, and keyboard resize
  (arrow keys adjust the split ratio).
- **Surface rows and actions** are real `<button>` elements, not clickable
  divs.
- **Close controls** reveal on `:focus-within`, not just `:hover`.
- **State** is always communicated with visible text or icon alongside color.
- **Tooltips** (`title=`) are required on every interactive element.

## Planning cockpit surfaces

New surfaces added by the `planning-cockpit` change:

- **Command strip** — session header row with 5 stage icons + counts. Status
  colors: active = CTA pulse, empty = muted, ok = positive green.
  Collapses to a badge; radius tokens on all elements.
- **Destination picker** — managed modal dialog listing open chat surfaces +
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
3. Checking: alignment, spacing, hover states, collapsed/expanded modes,
   tooltips.
4. Testing the actual interaction (click, hover, collapse, etc.).

Never yield a UI change without visual verification.
