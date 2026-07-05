# Proposal: Chat-First Shell

## Why

The current shell is a three-column grid (left projects sidebar, center
workspace, right accordion panel of Plans/Files/Source). It spreads global
navigation, per-project environment, and the conversation across three
competing surfaces, and it leans on an in-app top bar for account/update
controls. The result is busy: a giant always-visible file list, a right column
that duplicates the center's job, and chrome that pulls focus from the chat.

This change reshapes the app around the chat. There is **one global left
column** for navigation and account, a **chat-focused center**, and a single
compact **floating environment block** over the chat for source/plans/files.
Native Windows window chrome and the `File / Edit / View` application menu are
retained; the custom in-app top bar goes away.

## What Changes

- **Single global left column (pillar 1).** The left column becomes the only
  persistent navigation surface: a top action row (`New chat`, `Search`, collapse
  toggle), a projects-and-chats list in the middle (**5 most recent chats per
  project** with relative timestamps like `5s` / `1min` / `1mo`, a pin toggle,
  and a `Show more` row per project; pinned chats in their own top section), and
  a bottom account row (username / avatar, settings, and the app-update
  indicator). **BREAKING (UI):** account and update controls move out of the
  in-app top bar into the bottom of the left column; the in-app top bar is
  removed.
- **Chat-focused center (pillar 2).** The center is the active chat: minimal
  session header, scrolling transcript, pinned composer. Terminal, file viewer,
  and schematic remain **workspace tabs over the same center**; there is no
  always-visible tool-tab bar or right column.
- **Floating environment block.** A compact (~100px) block pinned to the
  top-right of the chat surfaces the project environment and hosts what used to
  live in the right panel, each as a fold: **Changes / branch / source** (branch,
  ahead/behind, staged/unstaged/untracked counts, commit / push / pull, diff in
  a popover), **Plans & Ideas** (the existing Planning Inspector, relocated
  unchanged), and **Files** (a button that opens the file-explorer modal). The
  block floats above the transcript and never pushes chat content.
- **Modal file explorer.** **BREAKING (UI):** the always-visible Files tree/list
  is removed. A single Files button opens a full-window modal file browser
  (tree + preview/detail + fuzzy path search). Opening a file from the modal
  still creates a file workspace tab.
- **Composer additions.** The composer keeps its tall, growing input and
  always-visible model/effort, and gains a **microphone** button (voice-to-text
  into the input) and a compact **context size + usage** readout (tokens used
  vs. the active model's context window).
- **Native window chrome + menu.** Retain standard Windows window decorations
  (title bar, min/max/close) and a `File / Edit / View` application menu.
  **BREAKING (UI/config):** window `decorations` become native.

## Capabilities

### New Capabilities

- `project-chat-sidebar` — the single left column: top actions, projects+chats
  list with 5-recent + show-more + pinning + relative timestamps, bottom account
  row.
- `chat-environment-panel` — the floating top-right environment block hosting
  source/branch actions, the relocated Planning Inspector, and the Files entry.
- `file-explorer-modal` — modal file browser replacing the inline Files tree.
- `composer-voice-input` — microphone voice-to-text into the chat input.
- `composer-context-usage` — context window size and usage readout in the
  composer.

### Modified Capabilities

- `desktop-shell` — single-column, right-panel-free shell; native window chrome
  and `File / Edit / View` menu; file opening now flows from the file-explorer
  modal rather than a Files panel.
- `chat-composer-controls` — model and effort are always visible (never
  overflow-hidden); the rail carries the mic and context/usage controls
  alongside a tall growing input, superseding the overflow-first single-line
  rail.

## Impact

- **TS (frontend):** new `ProjectChatSidebar` (replaces `ProjectSidebar` +
  `SidePanel`), `ChatEnvironmentPanel`, `FileExplorerModal`; `ChatPanel`
  composer gains mic + context/usage; `AppShell` becomes a two-region grid;
  remove the in-app top bar and the right accordion. Relocate `PlanningInspector`
  into the environment panel (behavior unchanged). `src/lib/*` gains thin
  wrappers for any new commands (voice/transcription, context usage) — no state
  logic in lib.
- **Rust:** `git`/source service already exists (Source panel) — reuse for the
  env block. Voice-to-text needs a transcription path (local or provider); a new
  service + command if implemented natively. Context usage derives from existing
  session/token telemetry. Application menu built in `lib.rs` (`tauri::menu`).
- **Config:** `src-tauri/tauri.conf.json` window `decorations` → native.
- **CSS:** all new surfaces in `src/styles/globals.css`, 0px radius, tooltips.
- **Docs:** `DESIGN.md` (already updated to this layout), `docs/agents/design-system.md`
  (env panel, modal, sidebar, composer classes), `docs/agents/desktop-shell.md`
  (single-column shell, workspace tabs, native menu).
- **Overlap / ordering:**
  - `unified-planning-workspace` (merged, awaiting archive) built the Planning
    Inspector; this change **relocates** it into the environment block without
    changing its behavior.
  - `file-viewer-editor` (roadmap, not started) owns file view/edit/diff
    *content*; this change owns the modal *shell* that hosts it and the file
    workspace tab. Sequence so the modal reuses that viewer.
  - `diff-review-workflow` (roadmap, not started) can render its changeset in the
    env block's Changes fold / diff popover.
