# Tasks: Built-in File Viewer / Editor with Diffs

## 1. Foundation

- [ ] 1.1 Add CodeMirror 6 (core + read-only view + language packs for
      ts/tsx/js/json/rust/md/css/html/toml/yaml) with theme bound to
      existing CSS variables in `globals.css` (0px radius, tooltips)
- [ ] 1.2 `file_service`: read returns `(content, mtime, size, binary
      flag)`; write takes expected mtime and returns a typed conflict
      error when stale; thin `lib/files.ts` wrappers
- [ ] 1.3 File-type routing: text/code → editor view; images → image
      view; other binary → size/type notice

## 2. Viewer

- [ ] 2.1 Replace `FileViewer` rendering with the highlighted, virtualized
      read view (line numbers, large-file safe)
- [ ] 2.2 Markdown source↔preview toggle (local sanitized renderer,
      scroll position preserved)
- [ ] 2.3 One-tab-per-path: re-click focuses the existing tab (Files
      panel, Source panel, and any file links)

## 3. Editing

- [ ] 3.1 Editable mode with dirty indicator, Ctrl+S + save button,
      explicit-save-only (no autosave)
- [ ] 3.2 Conflict prompt on stale mtime (reload / overwrite / cancel)
- [ ] 3.3 Dirty-close confirmation (save / discard / cancel)
- [ ] 3.4 Source panel change list refreshes after save

## 4. Diff Mode

- [ ] 4.1 File tab `mode: view | diff`; Source panel changed-file click
      opens the tab in diff mode (staged/unstaged flag carried)
- [ ] 4.2 Unified inline diff rendering via CodeMirror merge view fed by
      `gitDiff`; untracked files render as full additions
- [ ] 4.3 Hunk collapse over threshold with expand-on-demand; per-file
      byte cap consistent with the commit-flow limit
- [ ] 4.4 Diff refresh on working-tree change (event or one-click refresh)
- [ ] 4.5 SourcePanel mini-diff becomes preview + "Open diff" link into
      the tab

## 5. Verification

- [ ] 5.1 `npx tsc --noEmit`, `npm run build` (record bundle size delta);
      `cargo check` + `cargo test` for file_service changes (isolated
      BASEBUILD_HOME)
- [ ] 5.2 e2e: open/highlight, markdown toggle, edit-save-conflict flow,
      diff-from-source-panel, dirty-close confirm
- [ ] 5.3 UI smoke in the running app with screenshots: ts file, md
      preview, image, 10k-line file scroll, lockfile diff collapse
- [ ] 5.4 Freeze watchdog stays quiet while scrolling a huge file and a
      huge diff

## 6. Docs & Roadmap

- [ ] 6.1 Update `DESIGN.md` (viewer/diff visual language — visual only)
      and `docs/agents/design-system.md` (classes/selectors)
- [ ] 6.2 Update `docs/agents/desktop-shell.md` (file tab modes, dirty
      state, routing)
- [ ] 6.3 Refresh roadmap: `node scripts/openspec-status.mjs --write` +
      ROADMAP narrative in the same commit
