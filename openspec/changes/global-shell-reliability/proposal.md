# Proposal: Global Shell Reliability

## Why

The Basebuild shell has three reliability gaps that degrade first impressions and
daily usability:

1. **Startup opacity.** The app shows a blank or partially-rendered shell while
   workspace restore, project detection, and provider resolution run. There is
   no splash or loading screen that tells the user what is happening, how far
   along it is, or whether anything is wrong. The existing
   `startup-update-gate` spec covers the *update check* splash, but nothing
   covers the *workspace restore* window between the update gate and the
   interactive shell.

2. **Project-switch has no transition state.** The `desktop-shell` spec already
   requires an "atomic project activation surface" with a loading surface and
   stale-data guard, but the current implementation paints the new project's
   content only after all subsystems resolve — meaning the user stares at the
   old project's chat/panels for seconds before the switch "happens." There is
   no immediate visual transition (loading icon, fade, skeleton) that confirms
   the switch was registered.

3. **Left column lacks repo identity and agent status.** The current
   `ProjectSidebar` shows project paths and session lists, but:
   - No git repo identity (icon, remote host image, repo name) — users with 3+
     repos cannot tell them apart at a glance.
   - Projects are folded/collapsed by default — all projects should be visible
     with their active state, not hidden behind a chevron.
   - No agent status indicators — there is no at-a-glance answer to "which
     project is running an agent, which is questioning, which is idle?"
   - History and plans are left-column sections, not project-scoped views —
     they should be scoped to the active project in the main view, not
     global lists in the sidebar.

## What Changes

### 1. Startup splash / loading screen

Add a lightweight splash overlay that paints immediately on app launch, shows
the app name/version and a loading indicator with phase labels ("Restoring
workspace…", "Detecting projects…", "Resolving providers…"), and dismisses
when the shell is interactive. This is distinct from the update-gate splash
(which runs first during packaged startup) and covers the dev-mode and
post-update-gate window.

### 2. Project-switch transition

When the user selects a different project, paint an immediate transition state
in the main view — a loading icon or skeleton with the project name — before
the restore subsystems resolve. This makes the switch feel instant even when
restore takes seconds. The existing atomic-activation guarantees (no stale
data, late-response ignoring) are preserved.

### 3. Global left column redesign

Redesign the left column (`ProjectSidebar`) to show:

- **Repo identity**: Git icon or remote-host favicon (GitHub/GitLab/Bitbucket),
  repo name (last path segment), and branch name. Non-git projects show a
  folder icon and path.
- **All projects visible**: No fold/collapse by default. Every project is a
  row with its identity, active highlight, and agent status indicator. The
  active project is highlighted; inactive projects are dimmed but visible.
- **Agent status indicators**: Per-project animated indicator showing:
  - **Running** (pulsing dot) — an agent is actively working.
  - **Standby** (solid dot) — agent is idle, session exists.
  - **Questioning** (bouncing dot) — agent has a pending question/approval.
  - **Idle** (hollow dot) — no active session.

### 4. Main view = project-specific context

The main view (center workspace) already shows the active project's chat,
terminal, files, etc. This is formalized: the main view is always scoped to
the active project. The left column's job is navigation and status, not
content.

### 5. History and plans as project-scoped views

Move history and plans out of the left-column sections and into project-scoped
views accessible from the main view. The `PlanningInspector` modal already
scopes plans to the active project; this change ensures the history drawer
also scopes to the active project and that neither appears as a left-column
section.

## Spec Deltas

- `desktop-shell` — add startup splash, project-switch transition, left-column
  repo identity, agent status indicators, all-projects-visible, project-scoped
  views requirements.
- `ai-workbench-shell` — add agent status indicator and repo identity
  requirements to the persistent-bars section.
- `ide-workspace-state` — add startup splash phase requirement and
  project-switch transition state requirement.
