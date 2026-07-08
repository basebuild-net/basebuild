# testing-automation Specification

## Purpose
Defines the local and CI verification harnesses required to protect Basebuild workflows.
## Requirements
### Requirement: Local Test Commands
The system SHALL provide documented local commands for frontend type/build checks, browser workflow regressions, and Rust backend checks/tests.

#### Scenario: Run local frontend checks
- **WHEN** a contributor runs the documented frontend commands
- **THEN** TypeScript errors, production build errors, and browser workflow regressions are reported with non-zero exit codes

#### Scenario: Run local backend checks
- **WHEN** a contributor runs the documented Rust commands in `src-tauri/`
- **THEN** Rust compile errors and service test failures are reported with non-zero exit codes

### Requirement: Browser Regression Harness
The system SHALL run Playwright workflow tests against the Vite renderer with deterministic Tauri command mocks.

#### Scenario: Plan context generation regression
- **WHEN** the browser test clicks the plan generation flow for project context
- **THEN** the app remains rendered, opens the expected chat draft, and does not display the renderer crash report

#### Scenario: Unhandled mock command
- **WHEN** renderer code invokes a Tauri command that the browser harness does not model
- **THEN** the test fails with the missing command name instead of silently passing

### Requirement: Crash Diagnostics Coverage
The system SHALL test that renderer failures surface a visible crash report rather than a black window.

#### Scenario: Render crash
- **WHEN** a React render error occurs in the shell
- **THEN** the user sees a crash report with source, stack details, reload action, and copy-details action

#### Scenario: Unhandled promise rejection
- **WHEN** an unhandled renderer promise rejection occurs
- **THEN** the user sees a crash report identifying the rejection source

### Requirement: GitHub Actions CI
The system SHALL run automated checks in GitHub Actions on pull requests and pushes.

#### Scenario: Pull request validation
- **WHEN** a pull request is opened or updated
- **THEN** GitHub Actions runs frontend checks, Rust checks/tests, and Playwright browser regressions before merge

#### Scenario: Failure artifacts
- **WHEN** a CI browser workflow test fails
- **THEN** the workflow uploads Playwright traces, screenshots, videos, and relevant logs as artifacts

### Requirement: CI Caching
The system SHALL cache expensive dependencies in CI without hiding stale dependency failures.

#### Scenario: Dependency cache hit
- **WHEN** npm, Cargo, or Playwright dependencies are unchanged
- **THEN** CI reuses caches to reduce runtime while still running the full requested checks

#### Scenario: Dependency lock change
- **WHEN** package lockfiles or Cargo metadata change
- **THEN** CI invalidates the affected cache and installs dependencies from the updated lockfiles

### Requirement: Test database isolation
The system SHALL run automated tests (Rust unit/integration and any harness
that exercises storage) against an isolated `BASEBUILD_HOME` (temp directory) and
MUST NOT read or write the developer's real `~/.basebuild/state.db`. A
shared test-util constructor SHALL provision the isolated home, and CI/test
review SHALL treat writes to the real profile as failures.

#### Scenario: Tests leave the user DB untouched
- **WHEN** `cargo test` runs on a developer machine with an existing
  `~/.basebuild/state.db`
- **THEN** no rows are added, modified, or deleted in that database (e.g. no
  `/test/project-*` fixtures appear in `chat_model_defaults`)

#### Scenario: Test home auto-provisioned
- **WHEN** a storage-touching test constructs its service under test
- **THEN** the test helper sets `BASEBUILD_HOME` to a fresh temp directory
  scoped to that test and cleans it up afterward

### Requirement: Mandatory UI invariants are machine-checked
CI SHALL reject additional stylesheets, React inline styles, non-zero border radius, and interactive elements without a `title` tooltip, except for narrow reviewed computed-geometry cases documented beside the check. The repository SHALL clear existing violations before enabling the gate.

#### Scenario: Interactive button lacks a title
- **WHEN** a change adds an interactive JSX button without `title=`
- **THEN** the invariant check fails with the file and line before UI tests run

### Requirement: MVP journey and compact visual coverage
The system SHALL gate the AI workbench workflow with deterministic tests and
live screenshots at 960x640 and 1280x800. Coverage SHALL include exact command
strip routing, no manual plan creation, side-by-side Settings, compact context,
connected-first provider ordering, provider-scoped models, session restoration,
visible tool/question activity, and non-blank modal loading/error states.

#### Scenario: Course-correction suite runs
- **WHEN** CI or a release candidate runs the MVP workbench gate
- **THEN** any wrong destination, blank modal, overflowing required control,
  false tools capability, hidden activity, or manual plan creation fails the gate
### Requirement: Responsiveness and diagnostic-noise budgets
The system SHALL measure project-loading first paint, modal first paint,
provider/model restoration, and first activity feedback. Common UI feedback
SHALL begin within 100ms, slow operations SHALL remain off the renderer thread,
and every entry, abort, retry, and state transition SHALL emit debug context
without expected transitions becoming warnings.

#### Scenario: User opens Ideas during catalog refresh
- **WHEN** a provider catalog refresh is running and the user opens Ideas
- **THEN** the modal frame and loading/empty content respond immediately, remain
  interactive, and produce no freeze report or unrelated warning spam
