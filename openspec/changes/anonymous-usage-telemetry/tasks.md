# Tasks: Anonymous Usage Telemetry

## 1. Backend (basebuild-dotnet, branch feat/anonymous-usage-ingest)

- [x] 1.1 Migration 0111 + schema.prisma: `User.anonymousComputerId TEXT` + unique index; `AppMessageUsage.accountHash TEXT`
- [x] 1.2 Anonymous gate in src/app/api/mcp/route.ts (whitelist, UUID validation, shadow-user resolve/create, rate limit, payload cap)
- [x] 1.3 handlers.ts: accept `clientKind` whitelist on sync_messages; optional `accountHash` on rows → AppMessageUsage column
- [x] 1.4 /explore/usage: render shadow-user rows as "Anonymous" (no profile identity)
- [x] 1.5 Privacy + TOS copy: anonymous device telemetry, computerId, opt-out — superseded by privacy-safe-usage-intelligence which replaced computerId with guest tokens and added full privacy policy section.
- [x] 1.6 Tests: anonymous gate accept/reject, rate limit, clientKind whitelist — superseded by privacy-safe-usage-intelligence guest ingestion tests (148 pass).

## 2. App core (basebuild-app, branch feat/anonymous-usage-sync)

- [x] 2.1 computerId: get-or-create UUID v4 in SettingsService (sqlite), expose `get_computer_id` Tauri command
- [x] 2.2 sync_service: anonymous post path (no Authorization, computerId arg); gates = consent + enabled + resolvable auth mode
- [x] 2.3 PermissionRules defaults → collection/upload true (`telemetry_default()`); `conservative()` kept for explicit reset
- [x] 2.4 Settings hardening: parse-failure → defaults; serde defaults on all UsageSyncSettings fields
- [x] 2.5 Managed triggers: never-synced / provider fingerprint / usage delta, 5-min evaluation in autosync loop
- [x] 2.6 Harness sources: ClaudeCodeSource, CodexSource, OpenCodeSource implementing UsageSource; funnel via sync_messages clientKind; checkpoints

## 3. App UI

- [x] 3.1 FirstRunModal: "Help improve Basebuild" consent question, checked by default; completion persisted via setAnalyticsConsent
- [x] 3.2 SettingsModal: sync section visible signed-out (UsageSyncPanel decoupled from sign-in; useUsageSync tracks signedIn internally for projected reads)
- [x] 3.3 Silent auto-update at startup (useUpdater auto-installs on available); UpdateButton reduced to disabled status indicator
- [x] 3.4 e2e mocks (src/test-support/tauri-core.ts) for `get_computer_id`; updater test updated for silent auto-update

## 4. Verification & polish

- [x] 4.1 cargo check + cargo test (src-tauri) — harness_usage_service 6 tests pass; cargo check clean (warnings only)
- [x] 4.2 npx tsc --noEmit + npm run build + npm run test:e2e — tsc clean, build clean, targeted e2e green (updater/settings/first-run/windows-startup)
- [x] 4.3 Backend: tsc/vitest in basebuild-dotnet — tsc clean, 38 tests pass
- [x] 4.4 Update docs (docs/agents) + CHANGELOG entries where tracked — agent-runtime.md updated with dual-path sync documentation in privacy-safe-usage-intelligence change.
