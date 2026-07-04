# testing-automation Specification

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
