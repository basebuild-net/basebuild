# testing-automation Specification

## ADDED Requirements

### Requirement: Mandatory UI invariants are machine-checked
CI SHALL reject additional stylesheets, React inline styles, non-zero border radius, and interactive elements without a `title` tooltip, except for narrow reviewed computed-geometry cases documented beside the check. The repository SHALL clear existing violations before enabling the gate.

#### Scenario: Interactive button lacks a title
- **WHEN** a change adds an interactive JSX button without `title=`
- **THEN** the invariant check fails with the file and line before UI tests run

### Requirement: MVP journey and compact visual coverage
Automated coverage SHALL exercise the MVP journey from folder open through merge-review readiness with deterministic provider/Git fixtures, plus restart focus and partial-restore failure. Visual/interaction snapshots SHALL cover 960×640 and 1280×800 for the shell, menus, planning surfaces, dialogs, and multi-chat layouts.

#### Scenario: Golden-path regression suite runs
- **WHEN** the MVP e2e suite runs on the deterministic fixture
- **THEN** questionnaire, generation, artifact approval, assignment, dependency scheduling, worker progress, and merge-review readiness complete without manual typing beyond explicit free-text feedback

### Requirement: Responsiveness and diagnostic-noise budgets
The shell SHALL paint action feedback and project-loading state within 100 ms and make the smoke fixture usable within 1 second. The initial renderer JavaScript chunk SHALL remain below 500 kB minified; heavy planning, catalog, and settings surfaces SHALL load on demand. A 60-second streaming/project-switch/panel-resize smoke SHALL produce no freeze report, duplicate project activation/config load, false orphan warning, or unhandled error.

#### Scenario: Responsiveness smoke completes
- **WHEN** the 60-second smoke streams a chat while switching projects and resizing panels
- **THEN** recorded budgets pass and diagnostics contain one activation/config sequence per completed project switch with no freeze or false recovery event

#### Scenario: Production bundle is built
- **WHEN** the frontend production build reports chunk sizes
- **THEN** the initial renderer chunk is below 500 kB minified and oversized lazy chunks are identified without blocking the first shell paint
