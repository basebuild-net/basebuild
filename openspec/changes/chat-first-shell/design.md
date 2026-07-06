# Design: Chat-First Shell

## Approach

Reshape `AppShell` from a three-column grid into a two-region layout: the
global left column and the center chat surface. The right accordion
(`SidePanel`) is removed; its three concerns move to new homes — source and
plans/ideas into a floating environment block over the chat, files into a modal.
Global account/update controls move from the in-app top bar into the bottom of
the left column, and the window adopts native OS chrome plus a `File / Edit /
View` menu.

The change is primarily frontend (React/TS + CSS) plus two Tauri touches
(native window decorations, an application menu). Existing backend services
(git/source, sessions, telemetry) are reused; only voice transcription is
genuinely new backend surface.

## Component map

- `ProjectChatSidebar` (new) — replaces `ProjectSidebar` + `SidePanel`. Owns the
  three regions. Chat rows compute relative timestamps from `updated_at` and
  expose pin/unpin. Per-project list is capped at 5 recent (excluding pinned)
  with a per-project `Show more` local expansion state.
- `ChatEnvironmentPanel` (new) — floating top-right block with folds: Source
  (reuses the existing source/git lib + service), Plans & Ideas (renders the
  existing `PlanningInspector` unchanged), Files (button → modal). Absolute-
  positioned over the chat scroll region; collapsible with a persisted-in-state
  flag; diff opens in a popover.
- `FileExplorerModal` (new) — shared modal overlay contract; tree + preview +
  fuzzy path filter; open-file dispatches the existing "open file workspace tab"
  path.
- `ChatPanel` composer — add a `MicButton` (voice-to-text) and a context/usage
  readout next to model/effort. Input stays the tall auto-grow textarea.

## Key decisions

- **Environment block floats, not docks.** Keeping it absolutely positioned over
  the chat preserves the "chat is the center" intent and avoids reintroducing a
  column that steals width. Trade-off: it can occlude the top of the transcript,
  mitigated by the ~100px height, collapsibility, and a collapsed branch-only
  summary.
- **Planning Inspector is relocated, not rewritten.** `unified-planning-workspace`
  just shipped it; this change re-parents the component into the env block and
  leaves its behavior/spec intact. Lower risk, no duplicate planning UI.
- **Files as a modal, not a tree.** A modal removes the always-visible list the
  owner called out as noisy and gives room for a better browser (tree +
  preview + search). File *content* rendering is owned by `file-viewer-editor`;
  this change only owns the modal shell and the open-into-tab wiring, so sequence
  after (or reuse) that viewer.
- **Native chrome + menu over custom titlebar.** Owner wants standard Windows UI.
  Flip `decorations` to native and build the menu with `tauri::menu`. Trade-off:
  the custom in-app titlebar styling is dropped; window controls become OS-
  native, which is the intent.
- **Voice-to-text is local-first.** Prefer an on-device/browser capture path;
  any provider-backed transcription is opt-in and explicit, with no silent
  upload — consistent with Invariant 4.

## Alternatives considered

- **Keep a slim right rail instead of a floating block.** Rejected: still a
  third column competing with the chat; owner explicitly wants it gone.
- **Inline collapsible file tree in the env block.** Rejected: reproduces the
  "giant list" the owner is removing; a modal scales better for large repos.
- **Persisting collapse/pin state now.** Deferred to a follow-up; pin state
  needs persistence (it is user data) but collapse state can stay in React
  state initially, matching the current column-collapse behavior.

## Risks

- Occlusion of transcript top by the floating block — mitigated by height cap +
  collapse.
- Native menu wiring differs per OS; scope is Windows-first per the repo.
- Voice transcription availability varies; the control must degrade to a
  disabled+tooltip state rather than error.
