# Design: Built-in File Viewer / Editor with Diffs

## Context

Current state (verified 2026-07-05 on the installed build): `FileViewer`
renders plain text only (no highlighting, markdown, images, or editing);
`SourcePanel` has a hand-rolled `parseDiff` rendering inside the narrow
side panel; file tabs exist in the shell (`kind: "file"`), and
`gitDiff(projectPath, path, staged)` already returns per-file diffs.

## Goals / Non-Goals

**Goals**:
- Make file tabs the single surface for view/edit/diff.
- Stay inside the design contract: one stylesheet, 0px radius, tooltips.

**Non-Goals**:
- Full IDE features (multi-cursor, LSP, refactoring, search-in-file beyond
  basic find).
- Diff review workflow actions (approve/revert/send-back) — that is the
  separately-specced `diff-review-workflow` change; this change only
  provides the rendering surface it can later reuse.
- Editing binary or image files.

## Decisions

- **Decision**: Use CodeMirror 6 (`@codemirror/*`) as the shared
  view/edit/diff component (read-only mode for viewing, merge/diff addon
  for diffs, language packs for highlighting). **Rationale**: small
  modular core, virtualized by design, themeable via CSS variables inside
  the single stylesheet, no iframe/shadow-DOM styling conflicts, editing
  and diffing in one dependency. **Alternatives**: Monaco (heavy,
  ships its own styling world, overkill), highlight.js + textarea (no
  virtualization, diverging edit/view surfaces), keep hand-rolled
  (already at its ceiling).
- **Decision**: Diff mode is a state of the file tab (`file` tab gains
  `mode: view | diff`), not a new tab kind — Source panel diff clicks
  route to `openFileTab(path, { mode: "diff", staged })`. **Rationale**:
  preserves one-tab-per-path and lets users flip diff ↔ file in place.
  **Alternatives**: separate diff tab kind (duplicates path-focus logic).
- **Decision**: Save uses an mtime guard: `read` returns `(content,
  mtime)`; `write` takes expected mtime and fails with a typed conflict
  error when stale; UI prompts reload/overwrite/cancel. **Rationale**:
  agents and terminals write to the same tree constantly in this app;
  silent last-writer-wins is unacceptable. **Alternatives**: file locks
  (fragile on Windows), content hash compare (mtime is sufficient and
  cheaper; hash as future hardening).
- **Decision**: Markdown preview renders with a minimal local renderer in
  the webview (no network, sanitized HTML). **Rationale**: local-first
  invariant. **Alternatives**: none serious.

## Risks / Trade-offs

- New dependency weight (CodeMirror) → Mitigation: modular imports only
  (core + languages actually used), measure bundle delta in `npm run
  build`.
- Editing inside an agent-managed tree can race agent edits → Mitigation:
  mtime guard + Source panel refresh events already exist.
- Large diffs (lockfiles) can stall rendering → Mitigation: collapse
  hunks over a threshold with expand-on-demand; cap per-file diff bytes
  like the commit flow does (`COMMIT_DIFF_LIMIT` precedent).

## Migration Plan

1. Pure frontend + additive `file_service` read/write-with-mtime commands;
   no schema changes.
2. SourcePanel keeps its inline mini-diff until the tab route ships, then
   the mini-diff becomes a preview that links to the tab (single PR).
3. Rollback: revert to plain-text `FileViewer`; no data impact.

## Open Questions

- Find-in-file (Ctrl+F) in v1: recommend yes if CodeMirror's search addon
  is near-free, else defer.
- Should diff mode offer side-by-side in addition to unified? Recommend
  unified-only v1 (panel widths are constrained); side-by-side later.
