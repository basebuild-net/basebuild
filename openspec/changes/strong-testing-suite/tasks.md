# Tasks: Strong Testing Suite

## 1. Test Inventory

- [ ] 1.1 Inventory existing local commands, Rust tests, frontend checks, and Playwright coverage
- [ ] 1.2 Identify the top manual workflows that currently need automated coverage
- [ ] 1.3 Document required failure artifacts for renderer, Rust, and build failures

## 2. Local Test Harness

- [ ] 2.1 Standardize package scripts for typecheck, frontend build, and browser workflow tests
- [ ] 2.2 Expand Tauri command mocks for plans, sessions, files, settings, terminals, and crash paths
- [ ] 2.3 Add Playwright tests for plan CRUD, plan context generation, tab creation, file opening, and settings defaults
- [ ] 2.4 Add explicit tests for renderer crash report UI and unhandled promise rejection handling

## 3. Backend Checks

- [ ] 3.1 Add or stabilize Rust service tests for plan, session, schematic, file, settings, and terminal services
- [ ] 3.2 Ensure `cargo check` and `cargo test` run cleanly from `src-tauri/`
- [ ] 3.3 Document any native prerequisites needed for CI runners

## 4. GitHub Actions

- [ ] 4.1 Add frontend CI job with npm cache, `npm ci`, `npx tsc --noEmit`, and `npm run build`
- [ ] 4.2 Add Playwright CI job with browser cache/install and `npm run test:e2e`
- [ ] 4.3 Add Rust CI job with Rust/Cargo cache, `cargo check`, and `cargo test`
- [ ] 4.4 Upload Playwright traces, screenshots, videos, and logs on failure
- [ ] 4.5 Configure workflow triggers for pull requests and pushes

## 5. Documentation & Adoption

- [ ] 5.1 Update `docs/agents/testing.md` with local and CI commands
- [ ] 5.2 Update contributor-facing docs with expected checks before PRs
- [ ] 5.3 Add a short troubleshooting section for black-window/crash-report failures
- [ ] 5.4 Verify the workflow by running it locally where possible and checking one GitHub Actions run
