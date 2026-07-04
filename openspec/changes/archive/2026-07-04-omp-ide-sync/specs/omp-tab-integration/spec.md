## ADDED Requirements

### Requirement: Detection-gated "Oh My Pi" new-tab option

The workspace "+" new-tab menu SHALL present an "Oh My Pi" option only when OMP is detected
installed (via the existing `omp_status` probe reporting `installed = true`). When OMP is not
detected, the option SHALL be hidden, or shown disabled with a tooltip explaining OMP was not
found on `PATH`. Detection SHALL use the existing hidden-process probe and MUST NOT block menu
rendering. The option coexists with the existing Terminal, Schematic, and Chat entries; the
Basebuild native chat window remains available regardless.

#### Scenario: Option appears when OMP is installed

- **WHEN** the new-tab menu opens and `omp_status` reports OMP is installed
- **THEN** the menu shows an "Oh My Pi" entry alongside Terminal, Schematic, and Chat, with a descriptive `title` tooltip

#### Scenario: Option hidden or disabled when OMP is absent

- **WHEN** the new-tab menu opens and `omp_status` reports OMP is not installed
- **THEN** the "Oh My Pi" entry is not offered as an active choice (hidden or disabled with an explanatory tooltip) and selecting it never attempts to spawn `omp`

### Requirement: "Oh My Pi" opens a raw OMP terminal tab

Selecting "Oh My Pi" SHALL open a new workspace tab that runs OMP's own interactive TUI in a
PTY-backed terminal, in the active project's working directory, so the user interacts with OMP
directly as a raw terminal. The tab SHALL be spawned only in response to this explicit user
action, consistent with the no-auto-spawn workspace policy. The system SHALL attach the
read-only telemetry channel (from `omp-session-telemetry`) to this session.

#### Scenario: Explicit selection spawns the OMP terminal

- **WHEN** the user selects "Oh My Pi" from the new-tab menu
- **THEN** a new PTY-backed terminal tab is created that runs OMP's interactive TUI in the active project's working directory and read-only telemetry is attached to it

#### Scenario: Restore never auto-spawns OMP

- **WHEN** a project with a previously open OMP terminal tab is restored on app launch
- **THEN** the OMP tab is not auto-spawned; it shows a disconnected state until the user reconnects, matching existing terminal/agent restore behavior

### Requirement: OMP terminal tab surfaces live telemetry

An OMP terminal tab SHALL display, alongside the raw terminal, the live session telemetry
provided by the `omp-session-telemetry` capability: the current provider, plan, model, and
effort level (when resolvable), and the live provider window utilization, updating as the
session progresses.

#### Scenario: Tab shows current session context

- **WHEN** an OMP terminal tab has an active session that produces messages
- **THEN** the tab surfaces the current provider/plan/model/effort and live window utilization, updating on each telemetry event

#### Scenario: Tab shows detached state when the session ends

- **WHEN** the OMP session in a tab exits
- **THEN** the tab shows a detached/disconnected indicator rather than continuing to display the last-known values as if live
