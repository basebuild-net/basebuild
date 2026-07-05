# Tasks: Chat-First Shell

## 1. Shell restructure

- [ ] 1.1 `AppShell.tsx`: convert the three-column grid to a two-region layout
      (left column + center chat surface); remove the right `SidePanel` mount and
      the in-app top bar mount; keep workspace-tab routing intact
- [ ] 1.2 Remove/replace `SidePanel.tsx` (right accordion) — its Source/Plans/
      Files concerns move to the environment panel and file modal; delete
      now-dead wiring
- [ ] 1.3 `globals.css`: two-region shell grid; remove right-panel/top-bar
      classes no longer used (audit before deleting); 0px radius preserved
- [ ] 1.4 Verify: `npx tsc --noEmit` + `npm run build`; e2e shell still mounts

## 2. Project + chat left column

- [ ] 2.1 `ProjectChatSidebar.tsx` (replaces `ProjectSidebar.tsx`): top action
      row (`New chat`, `Search`, collapse toggle); projects+chats list; bottom
      account row (avatar/username, settings, update indicator moved from top bar)
- [ ] 2.2 Chats list: group by project, cap at 5 recent per project (excluding
      pinned), per-project `Show more` expansion; relative timestamps
      (`5s`/`1min`/`2h`/`3d`/`1mo`) from `updated_at`
- [ ] 2.3 Pinning: pin/unpin action; pinned section at top across projects;
      pinned excluded from the 5-recent count; persist pin state (user data)
- [ ] 2.4 Collapse: icon-only width hides list + labels, keeps top icons +
      account row; tooltips carry labels
- [ ] 2.5 Verify: `cargo test` for any new/changed session queries (pin flag,
      recent ordering); e2e — 5-recent + show-more + pin + timestamps

## 3. Floating environment panel

- [ ] 3.1 `ChatEnvironmentPanel.tsx`: floating top-right block over the chat
      surface; collapsible; collapsed shows branch + status dot; never displaces
      transcript
- [ ] 3.2 Source fold: branch, ahead/behind, staged/unstaged/untracked counts,
      inline commit/push/pull (reuse existing source/git lib + service); diff as
      a popover, not a column
- [ ] 3.3 Plans & Ideas fold: mount the existing `PlanningInspector` unchanged
      (folded by default); generation stays in the chat composer's planning menu
- [ ] 3.4 Files control: single button opening the file-explorer modal; no
      inline tree
- [ ] 3.5 Verify: `npx tsc --noEmit` + `npm run build`; e2e — folds, collapse,
      commit path, Files opens modal

## 4. File explorer modal

- [ ] 4.1 `FileExplorerModal.tsx`: shared modal overlay contract; directory tree
      + preview/detail; fuzzy path search; 0px radius, tooltips
- [ ] 4.2 Open-file wiring: selecting a file creates/focuses a file workspace tab
      and closes the modal; reopen focuses the existing tab (reuse `file-viewer-editor`
      viewer for content where available)
- [ ] 4.3 Verify: e2e — open modal, search-filter, open file into tab, reopen
      focuses existing

## 5. Composer additions

- [ ] 5.1 Microphone control: toggle voice-to-text into the input at the cursor;
      active recording state; degrade to disabled+tooltip when unavailable;
      local-first (no silent upload)
- [ ] 5.2 Context size + usage readout beside model/effort; mono numerals;
      tooltip with exact figures; updates as the conversation grows/compacts;
      graceful when window size unknown
- [ ] 5.3 Keep model + effort always visible (no overflow-hiding); tall growing
      input retained
- [ ] 5.4 Backend (if native transcription): transcription service + Tauri
      command + thin `src/lib` wrapper; unit tests for the service
- [ ] 5.5 Verify: `cargo test` (transcription/usage services); `npx tsc --noEmit`
      + `npm run build`; e2e — mic states, usage readout renders

## 6. Native window chrome + menu

- [ ] 6.1 `src-tauri/tauri.conf.json`: window `decorations` → native
- [ ] 6.2 `lib.rs`: build a `File / Edit / View` application menu via
      `tauri::menu`; wire standard items
- [ ] 6.3 Verify: `cargo check` + `cargo test`; app launches with native chrome
      and the menu present

## 7. Verification

- [ ] 7.1 Full pass: `npx tsc --noEmit`, `npm run build`, `cargo check`,
      `cargo test`, `BASEBUILD_E2E=1 npm run test:e2e`
- [ ] 7.2 UI smoke with screenshots (running app): left column (5-recent, show
      more, pins, timestamps, bottom account), floating env block (folds,
      collapse, commit), file modal, composer (mic, context/usage), native
      window chrome + menu

## 8. Docs & Roadmap

- [ ] 8.1 `DESIGN.md` (layout already updated) — reconcile any drift with the
      shipped implementation
- [ ] 8.2 `docs/agents/design-system.md`: new classes for the sidebar, floating
      env panel, file modal, mic, and context/usage readout
- [ ] 8.3 `docs/agents/desktop-shell.md`: single-column shell, workspace tabs
      over center, native menu, environment block, file modal
- [ ] 8.4 `node scripts/openspec-status.mjs --write` + ROADMAP narrative pass in
      the same commit (Invariant 12)
