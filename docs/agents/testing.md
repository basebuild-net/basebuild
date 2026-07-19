# Testing and Verification

Every change MUST be verified before yielding. The verification path depends
on what changed.

## By change type

| Change type | Required verification |
|---|---|
| TypeScript/React | `npx tsc --noEmit`, `npm run build` |
| Browser workflow / regression | `npm run test:e2e` |
| UI/CSS | Screenshot of the changed view in the running app |
| Settings/permissions | Test default values, reset, and persistence |
| Analytics | Test that collection and upload are disabled on fresh install |
| Agent/chat | Test adapter start, message send, draft injection, and error states |
| Plans | Test CRUD end-to-end (create, edit, status change, delete) |
| Docs | Verify all cross-references resolve and content matches code |

## Commands

```bash
npx tsc --noEmit     # Type check
npm run build        # Frontend build
npm run test:e2e     # Playwright browser regression tests with mocked Tauri commands
cargo check          # Rust check (run in src-tauri/)
cargo test           # Rust tests (run in src-tauri/)
```

## Visual verification

After every UI change, visually verify. Never yield a UI change without a
screenshot.

1. Run `npm run tauri dev` and open the app.
2. Use the browser/screenshot tool to capture the window.
3. Check alignment, spacing, hover states, collapsed/expanded modes, tooltips,
   and the active tool tab highlight.
4. Test the actual interaction.

## Test boundaries

- Test behavior, not implementation state.
- Assert logical behavior: what the user sees and what persists.
- Aim at conditional branches, edge values, invariants across fields, and error
  handling versus silent broken results.
- Run only tests you added or modified unless asked otherwise.
- Rust tests for services: test the service methods directly, not through Tauri commands.
- Frontend tests: test hooks and pure functions, not React component internals.
- Browser workflow tests use Playwright against the Vite dev server with mocked
  Tauri commands (`BASEBUILD_E2E=1`) so renderer crashes are visible in CI.

## What NOT to do

- Do not disable tests to make them pass.
- Do not suppress warnings to hide real problems.
- Do not ship stubs, placeholders, mocks, or `TODO: implement` as delivered work.
- Do not skip visual verification for UI changes.

## CI pipeline

GitHub Actions (`.github/workflows/windows.yml`) runs three jobs on every PR and push to `main`:

| Job | What it does |
|---|---|
| `check-frontend` | `npm ci`, `npm run build`, UI and release-config checks, updater-manifest tests |
| `check-rust` | `cargo test` on Ubuntu with Tauri Linux dependencies |
| `check-e2e` | `BASEBUILD_E2E=1 npm run test:e2e` with Playwright browser cache |

Manual dispatch first creates one draft release, then runs Windows x64, Linux
x64, and universal macOS builds concurrently. Each matrix leg uploads distinct
assets and signatures without writing `latest.json`. After all three finish,
`generate-updater-manifest` uploads one complete manifest, then
`verify-release` rejects a draft missing a required installer, signature, or
platform entry.

Playwright traces, screenshots, and videos are uploaded as artifacts on failure
(7-day retention).

### Local CI reproduction

```bash
npx tsc --noEmit              # check-frontend
npm run build                 # check-frontend
cd src-tauri && cargo check   # check-rust
cd src-tauri && cargo test    # check-rust
BASEBUILD_E2E=1 npm run test:e2e  # check-e2e
```

### Crash diagnostics in tests

Renderer crashes produce JSON reports under `<app-data>/reports/` (see
`stability_service.rs`). The DebugPanel shows unseen reports with a badge.
E2e tests should assert crash report visibility for renderer failure paths.

### Freeze drill

To test freeze detection locally:

1. Run `npm run tauri dev`.
2. Open the DebugPanel (click the warning icon in the status bar).
3. Trigger a main-thread block (e.g., run a long synchronous operation in the
   Tauri dev console or add a `std::thread::sleep` in a command handler).
4. After 10s, a freeze report should appear in the DebugPanel.
5. After 60s, the process should abort with a final report.

### Crash drill

To test panic/crash detection:

1. Run `npm run tauri dev`.
2. Trigger a panic (e.g., add `panic!("drill")` in a command handler).
3. The panic hook writes a report to `<app-data>/reports/`.
4. On next launch, the `CrashReportNotice` toast should surface the unseen report.
5. Open the DebugPanel to view, dismiss, or delete the report.

### Responsiveness smoke

Run a 60s streaming chat session while performing UI interactions (open tabs,
run `git diff`, resize panels). The freeze watchdog should not trigger (no
freeze reports). Command telemetry should show no >50ms violations for UI
interactions.

### Panel-grid state reliability regression matrix

The `panel-grid-state-reliability` change adds regression coverage for
self-healing, project-scoped, transactional panel-grid state:

| Regression | Suite | What it asserts |
|---|---|---|
| Corrupt restore (stale `activePanelId`) | `panel-grid-reliability.spec.ts` | Restore repairs the stale active id to a surviving live panel; header/sidebar creation still works from the repaired state. |
| Checked insertion (no silent no-op) | `panel-grid-math.spec.ts` | `insertPanel` returns a failure reason when the anchor is missing; `splitPanelAt` is a no-op on a missing target. |
| One click = one panel + one backing tab | `panel-grid-reliability.spec.ts` | A single chat click creates exactly one `.panel-grid-leaf` and one backing session tab. |
| Rapid repeated clicks | `panel-grid-reliability.spec.ts` | Repeated clicks within the in-flight window produce exactly one panel (serialized per type). |
| Project restore loading boundary | `panel-grid-reliability.spec.ts` | Panel creation is blocked until the selected project's restore resolves; late restore responses from a previous project are ignored. |
| Normalization (malformed/stale/dup ids) | `panel-grid-math.spec.ts` | `parsePanelGridWithDiagnostics` repairs stale active ids, quarantines duplicate ids without deleting backing sessions, and rejects malformed JSON / invalid sizes / nested splits. |
| Orphan recovery (non-destructive) | `panel-grid-math.spec.ts` | `detectOrphanedTabs` flags backing tabs with no reachable panel; detection never deletes. |
| Rollback on failed resource creation | `panel-grid-math.spec.ts` | `removePanelFromGrid` rolls back a `creating` reservation without touching history. |

When adding new panel creation paths, route them through `insertPanel` /
`commitInsert` and add a row to this matrix.

### MVP workflow hardening test suites

The `mvp-workflow-hardening` change adds regression coverage for the full MVP
journey:

| Regression | Suite | What it asserts |
|---|---|---|
| Atomic project activation | `mvp-activation.spec.ts` | Generation-guarded restore, loading boundary, no stale content from previous project. |
| Folder picker single-flight | `mvp-activation.spec.ts` | Concurrent picker clicks produce exactly one native dialog. |
| Visual snapshots at 960×640 | `mvp-visual-snapshots.spec.ts` | Shell, planning modal, chat, and command strip render correctly at minimum viewport. |
| Planning flow | `mvp-planning-flow.spec.ts` | Schematic wizard destination picker, category generation, ideas batch-select, Flow tab counts. |
| Dependency scheduling | `mvp-dependency-scheduling.spec.ts` | Dependency graph, collision detection, launch controls, safe serialization, merge queue. |
| Golden path | `mvp-golden-path.spec.ts` | Full journey: folder → schematic → categories → ideas → plans → flow board, no unhandled errors. |
| Restart/smoke | `mvp-restart-smoke.spec.ts` | Focus restore, no duplicate activation, no orphan warnings, 60s streaming, click-to-feedback budget. |
| UI invariants | `scripts/check-ui-invariants.mjs` | One stylesheet, 0px radius, tooltips on interactive elements, no inline styles. |

### Startup and compact-chat performance regressions

| Suite | What it asserts |
|---|---|
| Rust `connect_` storage tests | Fresh databases initialize and persist `user_version`; current databases bypass the full initializer; WAL/busy timeout remain configured. |
| Rust `latest_metric_is_scoped_to_the_requested_session` | Context usage reads the newest metric for the active session without leaking another session's totals. |
| `chat-composer.spec.ts` / `chat-context-strip.spec.ts` | Header owns model/effort/permission/run/context, footer has no duplicates, controls retain tooltips. |
| `streaming-indicators.spec.ts` / `chat-ux-polish.spec.ts` | Whole-composer orange focus treatment and latest-message resume behavior. |
| `mvp-restart-smoke.spec.ts` | Project/session restore remains single-activation and responsive after cache-first project discovery. |

At the 960×640 minimum viewport, capture the chat panel and verify: 28px
configuration header, no horizontal document overflow, compact composer, no
composer rail/context strip, and visible focus outline after textarea focus.

## Chat experience completion test suites

| Suite | What it asserts |
|---|---|
| `chat-markdown.spec.ts` | Markdown rendering: fences+copy, tables, lists, blockquotes, raw HTML inert, unterminated fence, user messages stay plain. |
| `message-actions.spec.ts` | Copy button visible/clickable, retry produces new turn with marker, edit-and-resend prefills composer. |
| `tool-card-depth.spec.ts` | Tool cards render structured diff + approval provenance, expansion toggles and persists, file path argument display. |
| `provider-credential-lifecycle.spec.ts` | Update-key flow in picker and settings, transport-unavailable state rendering, provider catalog model selection. |
| `schematic-wizard-native.spec.ts` | Agent writes schematic via write_file tool call, structured arguments, denial path status assertions. |
| `idea-grounding.spec.ts` | Generate-from-finished-plans disabled state + tooltip, idea batch header sections/counts, ideas tab rendering. |

### Mocked scripted-tool-call pattern

The schematic wizard e2e tests use a **mocked scripted-tool-call pattern**:
the e2e mock (`tauri-core.ts`) recognizes a trigger keyword in the chat
message (e.g. `schematic-wizard-test`) and returns a scripted set of tool
events with diffs, provenance, and arguments — without requiring a real
provider or agent loop. This pattern is used for any test that needs to
verify tool card rendering without a live model.
