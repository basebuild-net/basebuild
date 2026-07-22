# Design System

`DESIGN.md` is the canonical visual design reference. Read it before any UI
change. This document links to it and adds agent-specific rules.

## Core principles

- **Theme system** (`data-bb-theme="dark|light"`): graphite-grey Dark (default)
  `--bb-bg` / white text / orange CTA accent, or soft-neutral Light. Persisted
  locally, applied before React paints via `index.html` bootstrap. Theme storage
  is untrusted — `parseTheme()` exact-allowlists to `dark | light` before
  applying. Token contract is extend-only for future themes.
- **Pre-React boot layer** (`#bb-boot`): a theme-matched full-screen frame in
  `index.html` painted before the bundle evaluates and removed by `App` on
  mount, so cold start never flashes a blank window. Its colors are hardcoded
  to match `--bb-bg`/`--bb-text` per theme because `globals.css` is not yet
  applied at that point; once hidden it is `pointer-events: none`.
- **Restrained border radius via tokens.** `--bb-radius-sm` (6px) for
  controls/inputs/badges, `--bb-radius-md` (10px) for cards/popovers/modals,
  `--bb-radius-lg` (14px) for composer/major floating surfaces,
  `--bb-radius-full` for circular elements (dots, pills, icon buttons). No
  hardcoded radius values — tokens only.
- **No decorative borders.** Layer on whitespace, hover lifts, and uppercase
  typography.
- **Borders: 1px, full perimeter, or none.** Never a single-side thick border
  (2-3px rail) on any rounded surface. Semantic state tints the whole 1px
  border via `color-mix`, shifts the background, or adds an icon and word.
  The only partial accents allowed are the 2px active underline on flat tabs
  and option-list items, and the 2px active bar on flush square list rows.
  See DESIGN.md "Borders and accents".
- **Fonts:** Space Grotesk (UI), JetBrains Mono (numbers, paths, code, terminal).
- **Disciplined spacing.** 4px-based scale (`--bb-space-xs` through
  `--bb-space-xl`) with more whitespace than the old dense contract. Compact
  but not cramped.
- **Tooltips on every interactive element** (`title` attribute). Verify with
  `title=`, not just `aria-label`.
- **CSS variables only.** All colors, sizes, and scales are tokenized in
  `globals.css` `:root` and theme blocks. No hardcoded color values in
  component files.
- **Panel-grid and chat-header patterns use Basebuild-owned split-tree and
  context-header primitives.** If external code is vendored in the future, add
  it as an explicit module with license notice; do not leave ad-hoc source
  references in component comments.

## Product hierarchy and ownership

The shell has four ownership levels. A control belongs to one level only; a stage
button opens its exact destination and never creates a surrogate chat or defaults
to a sibling tab.

1. **Global navigation** — project/chat history and account controls.
2. **Project command strip** — Schematic, Ideas, Plans, Running, Done, Changes.
3. **Active chat** — transcript/activity timeline and composer.
4. **Project modals** — Schematic, Planning, Changes, Files, and Settings.

The top bar is an orientation/action strip, not a telemetry dump. It contains
named project utilities, project/branch/workspace context, and planning stages.
Provider/model/effort live in the composer configuration area; raw session ids,
inactive-plan placeholders, and duplicate model/project badges do not render.

### Modal versus popover

Use a popover only for a short, single-step choice that can be understood in
roughly 6-8 rows (chat actions, branch switch, New panel). Use a modal for
search/browse configuration, multi-column content, previews, forms, or catalogs
(provider/model, Schematic, Planning, Changes, Files, Settings). Modal layouts
may obscure the chat: focused configuration is the current task.

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
`.btn-icon`, `.btn-icon-sm`, `.card`, `.badge`, `.pill`, `.input`,
`.pre`, `.stack`, `.stack-sm`, `.row`, `.row-between`, `.text-muted`,
`.text-sm`, `.text-ok`, `.text-danger`, `.mono`, `.spin`.

### Disclosure (`src/components/Disclosure.tsx`)

`.disclosure` / `.disclosure-toggle` / `.disclosure-label` /
`.disclosure-summary` / `.disclosure-body` — the collapsed-by-default section
primitive. Dense configuration and detail groups (plan launch profile fields,
flow-tab launch profile, category add form, Edit Plan details, idea
assessment/evidence) render behind a chevron toggle with a one-line summary
instead of always-visible flat inputs. Primary actions stay OUTSIDE the
disclosure so the main path never requires expanding it.

### Planning cards

Plan cards prioritize content over identifiers: `.plan-card-title-row`
(semibold title + readiness/progress badges), `.plan-card-desc` (one-line
description), and `.plan-card-meta` (`.plan-card-ref` de-emphasized mono
reference, `.plan-card-date` created/idea-origin relative times with exact
timestamps in `title=`). Secondary actions (Edit, Open in terminal, Copy
reference, Delete) live in the card's More menu; only the contextual primary
action (Assign/Resume/Review/Retry/Archive) renders inline. Idea rows follow
the same shape: `.chat-idea-title-toggle` expands assessment/evidence,
`.chat-idea-date` shows capture time, and Pass/Defer/Delete live in a More
menu beside the visible Make plan action.

## Panel grid + header classes (parallel-plan-workspaces)

Ported from the [dream IDE](https://github.com/dreamide/dream) (MIT) — the
split-tree layout logic and visual structure are ported into basebuild's
`globals.css`-only stack (radius tokens, no Radix, no CSS modules, no
UI-primitive library). Only the math/structure is ported; dream's
dependencies are NOT adopted.

- `.panel-grid` — the split-tree container; renders recursively as nested
  horizontal/vertical splits. `.panel-grid-split` is a flex split node
  (`.is-horizontal` or `.is-vertical`); `.panel-grid-leaf` is a panel
  container with `.is-active` outline. `.panel-grid-empty` is the empty
  state.
- `.panel-grid-splitter` — drag-resize handle between split siblings
  (4px, col/row cursor). `.is-vertical` / `.is-horizontal` variants.
- `.panel-header` — per-panel header (title, type icon, status, split/close
  buttons). `.panel-header-title`, `.panel-header-actions`,
  `.panel-header-status` (streaming/idle/error indicators). Pinned at the
  top of the panel, never scrolls out of view.
- `.panel-header-tab` — the workspace tabs inside a panel header. Tabs are
  elastic (`flex: 1 1 0`, `min-width: 130px`, `max-width: 240px`) and the strip
  scrolls horizontally on overflow; each tab is `min-height: 38px` with a 13px
  label and a 2px active underline in `--bb-cta`. `.panel-header-tab-close` is
  the per-tab close affordance. (The legacy `.workspace-tab*` block was removed —
  it was dead CSS.)
- `.drop-zone-overlay` — 4-edge drop zone overlay for drag-to-split
  (`.drop-zone-top/right/bottom/left`). 2px accent line.
- `.activity-sidebar` — left sidebar panel list; `.activity-sidebar-row`
  per panel with type icon, title, status. `.activity-sidebar-history-badge`
  for the closed-panel count.
- `.history-drawer` — overlay drawer listing closed panels
  (`.history-drawer-item` with Re-open / Delete permanently actions).
- `.bg-agents-item-open` — full content target for a chat-bound background run;
  clicking it opens the owning chat transcript, while cancellation remains a
  separate sibling button.
- `.chat-column-header` — sticky per-chat configuration rail: title, clickable
  model chip, effort dropdown, textual permission dropdown, run state, circular
  context usage, agent mode, plan badge, compact branch, commands, history, and
  more-actions.
- `.chat-header-select`, `.chat-header-run-state`, `.chat-header-context` —
  compact header configuration/state primitives. The context circle exposes the
  exact latest-request token ratio in its tooltip.
- `.chat-branch-dropdown` — branch switch/create dropdown.
  `.chat-switch-confirm` — uncommitted-changes confirm prompt
  (stash/discard/cancel).
- `.chat-more-menu` — more-actions menu; `.chat-more-menu-item.is-danger`
  for destructive entries (delete session).
- `.pr-recommendation-card` — finished-run PR recommendation (branch,
  ahead/behind, changed-file count, confirm-gated Create PR action).
- `.settings-table` — concurrency settings grid (provider, global max,
  project max, subagents, subagent cap).
- `.settings-modal .modal-body` — always a row: fixed `.settings-sidebar`
  beside flexible, independently scrolling `.settings-content`. The sidebar
  is grouped: `.settings-group` sections with non-interactive
  `.settings-group-label` headers (Appearance leads, then General,
  Providers & Models, Execution, Integrations, Privacy & Data). Every tab
  belongs to exactly one group.
- Appearance tab hosts theme (`.theme-picker`) and UI scale
  (`.ui-scale-control` + `.ui-scale-value`). The scale is a bounded root
  zoom multiplier (80–150% in tens) from `src/lib/uiScale.ts`, persisted in
  localStorage (`basebuild.zoom`, exact-allowlisted, applied pre-paint in
  `index.html`) with CTRL+= / CTRL+- / CTRL+0 shortcuts via `useZoom`.
- `.planning-dropdown-row` — the shared row for ALL planning dropdowns
  (Ideas, Plans, Running, Done): status dot, `.planning-notification-item-title`
  with a one-line `.planning-notification-item-desc`, right-aligned status
  label, and a `…` menu (`.context-menu`) holding every secondary action
  (Assign/Approve/Generate OpenSpec/status changes/Copy id/two-step Delete).
  Dropdown panels share one width (`.planning-notification-dropdown`,
  340px); rows never grow inline button clusters.
- `.chat-env-context` + `.chat-context-badge` — compact chat context badges;
  truncate with tooltip text rather than wrapping over header actions.
- `.provider-catalog-modal` — two-pane provider/model configuration workspace.
  `.provider-card-grid` fits two provider cards per row; `.provider-card`
  marks connection state with a full-perimeter success-tinted border, dot,
  and text plus model count (no partial rail). This is a modal, not a
  composer dropdown.
- `.provider-model-list` is provider-scoped and searchable, with compact
  `.provider-capability` badges.
- **Provider Manage modal** (`ChatPanel.tsx`) is tabbed: `.modal-tabs` /
  `.modal-tab` render flat underline tabs directly under the modal header
  (Accounts, Connect, Usage). Rules for structured surfaces:
  - Multi-concern modals get explicit navigation (tabs or titled sections),
    never one flat scroll of inputs and hidden `<details>` folds.
  - Secret entry (API keys) happens in a dedicated sub-modal
    (`.api-key-modal`) with labeled fields (`.api-key-field`) and a single
    save action, never as naked inline inputs in a list.
  - `.provider-callout` (+ `.is-warn`, `.provider-callout-icon`,
    `.provider-callout-body`, `.provider-callout-title`) is the blocking-issue
    banner (for example "Endpoint URL required") with the fix action inline.
  - `.provider-connect-section` / `.provider-connect-heading` are titled
    secondary sections on the Connect tab (API-key alternative, OMP import).
  - `.provider-empty-state` renders every empty list with a message plus the
    next-step button (for example "Connect an account").
  - `.provider-usage-summary` (+ `.provider-usage-summary-num`) shows
    provider-wide totals; `.provider-usage-rate` renders humanized rates
    (`≈3.2 reqs/h`, `≈1 req every 6h`, `≈12.4k tok/h`) beside raw totals so
    usage reads as behavior, not bare numbers.
  - `.row-end` right-aligns a `.row` (modal action rows).
- **Usage Sync settings** use `.usage-sharing-summary` /
  `.usage-sharing-block` for the exact aggregate allowlist and exclusion copy,
  `.usage-attribution` for account versus private-installation attribution,
  and `.usage-source-section` / `.usage-source-row` /
  `.usage-source-state` for compact independent source status. A failed or
  pending source exposes the native `Retry sync` action; source diagnostics
  must be fixed privacy-safe classifications and never raw parser text or paths.

Use popovers only for short single-step menus (roughly 6-8 rows). Searchable
catalogs, forms, previews, and multi-column configuration belong in a named
modal and may intentionally obscure the chat while configuration is active.

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
  region (never inside it). It contains only the input row and optional active
  debug panel; configuration is not duplicated here. `:focus-within` outlines
  the complete composer in `var(--bb-cta)`.
- The input is a `.chat-input` textarea inside `.chat-input-row`. It starts at
  two rows and auto-grows: on each change its height custom property is reset to
  `scrollHeight`, capped (see `ChatPanel.tsx`) before internal scrolling.
- Model/provider, effort, textual permission mode, run state, branch, context,
  and secondary actions live once in `.chat-column-header`. Model opens the
  provider catalog; effort and permission use `.chat-header-select` dropdowns;
  context is a 16px SVG circle with exact numbers in `title=`.
- Existing transcripts load independently from provider catalog, global metrics,
  branch, and permission metadata. Streaming fragments accumulate immediately
  but publish React state once per animation frame.
- `.chat-messages` explicitly follows the latest output while the reader is at
  the bottom. An upward scroll disables following; returning to the bottom or
  activating `.chat-scroll-bottom-btn` resumes it.
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
- The Planning Inspector (`.planning-inspector`) has six tabs
  (`.inspector-tab`): Plans, Ideas, Categories, Flow, Runs, and Changes. In a
  modal, `.planning-inspector-modal` stays column-oriented even when wide
  container queries make docked inspectors master-detail. The Ideas tab has
  status filter chips (`.inspector-filter-chip`) and per-idea promote/reject
  actions. The Categories tab lists `.inspector-category-card` entries with
  idea counts and drill-down detail.

## Project schematic modal (technical)

The dedicated `.modal-schematic` hosts `.project-schematic-tab`, which renders `.basebuild/project-schematic.md`
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

The Schematic stage always opens this modal; starting the current wizard may
still route a skill-driven turn through the destination chooser. Managed
questions use the composer-owned interaction workbench described below rather
than a surrogate modal chat. The chat soft-gate notice is a full-width button
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
  All interactive elements have `title=` tooltips and radius tokens.

Settings → Final Touches tab uses `.final-touch-list`, `.final-touch-step`,
`.final-touch-toggle`, and `.final-touch-add` classes. All inputs, selects,
and buttons use radius tokens and `var(--bb-surface)` backgrounds.

## Semantic visual states

State is communicated with redundant text, icon, and shape cues. Color never
carries meaning alone.

- **Green (`--bb-success` / `--bb-positive`)** — connected, succeeded, complete,
  added, ok. Examples: `.provider-card.is-connected`,
  `.provider-status.is-connected`, `.tool-card-status-success`,
  `.schematic-health-badge.is-complete`, `.chat-health-dot.is-ok`, `.text-ok`,
  `.plan-queue-run-status-succeeded`.
- **Grey (`--bb-muted` / `--bb-unavailable`)** — unavailable, inactive, cancelled,
  archived, placeholder, disabled. Examples: `.provider-card.is-available`,
  `.provider-status` default, `.provider-capability` default,
  `.plan-queue-run-status-cancelled`, `.text-muted`, `.idea-status.is-archived`.
- **Amber (`--bb-warning`)** — warning, partial, stuck, stale, offline. Examples:
  `.schematic-health-badge.is-partial`,
  `.schematic-section-card.is-missing`/`.is-placeholder`, `.schematic-nudge`,
  `.chat-stuck-bar`, `.chat-setup-bar`, `.chat-command-notice`,
  `.chat-offline-tag`, `.idea-outside-focus`, `.chat-health-dot.is-warn`,
  `.badge-warn`, `.command-strip-count-warn`.
- **Red (`--bb-danger` / `--bb-negative`)** — error, failed, missing, deleted,
  denied, destructive. Examples: `.tool-card-error`, `.tool-card-status-error`,
  `.question-card-error`, `.chat-error-bar`, `.chat-more-menu-item.is-danger`,
  `.text-danger`, `.badge-error`, `.plan-queue-run-status-failed`,
  `.schematic-health-badge.is-missing`, `.source-file-status.is-deleted`.
- **Orange (`--bb-cta`)** — active selection, current focus, pending/running, CTA.
  Examples: `.provider-model-row.is-active`, `.provider-card.is-active`,
  `.settings-tab.is-active`, `.tool-card-running`, `.tool-card-status-running`,
  `.question-card-pending`, `.chat-message-user`, `.chat-row.is-active`,
  `.command-strip-count-active`.

## Agent activity timeline

The chat transcript normalizes native and OMP-backed events into ordered
activity items: `assistant_text`, `reasoning`, `tool_call`, `question`, `capture`,
`approval`, `notice`, and `error`. Each item carries a stable id, sequence,
status, summary, timestamps, and optional expandable detail.

Rendering contract:

- Collapsed presentation is dense: one live activity group with the latest
  operation visible. Use `.tool-card-group` with `.tool-card-group-list`; the
  list is height-capped and auto-follows the newest call while a run is active.
- Expansion preserves ordering and exposes individual calls. Use `.tool-card`
  for each call with `.tool-card-status-success`, `.tool-card-status-error`,
  `.tool-card-status-running`, and `.tool-card-expand` for the detail body.
- Reasoning/thinking tokens render in `.reasoning-fold` above the assistant
  reply; the fold auto-expands while streaming and collapses on completion.
  Reasoning is never concatenated into the persisted content string.
- A pending question becomes the composer's primary
  `.interaction-workbench`: the normal textarea is unavailable, title and
  progress are prominent, multi-page Back/Next navigation preserves values,
  rating choices expose a five-level keyboard-accessible scale, and Exit
  collapses to `.chat-question-preview`. Answered questions remain as
  compact `.question-card` history and reopen read-only detail. Use
  `.question-card-pending`, `.question-card-success`, and
  `.question-card-error` only for transcript state, not a second answer path.
- Captured ideas render as `.chat-idea-card` rows; notices and errors use
  `.chat-command-notice`, `.chat-notice-bar`, and `.chat-error-bar`.
- Unsupported transports produce an explicit capability state before launch, not
  a fake tools-capable run.

Planning state color follows backend run state, not plan-label inference:
orange is only live/queued/needs-input work; awaiting-review and interrupted use
warning treatment; failed is negative; complete is positive; archived is muted.
The full `.bg-agents-item-open` row reopens the retained owner chat. Resume,
Review, Retry, Archive, and Cancel are explicit sibling actions with `title=`
reasons when blocked.

## Screenshot verification

Every UI change requires a screenshot. See
[`testing.md`](./testing.md#visual-verification).

## Markdown rendering classes

- `.md-code-block`: fenced code block container (radius tokens, mono font).
- `.md-code-copy`: copy button in code block header.
- `.md-inline-code`: inline code styling.
- `.md-table`: markdown table rendering.
- `.md-list`, `.md-blockquote`, `.md-heading-*`: heading scale inside chat.

## Message action rail classes

- `.message-action-rail`: per-message action button container.
- `.message-action-btn`: individual action button (Copy, Retry, Edit).

## Tool card classes

- `.tool-card`: expandable tool call result container.
- `.tool-card-header`: clickable header (kind icon + summary).
- `.tool-card-diff`: unified diff display.
- `.diff-add`, `.diff-del`: added/removed diff line classes.
- `.tool-card-provenance`: approval provenance line ("Allowed by rule", etc.).
- `.tool-card-arg-value`: argument value display in expanded card.

## Provider state chips

- `.provider-status.is-ready`: configured with usable transport (green).
- `.provider-status.is-warning`: transport unavailable (amber).
- `.provider-status.is-setup-required`: no credential (grey).
- `.provider-card-error`: per-provider error chip container.
- `.provider-card-error-text`: error message text.
- `.provider-card-retry-btn`: retry button in error chip.

## Idea grounding classes

- `.idea-batch-header`: grounding provenance header in Ideas tab.
- `.idea-batch-header-label`: "Grounded in:" label.
- `.idea-batch-header-sections`: schematic section names.
- `.idea-batch-header-counts`: finished plan / picked / rejected counts.
- `.idea-batch-header-empty`: "no decisions since schematic update" notice.
