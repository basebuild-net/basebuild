# Design: Startup Update Splash

## Context

Basebuild currently has an in-app updater path through `src/state/updater.ts`, `src/lib/updater.ts`, `UpdateButton`, and the Settings Updates tab. The current Tauri config builds NSIS updater artifacts only, with `windows.installMode` set to `basicUi`, so the update path is installer-oriented. The requested change adds a launch-time update gate plus portable/no-wizard updates while preserving the existing in-app controls.

## Goals / Non-Goals

**Goals**:
- Show current build version and update-check state at startup before the main app becomes interactive.
- Support optional updates, skipped versions, and mandatory updates controlled by release-channel policy.
- Hide skip and auto-start updating for unsupported client versions such as `0.0.3` when the minimum supported version is `0.1.2`.
- Publish portable Windows release artifacts and support a quick update flow that avoids the setup `.exe` wizard.
- Show download/apply progress and restart into the updated app.
- Keep existing Settings/Taskbar update UI as the post-startup/manual update surface.

**Non-Goals**:
- Removing the installed-app updater UI.
- Uploading local usage, project, prompt, terminal, or diagnostic data during update checks.
- Changing app-update install buttons away from the approved blue CTA exception.
- Supporting unsigned or unverified update payloads.
- Solving macOS/Linux update packaging in this change unless the release workflow already supports those targets.

## Decisions

### Decision: Treat startup updates as a shared updater state machine, not a separate updater implementation
**Rationale**: The splash, taskbar button, and Settings tab need the same metadata, diagnostics, policy, and install commands. A shared `UpdaterState` avoids split behavior where startup says mandatory but Settings says optional.  
**Alternatives**: Build splash-only update logic. Rejected because it would duplicate policy evaluation and invite mismatched prompts.

### Decision: Add release policy fields to signed update metadata
**Rationale**: Mandatory update behavior must be controlled by the release channel, not hardcoded in the client. The manifest or adjacent signed policy should include at least `minimumSupportedVersion`, optional per-target skip rules, and user-facing release summary fields.  
**Alternatives**: Hardcode minimum versions in the app. Rejected because unsupported-version policy must be changeable without shipping another old-client build.

### Decision: Store skipped optional versions locally and scope skips to the target version
**Rationale**: Users who skip `0.1.3` should not be nagged every startup for the same optional release, but they must be prompted again when `0.1.4` appears or when policy makes the update mandatory.  
**Alternatives**: A simple `skip all updates` preference. Rejected because it can strand users on unsupported builds.

### Decision: Use a trusted updater helper for Windows portable self-replacement
**Rationale**: A running Windows executable cannot reliably replace itself. A helper process can keep a small progress UI alive, wait for the old app to exit, verify the payload, atomically swap files, restart Basebuild, and preserve rollback state.  
**Alternatives**: Ask users to run the NSIS setup `.exe`. Rejected because the requested portable/instant flow explicitly avoids the installer wizard. In-process replacement is rejected because it is fragile on Windows.

### Decision: Prefer a portable update payload separate from the setup installer
**Rationale**: Portable clients need an artifact that can be verified and unpacked/replaced without running setup UI. Release validation should guarantee the portable payload and manifest agree with the app version.  
**Alternatives**: Point portable clients at the installer asset. Rejected because it reintroduces the setup wizard and does not preserve portable semantics.

### Decision: Keep the splash visually within the existing design contract
**Rationale**: The app requires one stylesheet, 0px radius, black/white/orange palette, and blue only for update install CTAs. The splash should reuse existing primitives where possible and add minimal global CSS only if necessary.  
**Alternatives**: Native OS dialog or separate themed installer UI for the whole flow. Rejected because it would fragment the product UI and likely bypass tooltip/design rules.

## Risks / Trade-offs

- **Tauri updater plugin may not directly support the desired portable payload shape** → Mitigation: keep plugin-backed checking/signature concepts, but add a Basebuild-specific helper/payload path if needed for portable replacement.
- **Old unsupported clients need policy fields they can understand** → Mitigation: introduce policy before enforcing a hard minimum where possible; define safe fallback behavior for clients that only understand basic Tauri metadata.
- **Mandatory updates can strand users if the release channel is down** → Mitigation: mandatory failure state must expose retry and safe exit; release validation must prevent bad mandatory manifests from publishing.
- **Self-replacement can corrupt installs if interrupted** → Mitigation: stage downloads, verify before swap, keep previous executable/app directory until the new launch succeeds, and cleanup after success.
- **Startup checks can slow perceived launch** → Mitigation: no-update and skipped-optional paths should resolve quickly; long downloads happen only after accepted or mandatory updates and show progress.

## Migration Plan

1. Extend update metadata parsing with policy fields and tests for optional, skipped, mandatory, and unsupported-version cases.
2. Add shared updater state/events for startup check, prompt state, progress, diagnostics, skip-version persistence, update start, helper handoff, restart, and failure.
3. Add startup splash UI that uses the shared state before rendering the main shell; preserve Settings and taskbar update flows.
4. Add portable release artifact generation and validation in the Windows release workflow.
5. Add the Windows updater helper/handoff path for portable/no-wizard apply, rollback, progress, cleanup, and relaunch.
6. Update docs for release policy, portable artifacts, startup splash behavior, privacy, and verification.

## Open Questions

- Should `Skip version` suppress only the startup splash prompt or also the taskbar availability badge for that exact target version?
- Should the mandatory-update policy live directly in `latest.json`, in a signed adjacent policy file, or in a Basebuild-hosted manifest generated by the release workflow?
- Should the portable release artifact be a single self-contained `.exe`, a signed `.zip` app directory, or both?
