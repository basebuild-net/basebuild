# Design: Strong Testing Suite

## Context

Basebuild is a Tauri desktop app with a React renderer, Rust command/services layer, local SQLite/project metadata, terminal/agent process management, and plan pipeline UI. Manual testing is not enough because failures can happen only after user interaction, and renderer crashes may otherwise leave a black app window.

## Goals / Non-Goals

**Goals**:
- Run fast deterministic checks on every PR and push.
- Cover core user workflows in a browser harness with mocked Tauri commands.
- Run Rust backend checks/tests separately from frontend checks so failures point to the right layer.
- Capture useful failure artifacts: Playwright traces, screenshots, videos, build logs, and test reports.
- Keep CI reproducible on GitHub-hosted runners.
- Make crash diagnostics a tested behavior, not a best-effort UI.

**Non-Goals**:
- Full native installer signing/release validation.
- Testing every external agent provider against live credentials.
- Uploading user project data or telemetry from CI.
- Replacing manual exploratory QA for visual polish.

## Decisions

### Decision: Layer tests by runtime
**Rationale**: Frontend, Rust, browser workflow, and native package checks fail for different reasons and need separate logs. Separate jobs keep signal clear and allow caching per toolchain.
**Alternatives**: One all-in CI job - rejected because it hides which layer failed and wastes time rerunning independent setup.

### Decision: Browser workflow tests use mocked Tauri commands
**Rationale**: Most renderer regressions can be caught by Vite + Playwright without booting a native desktop window. Mocks make tests deterministic and safe in CI.
**Alternatives**: Only test through `tauri dev` - rejected because it is slower, harder to run headlessly, and couples every UI regression to native shell startup.

### Decision: Native smoke checks remain minimal
**Rationale**: Tauri packaging can be expensive and platform-specific. CI should first prove compile/build health, then add a small native startup smoke where practical.
**Alternatives**: Full installer build on every PR - rejected as too slow for routine feedback.

### Decision: CI uploads debug artifacts on failure
**Rationale**: The user cannot manually retest every path. A failing workflow must show what happened without requiring local reproduction first.
**Alternatives**: Console logs only - rejected because visual regressions and renderer crashes need screenshots/traces.

## Risks / Trade-offs

- **Mock drift**: Browser tests may pass while real Tauri commands change. Mitigation: keep mock command names typed and add a native smoke job for command registration/build health.
- **CI duration**: More checks can slow PRs. Mitigation: parallel jobs, dependency caching, and small smoke suites for PRs.
- **Flaky browser tests**: UI tests can race async state. Mitigation: assert user-visible states and use Playwright auto-waiting, not sleeps.
- **Platform gaps**: Windows-specific shell behavior may differ from Linux runners. Mitigation: run Rust/frontend everywhere first, add targeted Windows smoke once stable.

## Migration Plan

1. Normalize local commands: `npm run build`, `npm run test:e2e`, `cargo check`, `cargo test`.
2. Add GitHub Actions jobs for frontend, Rust, and Playwright.
3. Add cache keys for npm, Cargo, Rust toolchain, and Playwright browsers.
4. Upload Playwright traces/screenshots/videos and build logs on failure.
5. Add required workflow documentation in `docs/agents/testing.md` and contributor docs.
6. Expand workflow coverage incrementally for plans, sessions, files, terminals, settings, and crash reporting.

## Open Questions

- Should CI run on Windows as the primary platform because `dev.bat` is Windows-first, or use Linux for speed plus a narrower Windows smoke job?
- Which branches should enforce required GitHub checks once the repository enables branch protection?
- Should native Tauri smoke tests use WebDriver/Appium later, or stay at Playwright+mocked renderer coverage until packaging stabilizes?
