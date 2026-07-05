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
desktop tool. The personality is preserved - **pure black canvas, pure white
type, a single electric orange (`#ff5606`) accent, and square geometry** - but
adapted for a dense, compact, instrument-like workspace.

This is a desktop tool, not a marketing site. The UI is **extremely compact**:
minimal padding, no wasted whitespace between elements, no large empty regions.
Every pixel earns its place. Tooltips on every interactive element so density
never costs clarity.

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
     blue (`#2563eb`) one-click install button beside the avatar. This is the
     only non-orange CTA and is reserved for app updates.

  Collapsing the column to icon-only hides the list and labels; tooltips carry
  the full text.

- **Center chat surface:** The whole center is the active chat. No tool tabs,
  no right panel. The session header is minimal (title, status pill). The chat
  transcript fills the height, scrolling independently, with the composer pinned
  to the bottom. Two things float over the chat on the top-right; everything
  else is the conversation.

### Floating environment info (top-right of chat)

A compact, ~100px-tall block pinned to the top-right of the chat surface. It
  surfaces the project environment at a glance and is the new home for the
  panels that used to live in the right sidebar, each as a foldable tab inside
  the block:

- **Changes / branch / source** — current git branch, ahead/behind, and the
  staged/unstaged/untracked counts. Inline actions: commit, push, pull. The
  diff/list view opens as a popover from the block, not a full column.
- **Plans & Ideas** — the Planning Inspector (`Plans / Ideas / Categories`
  tabs) lives here, folded by default. Schematic health badge and the End-goal
  nudge render in this fold when relevant. Generation is still triggered from
  the chat composer's planning menu and runs as a visible chat turn — the block
  is for inspecting and managing, not for generation inputs.
- **Files** — opens a **modal file explorer**, not an inline tree. A single
  button in the block opens a full-window modal with a cleaner, purpose-built
  file browser (tree on the left, preview/detail on the right, fuzzy path
  search at the top). The giant always-visible file list is gone.

The block is collapsible; when folded it shows just the branch name and a
  health dot. It floats above the transcript and never pushes chat content.

### Workspace tabs (terminal, file viewer, schematic)

Terminal sessions, the file viewer, and the project schematic open as
**workspace tabs over the center** — same surface as chat, switchable. They are
per-session and each has a `kind` (`terminal`, `file`, `schematic`, `chat`).
There is no always-visible tab bar; the active tab is indicated in the session
header and switching is via the left column or keyboard. The default tab is the
chat.

### Chat composer

The composer is simple on purpose: a tall, roomy input and only the controls
you need every turn — no crowded button bars, no overflow menus hiding the
essentials.

- **Tall, growing input.** The text field is multi-line by default and grows
  as you type, expanding to a generous height so long prompts stay fully
  readable while drafting before it scrolls internally. The message list above
  yields space to the input, never the other way around.
- **Model and effort always visible.** The model picker and effort selector
  sit on one compact row with the input and are never tucked away. Provider /
  connection status appears inline only when action is needed (e.g. connect).
- **Context size + usage.** Next to model/effort, a compact readout shows the
  active context window size and current usage (tokens used vs. the model's
  context limit) so you can see how much headroom you have left.
- **Voice input.** A microphone button on the input row toggles voice-to-text
  into the chat box. While active, it shows a recording state; the transcript
  is inserted at the cursor in the input field.
- **Minimal chrome.** Send, model, effort, mic, and context readout are the
  controls that matter. Rarer actions are reached through slash commands
  (`/login`, `/model`, `/models refresh`) instead of adding more buttons.
- **Pinned, never clipped.** The composer stays at the bottom of the chat
  panel at any window size; the conversation scrolls, the composer does not.
- While the catalog loads, the selectors show placeholder skeletons; every
  control has a tooltip. Offline (local-coordinator) replies carry an amber
  "Offline" tag so local output is never mistaken for a provider answer.

## Collapsible Columns

The left sidebar collapses to icon-only width (44px) via the toggle in its top
action row. The transition is a smooth width animation. In collapsed mode:
- The projects/chats list and all text labels are hidden.
- Top action icons and the account row remain visible.
- Tooltips become essential — hovering shows the full label.

The collapsed state is stored in React state (not persisted yet).

## Tooltips

Every interactive element has a tooltip via the `title` attribute. This is
non-negotiable - density requires that users can discover what an icon does
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
- **Update blue (#2563eb → #3b82f6 hover):** App update availability and
  one-click install CTA only.

## Typography

- **Space Grotesk** for all UI text.
- **JetBrains Mono** for paths, hashes, numbers, terminal content, file statuses.
- Uppercase + letter-spacing on section labels and micro-caps for the engineered feel.

## Shapes

**0px radius everywhere.** No exceptions. Buttons, cards, inputs, badges, menus -
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
