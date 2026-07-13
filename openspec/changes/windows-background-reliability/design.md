# Design: Windows Background Reliability

## Context

Basebuild already creates a tray icon, hides the main window on close, reactivates a hidden instance through the single-instance plugin, checks for updates immediately and every five minutes, and starts a Rust account-sync loop during Tauri setup. The existing sync loop is consent-gated and hourly, but its transport and collection contract are centered on `omp stats --json` and `omp usage --json`. Basebuild Native separately records a privacy-filtered request metrics ledger that is not included in account sync.

The missing desktop lifecycle capability is Windows launch at sign-in. The first-run flow currently persists runtime defaults and local analytics consent but has no OS-startup step. The main window is created as a normal foreground window, so simply registering the executable would show it at every sign-in. Any implementation must preserve explicit foreground launch, close-to-tray, single-instance activation, the startup update gate, and the non-negotiable opt-in boundary for remote usage uploads.

## Goals / Non-Goals

**Goals**:

- Add a reliable, user-controlled Windows launch-at-sign-in path.
- Default the first-run launch-at-sign-in choice to selected while applying the OS registration only after the user finishes setup.
- Keep autostart launches hidden in the tray and explicit launches visible.
- Continue signed update checks on foreground and background startup without focus stealing.
- Sync privacy-filtered OMP and Basebuild Native usage hourly while the app remains alive in the background.
- Make lifecycle registration and usage scheduling idempotent, observable, single-flight, and recoverable after restart, resume, network loss, or upgrade.

**Non-Goals**:

- Enabling remote analytics collection or upload without explicit consent.
- Inspecting arbitrary processes, terminal content, prompts, source files, or network traffic to infer usage.
- Starting OMP, a terminal, or an agent merely because Basebuild starts with Windows.
- Automatically enabling launch at sign-in for existing users who have never chosen it.
- Replacing the signed Tauri updater or changing its release endpoint.
- Treating foreground manual launches as minimized launches.
- Adding a generic background job framework unrelated to startup, update, or usage synchronization.

## Decisions

### Decision: Use the official Tauri v2 autostart plugin behind a startup service

**Rationale**: The official plugin owns Windows registration details and exposes enable, disable, and effective-state checks. A dedicated Rust `startup_service` will own persisted intent, plugin calls, reconciliation, and status mapping; Tauri commands will validate requests and delegate to it. This follows the one-service-per-domain rule and avoids handwritten registry or Startup-folder manipulation.

**Alternatives**: Write directly to `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run` or create shortcuts manually. Rejected because installer paths, quoting, upgrades, and cleanup become application-owned and error-prone.

### Decision: Distinguish autostart with a dedicated background argument

**Rationale**: The Windows registration will launch the current executable with a stable `--background` argument. Startup classification is therefore explicit and testable; it does not guess from elapsed time, parent process, or whether launch at sign-in happens to be enabled. Manual launches remain foreground launches. The single-instance callback treats an explicit second invocation as user intent and shows/focuses the existing window.

**Alternatives**: Minimize every launch when the setting is enabled. Rejected because Start menu and Explorer launches would appear broken. Infer Windows sign-in from process ancestry. Rejected as brittle and difficult to test.

### Decision: Create the main window hidden, then reveal only foreground startup

**Rationale**: Hiding a normally visible window after setup can flash on screen. The packaged main window should begin hidden; after the frontend has initialized the startup/update surface, a small validated lifecycle command reveals it only for foreground mode. Background mode initializes the same webview and services without showing or focusing it. Tray Show and explicit second-instance activation remain authoritative reveal paths.

**Alternatives**: Start visible and immediately call `hide()`. Rejected because it can flash during Windows sign-in. Avoid creating the webview for background mode. Rejected for this change because updater and existing UI-owned lifecycle hooks currently initialize there; a headless split would substantially broaden architecture and regression risk.

### Decision: Separate persisted intent from effective OS registration

**Rationale**: Settings must not claim launch-at-sign-in works merely because a Boolean was saved. `AppLifecycleSettings` will store user intent and schema version. `StartupRegistrationStatus` will report desired state, effective state, support, last reconciliation result, and a privacy-safe error class. Enable/disable commands update the OS registration first, verify effective state, then persist the accepted intent. Startup reconciliation repairs missing or obsolete enabled registrations and removes stale disabled registrations idempotently.

**Alternatives**: Trust only plugin state and store no intent. Rejected because upgrades and stale registrations cannot be reconciled against a user choice. Persist first and reconcile later. Rejected because Settings could report a false success after an OS failure.

### Decision: Make first-run default-on explicit, not silent

**Rationale**: The setup step presents a checked launch-at-sign-in control, explains minimized tray behavior, and applies it only when Finish is chosen. Skip, close, or Escape does not create OS state. Existing users keep their current effective behavior until they choose the setting. Remote usage sync remains a separate unchecked consent path and is never implied by autostart.

**Alternatives**: Register immediately on first process launch. Rejected because that is a silent OS side effect. Enable autostart for every existing user through migration. Rejected because no user choice exists.

### Decision: Preserve the updater contract and make launch mode presentation-aware

**Rationale**: `useUpdater` already performs an immediate signed check and periodic checks. The updater state machine should continue to run in the hidden webview. Foreground mode presents the existing splash; background mode suppresses the splash/window reveal while retaining the same availability, mandatory policy, progress, and diagnostics state for later Settings/tray presentation. Update checks never weaken signature or release-channel validation.

**Alternatives**: Skip updates during autostart. Rejected because long-lived tray instances could remain stale. Automatically apply every optional update while hidden. Rejected because it changes the existing explicit optional-update policy and could restart active work.

### Decision: Normalize registered usage sources before transport

**Rationale**: Introduce a typed `UsageSource` boundary that yields versioned, privacy-filtered `UsageRecord` batches plus source checkpoints. Initial adapters read OMP's documented stats/usage output and Basebuild Native's metrics ledger. A versioned account-sync envelope groups records by source and carries stable deduplication identifiers. It excludes free-form content by construction and runs a final allowlist validator before transport.

**Alternatives**: Upload the native metrics database or serialize internal structs directly. Rejected because schema drift and accidental content fields would expand the privacy boundary. Convert native rows into fake OMP JSON. Rejected because source identity and semantics would be misleading.

### Decision: Use an extend-only server rollout with OMP compatibility

**Rationale**: Native rows require basebuild.net to accept a versioned multi-source envelope. The client will negotiate or call an extend-only server tool/version and will not advance native checkpoints until that version is acknowledged. During rollout, the existing OMP-compatible path remains available so current sync does not regress. Unsupported server versions produce a compact status rather than dropping native data or retrying continuously.

**Alternatives**: Replace `sync_raw_usage` in place with an incompatible body. Rejected because older clients and the current server contract may break. Mark native rows synced after a rejected request. Rejected because usage would be silently lost.

### Decision: Keep scheduling in Rust and persist scheduler/checkpoint state

**Rationale**: The Rust loop already starts during Tauri setup and remains alive while the window is hidden. Extend it with a single-flight coordinator, persisted next-due/last-success/backoff state, per-source checkpoints, and one coalesced pending re-check. Window hide, focus loss, resume, shutdown, and offline-to-online events become triggers into the same coordinator, not separate upload paths. Transient failures use bounded exponential backoff with jitter; restart restores the schedule rather than resetting it.

**Alternatives**: Add a React `setInterval`. Rejected because hidden webviews can be throttled and renderer lifecycle should not own account correctness. Start one task per trigger. Rejected because overlapping uploads and checkpoint races become possible.

### Decision: Isolate source failures and checkpoint only acknowledgements

**Rationale**: OMP may be absent or its ledger temporarily unavailable while native metrics remain valid. Each source returns independent diagnostics and checkpoints. The coordinator uploads available batches, advances a source checkpoint only after server acknowledgement for that source, and keeps failed/rejected batches pending. Stable deduplication keys make retries safe.

**Alternatives**: Fail the entire collection when any source fails. Rejected because an optional external integration would block native usage. Advance all checkpoints after any HTTP success. Rejected because partial rejection would lose data.

## Risks / Trade-offs

- **A hidden initial window can regress foreground startup or E2E assumptions** → Mitigation: make launch mode explicit, add mocked foreground/background tests, preserve tray/second-instance reveal paths, and perform a packaged Windows flash/focus smoke test.
- **Official autostart plugin behavior may differ across installer paths or upgrades** → Mitigation: read back effective state, reconcile idempotently, test paths containing spaces, and verify an installed NSIS build rather than only `tauri dev`.
- **Mandatory update behavior while hidden can be hard to communicate** → Mitigation: preserve signed policy, expose tray-visible progress/failure state, never reveal an unsupported shell merely to show the splash, and test recoverable failure.
- **Multi-source payload changes require basebuild.net support** → Mitigation: version the envelope, deploy an extend-only server contract first or feature-detect it, retain OMP compatibility, and do not checkpoint unacknowledged native rows.
- **Usage deduplication errors could double-count or lose rows** → Mitigation: derive stable source-scoped IDs, persist checkpoints transactionally, test retry/restart/partial-ack cases, and have the server enforce idempotency.
- **Syncing external OMP activity expands the observed time window** → Mitigation: read only documented usage ledgers, retain explicit upload consent, display source coverage and last-sync status, and never attach to or control the OMP process.
- **Shutdown hooks have limited time** → Mitigation: bound best-effort exit work, preserve unsynced rows, and rely on the next startup/resume catch-up instead of blocking exit indefinitely.

## Migration Plan

1. Add the official autostart dependency and capabilities, lifecycle models/service/commands, and startup-mode parsing without enabling registration for existing users.
2. Add hidden-window startup handling and verify foreground, background, tray Show, and second-instance behavior in development and an installed Windows build.
3. Add first-run and Settings controls; default the first-run selection on, apply only on completion, and reconcile effective registration state.
4. Extend the basebuild.net MCP contract with an idempotent versioned multi-source usage envelope or capability signal while retaining the existing OMP payload.
5. Add source adapters and payload allowlist validation; migrate scheduler persistence/checkpoints without changing current consent gates.
6. Enable native usage batches only after the server contract is available; retain pending native rows and compatible OMP sync otherwise.
7. Verify updater behavior, hourly/background cadence, restart/backoff, resume/reconnect, partial-source failure, authorization failure, and privacy payload boundaries.

Rollback is safe by disabling the launch-at-sign-in setting, unregistering the autostart entry, and disabling the multi-source server capability. Existing OMP sync remains compatible; unacknowledged native checkpoints are retained locally rather than discarded.

## Open Questions

- Which basebuild.net MCP tool/version will acknowledge per-source batches and stable deduplication IDs? This must be settled before native checkpoints can advance in production.
- Does the official Tauri autostart plugin rewrite an existing Windows entry when the installed executable path changes, or must `startup_service` explicitly disable/re-enable during reconciliation? Confirm against the pinned plugin version and an upgraded NSIS install.
- Which tray affordance should represent optional update availability and mandatory-update failure without introducing a second notification system? Reuse the existing update state and notification primitives where possible.
