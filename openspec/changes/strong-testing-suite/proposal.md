# Proposal: Strong Testing Suite

## Why

Basebuild is currently hard to validate manually: a single click can black-screen the desktop app without a reliable signal. The project needs a layered automated testing system that runs locally and in GitHub Actions so regressions are caught before users run `dev.bat`.

## What Changes

- Add a first-class automated test strategy for frontend, Rust backend, browser workflows, and packaged desktop smoke checks.
- Add GitHub Actions workflows that run type checks, builds, Rust checks/tests, Playwright regressions, and artifact capture on failures.
- Standardize mocked Tauri/browser tests so core flows can run without launching the native desktop shell.
- Add crash-report and diagnostic expectations to tests so renderer failures produce visible reports instead of black windows.
- Document local and CI test commands so contributors can reproduce failures.

## Capabilities

### New Capabilities
- `testing-automation` - local and CI test suite covering frontend, backend, browser workflows, and crash diagnostics.

### Modified Capabilities
- `desktop-shell` - renderer failures must surface visible crash diagnostics that are asserted by tests.

## Impact

- Affected areas: `package.json`, Playwright config/tests, Rust test commands, GitHub Actions workflows, docs, and any test seams needed for Tauri command mocking.
- CI will take longer than a bare build, but should produce actionable artifacts: screenshots, traces, logs, and test reports.
