# Proposal: Built-in File Viewer / Editor with Diffs

## Why

Testing the installed build (2026-07-05): clicking a file in the Files
panel opens a tab that renders raw text only — no syntax highlighting, no
markdown rendering, no images, read-only, and no way to see a diff for a
changed file from the viewer. The Source panel has a rudimentary inline
diff (`viewDiff` with a hand-rolled parser) confined to the narrow side
panel. The owner wants clicking source files to "actually see" them —
readable code, editable text, and diff support — as a first-class
workspace surface.

## What Changes

- Syntax-highlighted, virtualized read view for code/text files in the
  file tab (large-file safe), with binary/image handling (render images,
  size note for other binaries).
- Markdown preview toggle (rendered ↔ source) for `.md` files.
- Lightweight editing: edit + save for text files from the file tab, with
  dirty-state indicator, explicit save (no autosave side effects), and
  external-change detection (file changed on disk while dirty → prompt).
- Diff view: clicking a changed file in the Source panel opens the file
  tab in diff mode (unified inline view; whole-file context available),
  replacing the cramped side-panel-only diff. Works for staged, unstaged,
  and untracked (full-add) files.
- Viewer/editor tabs integrate with existing file tabs (one tab per path,
  re-focus on re-click, dirty-close confirmation).

## Capabilities

### New Capabilities

- `file-viewer` — viewing, editing, and diffing files inside the
  workspace.

### Modified Capabilities

(none — the Source panel keeps its requirements; its diff affordance now
routes into the file tab)

## Impact

- TS: `FileViewer.tsx` (rewrite around a highlight/editor component),
  `SourcePanel.tsx` (route diff clicks to file tabs), `AppShell`
  tab plumbing, `lib/files.ts` / `lib/git.ts` (save + diff wrappers).
- Rust: `file_service` (write-with-mtime-guard for external-change
  detection), `git_service` (per-file diff already exists via `gitDiff`).
- Dependency decision (editor/highlighter component) recorded in
  design.md; must respect the one-stylesheet / 0px-radius design contract.
- Docs: `docs/agents/design-system.md`, `DESIGN.md` (viewer/diff visual
  language), `docs/agents/desktop-shell.md` (tab behavior).
