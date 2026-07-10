# Design: Global Shell Reliability

## Context

The Basebuild shell is a Tauri v2 + React 19 desktop app. The left column
(`ProjectSidebar`) lists projects and sessions. The main view (`AppShell`
center workspace) shows the active project's panels. Workspace restore runs
on app launch and on project switch.

Existing specs:
- `startup-update-gate` — covers the update-check splash (packaged builds).
- `desktop-shell` — covers tab routing, panel creation, atomic project
  activation, single-flight folder selection.
- `ide-workspace-state` — covers workspace restore, persistent layout.
- `ai-workbench-shell` — covers persistent bars, compact context.

This change adds reliability and identity to the shell without restructuring
the panel grid or tab model.

## Goals

1. The user sees a loading state within 1 frame of app launch — no blank
   window.
2. The user sees a transition state within 1 frame of clicking a different
   project — no staring at the old project's content.
3. The user can identify every project at a glance by repo identity and
   agent status, without expanding anything.
4. History and plans are scoped to the active project, not global sidebar
   lists.

## Non-Goals

- Redesigning the panel grid, tab bar, or chat layout.
- Adding new panel types.
- Changing the update-gate splash.
- Adding network calls or remote telemetry.

## Design

### Startup splash

A React component (`StartupSplash`) rendered as a fixed overlay during the
restore phase. It shows:

- App name and version (from `package.json`).
- A loading indicator (CSS-animated spinner — no images, no network).
- Phase labels driven by the restore pipeline:
  1. "Starting up…"
  2. "Restoring workspace…"
  3. "Detecting projects…"
  4. "Resolving providers…"
  5. (dismissed)

The splash is dismissed when `AppShell` reports `ready` (all restore
subsystems resolved or failed). The splash is a pure CSS overlay — no
lazy-load, no Suspense boundary — so it paints before any code-split chunk
loads.

**Lifecycle**: `AppShell` sets a `restorePhase` state (`"starting"` →
`"restoring"` → `"detecting"` → `"resolving"` → `"ready"`). The splash reads
this state and renders the corresponding label. On `"ready"`, the splash
fades out (200ms CSS opacity transition) and is removed from the DOM.

### Project-switch transition

When `onSelectProject` fires, `AppShell` immediately:
1. Sets `switchingTo: path` state.
2. Renders a `ProjectSwitchingOverlay` in the main view area — a centered
   loading icon with the target project name.
3. Runs the existing restore pipeline (already generation-guarded per
   `desktop-shell` atomic activation).
4. On completion, clears `switchingTo` and renders the new project's panels.

The overlay is a sibling to the panel grid, not a child — it replaces the
grid's content area during the switch. The left column remains interactive
(the user can cancel or switch again).

### Left column redesign

The `ProjectSidebar` is restructured:

#### Repo identity row

Each project row shows:
- **Icon**: If the project is a git repo, show the remote host favicon
  (GitHub/GitLab/Bitbucket) fetched from the git remote URL at detection
  time. If not a git repo, show a folder icon. The icon is 16×16, no border
  radius.
- **Name**: Last path segment of the project path (e.g. `basebuild-app`).
- **Branch**: Current git branch name (if git repo), shown as a muted label
  below the name.

The remote host favicon is determined by parsing the git remote URL:
- `github.com` → GitHub mark
- `gitlab.com` → GitLab mark
- `bitbucket.org` → Bitbucket mark
- Other/self-hosted → generic git icon

Favicons are bundled SVG assets (no network fetch). This preserves the
local-first, no-phone-home posture.

#### All projects visible

Remove the `collapsedProjects` state and the fold/collapse chevron. Every
project is always a row. Sessions under each project are still
expandable/collapsible (the session list is per-project, not the project
itself).

#### Agent status indicators

Each project row shows a status dot (8×8, no border radius) to the left of
the repo identity:

| Status | Visual | Meaning |
|---|---|---|
| `running` | Pulsing green dot | Agent is actively streaming/working |
| `standby` | Solid blue dot | Session exists, agent is idle |
| `questioning` | Bouncing amber dot | Agent has a pending question/approval |
| `idle` | Hollow gray dot | No active session |

The status is derived from the native chat session state:
- `running`: session has an in-flight `native_chat_start` turn.
- `questioning`: session has a pending interaction (question/approval).
- `standby`: session exists, no in-flight turn, no pending interaction.
- `idle`: no session for this project.

Animations are CSS-only (`@keyframes` in `globals.css`): `pulse` (opacity
0.4↔1.0, 1.2s), `bounce` (translateY 0↔-2px, 0.6s). No JS animation loop.

### History and plans as project-scoped views

- **Plans**: Already scoped to the active project via `PlanningInspector`.
  No change needed — the `SidePanel` "plans" section already delegates to
  `PlanningInspector` which reads the active project path.
- **History**: The `HistoryDrawer` currently shows panels from all projects.
  It is scoped to filter by the active project path. The `SidePanel` "files"
  and "source" sections already scope to the active project.

The `SidePanel` sections (plans, files, source) remain as project-scoped
navigation. The key change is that the `ProjectSidebar` (left column) no
longer duplicates plan/session lists — it shows project identity and status
only, with sessions as expandable sub-rows.

## Risks

- **Splash flash on fast loads**: If restore completes in <100ms, the splash
  may flash. Mitigation: minimum display time of 300ms before fade-out, or
  skip splash if restore completes before first paint.
- **Agent status staleness**: The status dot depends on real-time session
  state. If the session state hook doesn't update on chat events, the dot
  will be wrong. Mitigation: derive status from the same `useSessionState`
  hook that ChatPanel uses.
- **Remote URL parsing edge cases**: SSH remotes (`git@github.com:…`) and
  self-hosted instances need robust parsing. Mitigation: parse both SSH and
  HTTPS formats; fall back to generic git icon for unrecognized hosts.

## Migration

No data migration. The `collapsedProjects` localStorage state is simply
ignored (no cleanup needed — it's a UI-only preference).
