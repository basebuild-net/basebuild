# Tasks: Global Shell Reliability

## 1. Startup splash

- [x] 1.1 Create `StartupSplash` component: fixed overlay, app name/version,
      CSS-animated spinner, phase label driven by `restorePhase` prop
      (`"starting"` → `"restoring"` → `"detecting"` → `"resolving"` →
      `"ready"`). 200ms opacity fade-out on `"ready"`, then unmount.
- [x] 1.2 Wire `restorePhase` state in `AppShell`: set phase at each restore
      pipeline step (workspace restore, project detection, provider
      resolution). Dismiss splash on `"ready"`.
- [x] 1.3 Add `.startup-splash` styles to `globals.css`: fixed full-viewport
      overlay, centered content, spinner keyframes, 0px border radius, no
      images.
- [x] 1.4 Add e2e: app launch shows splash with phase label; splash
      dismisses when shell is interactive; no blank window.

## 2. Project-switch transition

- [x] 2.1 Create `ProjectSwitchingOverlay` component: centered loading icon
      with target project name, rendered in main view area during switch.
- [x] 2.2 Wire `switchingTo` state in `AppShell`: set on `onSelectProject`,
      clear on restore completion. Render overlay when `switchingTo` is set.
- [x] 2.3 Add `.project-switching-overlay` styles to `globals.css`.
- [x] 2.4 Add e2e: clicking a different project shows the overlay with the
      target name immediately; overlay clears when restore completes; old
      project content is not visible during switch.

## 3. Left column: repo identity

- [x] 3.1 Add `getRepoIdentity(path)` utility: parse git remote URL to
      extract host (github/gitlab/bitbucket/other) and repo name. Return
      `{ host, name, branch }` or `null` for non-git projects.
- [x] 3.2 Bundle host favicon SVGs (github/gitlab/bitbucket/generic-git)
      in `src/assets/repo-icons/`. 16×16, no border radius.
- [x] 3.3 Redesign `ProjectSidebar` project row: icon (repo favicon or
      folder), repo name (last path segment), branch label. Replace the
      current path-only display.
- [x] 3.4 Add `.sidebar-repo-icon`, `.sidebar-repo-name`,
      `.sidebar-repo-branch` styles to `globals.css`.

## 4. Left column: all projects visible

- [x] 4.1 Remove `collapsedProjects` state and fold/collapse chevron from
      `ProjectSidebar`. All projects are always visible rows.
- [x] 4.2 Active project highlighted via `.sidebar-item.is-active`; inactive
      projects dimmed but visible (`.sidebar-item.is-inactive`).
- [x] 4.3 Sessions remain expandable per-project (chevron on the session
      list, not the project row).
- [x] 4.4 Add e2e: all projects visible without expanding; active project
      highlighted; inactive projects visible and clickable.

## 5. Left column: agent status indicators

- [x] 5.1 Add `getProjectAgentStatus(projectPath, sessions)` utility:
      derive `running`/`standby`/`questioning`/`idle` from session state
      (in-flight turn, pending interaction, session exists).
- [x] 5.2 Render status dot (8×8) in each project row. CSS animations:
      `pulse` (running), `bounce` (questioning), solid (standby), hollow
      (idle).
- [x] 5.3 Add `.agent-status-dot`, `@keyframes pulse`, `@keyframes bounce`
      to `globals.css`. 0px border radius on the dot.
- [x] 5.4 Add e2e: status dot renders for each project with correct state;
      running dot pulses; questioning dot bounces; idle dot is hollow.

## 6. History and plans as project-scoped views

- [x] 6.1 Scope `HistoryDrawer` to filter panels by active project path.
      Remove any global/all-projects history view.
- [x] 6.2 Verify `PlanningInspector` already scopes plans to active project
      (no change needed — confirm via test).
- [x] 6.3 Remove any left-column section that duplicates plan/session lists
      as global lists. Sessions remain as per-project expandable sub-rows.
- [x] 6.4 Add e2e: history drawer shows only active project's panels;
      switching projects updates history drawer content.

## 7. Verification

- [x] 7.1 `npx tsc --noEmit` and `npm run build` pass
- [x] 7.2 `cargo check` and `cargo test` pass
- [x] 7.3 `npm run test:e2e` passes including new specs
- [x] 7.4 `npm run check:ui-invariants` passes (0px radius, no inline
      styles, tooltips on interactive elements)
