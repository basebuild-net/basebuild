# Basebuild Desktop Development Notes

## Stack

- Frontend: React + TypeScript + Vite
- Backend: Rust + Tauri v2
- Terminal: portable-pty + xterm.js
- State: local SQLite (via rusqlite)

## Quick start

```bash
# Install frontend dependencies
npm install

# Run the dev server and Tauri (requires Rust + Visual Studio C++ tools)
dev.bat                 # Windows helper; detects port 1420 conflicts and keeps errors visible
npm run tauri dev       # Direct command

```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite frontend only on port 1420 |
| `npm run tauri dev` | Tauri dev mode |
| `dev.bat` | Windows launcher that checks port 1420, can stop stale listeners, and pauses on errors |
| `npm run build` | Production frontend build |
| `npm run tauri build -- --bundles <targets>` | Build native packages for the current host OS |

## Architecture

```
src/
  components/
    layout/          # Shell: AppShell, ProjectSidebar, SidePanel, ToolTabs, WorkspaceTabs, PlanPanel
    panels/          # Feature panels: TerminalPanel, ChatPanel, SourcePanel, FilesPanel, FileViewer, DebugPanel, ProjectSchematicTab
  lib/               # Thin Tauri invoke wrappers — one file per backend domain
  state/             # React state hooks
  styles/
    globals.css      # The only stylesheet

src-tauri/
  src/
    commands/        # Tauri command handlers — one file per domain
    services/        # Business logic — one file per domain
    models/          # Serializable data types
    app_state.rs     # Tauri managed state
    lib.rs           # Tauri builder + command registration
```

- `src/components/layout/*` - shell components (sidebar, workspace, tool tabs, plan panel).
- `src/components/panels/*` - feature panels (Terminal, Source, Debug).
- `src/lib/*` - thin Tauri invoke helpers for each backend service.
- `src/state/*` - React state hooks.
- `src-tauri/src/commands/*` - Tauri command surface.
- `src-tauri/src/services/*` - business logic and external CLI integration.
- `src-tauri/src/models/*` - serializable data types.
- `src-tauri/src/services/settings_service.rs` - runtime profiles, defaults, permissions, audit trail.
- `src-tauri/src/services/analytics_service.rs` - opt-in usage analytics (disabled by default).

## Requirements

The app detects Git and OMP CLI. If Git is missing, the UI provides a copyable `winget` command and a download link.
Runtime profiles (OMP, terminal, future Basebuild CLI) are seeded on first launch and persisted in SQLite. Defaults and permissions are conservative: analytics off, auto-send off, ask before sensitive actions.

### Port 1420 conflicts

Tauri dev mode runs Vite on port 1420. If that port is already in use,
`dev.bat` detects the listener before startup, shows the owning PID/process,
and asks whether to stop it before continuing. It also pauses after failures so
the red error remains visible for copying.

## Known environment constraints

### Windows build tools

Building the Tauri backend on Windows requires the **MSVC C++ build tools** (part of Visual Studio Build Tools). If `cargo check` fails with `link.exe` errors, install the workload:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

### Tauri updater signing

Before publishing updates, replace `PLACEHOLDER_PUBLIC_KEY` in `src-tauri/tauri.conf.json` with the public key from `npx @tauri-apps/cli signer generate`.

See `docs/SECRETS.md` for the full secrets checklist.
## Privacy and analytics

Basebuild is local-first. Usage analytics collection and upload are disabled by default and require explicit opt-in. See `docs/agents/agent-runtime.md` for the full privacy model. No analytics events store prompt text, chat content, source code, terminal output, secrets, or raw absolute paths. If a remote upload endpoint is ever added, it MUST be documented here and in `docs/SECRETS.md` before the upload code path is enabled.

## Releases

Releases are manual, draft-first, and single-source. The `workflow_dispatch`
version input to [`.github/workflows/ci-release.yml`](../.github/workflows/ci-release.yml)
is authoritative. Every matrix runner bumps `package.json`, `package-lock.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and
`src-tauri/Cargo.lock` to that version in its temporary checkout. Repository
files remain at the `0.0.0` development sentinel; do not create a version-bump
commit.

1. Confirm `bundle.createUpdaterArtifacts` is `true` and the Tauri updater
   signing secrets are configured.
2. In GitHub Actions, dispatch **CI / Release** with an unpublished semantic
   version such as `0.0.7`.
3. After frontend, Rust, and e2e checks pass, the serial release matrix builds
   Windows x64, Linux x64, then universal macOS. Serial execution prevents
   concurrent `latest.json` updates from dropping a platform.
4. The final `verify-release` job requires every public artifact, at least one
   updater signature per OS, and `windows-x86_64`, `linux-x86_64`,
   `darwin-aarch64`, and `darwin-x86_64` manifest entries.
5. Review generated notes and assets in the GitHub draft. Publish only after
   the verifier passes. Then check the
   [`latest.json`](https://github.com/basebuild-net/basebuild/releases/latest/download/latest.json)
   endpoint and one platform install command from the README.

Never re-release a published version. If a release is broken, ship the next
version. Never hand-build or manually upload a public artifact.

### Release build integrity guards

A released binary MUST serve the frontend embedded in the executable, not from
the dev server. A `tauri dev` build navigates the webview to `devUrl`
(`http://127.0.0.1:1420`); launched without Vite it shows
`ERR_CONNECTION_REFUSED`. Production `tauri build` embeds `frontendDist`.

- **`npm run check:release-config`** runs on every PR and release. It requires
  a local `frontendDist`, loopback-only `devUrl`, a frontend build hook, and a
  built `dist/index.html`.
- **Windows packaged-app probe** runs after the Windows matrix build. It boots
  the release executable and fails if its webview connects to port 1420.
- Linux and macOS use the same checked Tauri build configuration. The final
  release job additionally rejects missing native artifacts or updater entries.

### Stable release artifacts

Asset names intentionally omit the version. GitHub scopes assets to one
release, so `/releases/latest/download/<asset>` remains an evergreen URL while
the binary's embedded version and `latest.json` retain the real release
version.

| Platform | Asset | Purpose |
|---|---|---|
| Windows x64 | `Basebuild-windows-x86_64-setup.exe` | Current-user NSIS installer; preferred |
| Windows x64 | `Basebuild-windows-x86_64-portable.zip` | Portable `Basebuild.exe` |
| Linux x64 | `Basebuild-linux-x86_64.AppImage` | Distribution-neutral portable app |
| Debian/Ubuntu x64 | `Basebuild-linux-x86_64.deb` | Native package and desktop-menu integration |
| macOS Intel + Apple Silicon | `Basebuild-macos-universal.dmg` | Universal disk image |
| All | `latest.json` and `.sig` files | Signed Tauri updater metadata and verification signatures |

Packaging uses Tauri's native installer templates and the existing transparent
Basebuild application logo. Do not add backgrounds, recolor the logo, or fork
upstream templates; doing so changes the product identity and takes ownership
of native accessibility, localization, and installer behavior.

macOS currently uses Tauri's ad-hoc signing identity (`-`). This prevents the
Apple Silicon “damaged” failure but does not provide Developer ID notarization;
users may still need **Open** or **Control-click → Open**. Configure the Apple
secrets in `docs/SECRETS.md` before claiming a notarized release.

### Update policy fields

The `latest.json` manifest supports optional policy fields:

- `minimumSupportedVersion` (or `mandatoryBelow`) — If the running app's
  version is strictly below this value, the startup splash hides the skip
  button and auto-starts the update. Example: setting `minimumSupportedVersion`
  to `"0.1.2"` forces all versions below `0.1.2` to update mandatorily.
- `releaseSummary` — Short user-facing summary shown in the splash. Falls
  back to the standard `notes` field when absent.

### Startup update splash

On launch, Basebuild shows a startup splash that checks for updates before
the main shell becomes interactive. The splash has these states:

- **Checking** — Shows current version and update-check progress.
- **Optional update** — Shows target version, summary, and `Upgrade` /
  `Skip update for now` buttons. The skip is version-scoped: the user is
  not prompted again for the same target version, but will be prompted for
  a newer release.
- **Mandatory update** — Hides the skip button and auto-starts the update
  when the running version is below `minimumSupportedVersion`.
- **Progress** — Shows download/install progress bar and step text.
- **Error** — Shows actionable diagnostics with retry and "Continue anyway".

The existing in-app update UI (taskbar button + Settings → Updates tab)
remains functional after startup for manual checks and installs.

Never re-release a published version. If a release is broken, ship a hotfix as
the next version (e.g. `0.0.7` after a broken `0.0.6`). The full release policy
is the [Releases](#releases) section above.

## Feature backlog pointer

Planned and in-progress OpenSpec work lives in each developer's local,
gitignored `openspec/` workspace; see
[`docs/agents/openspec.md`](./agents/openspec.md). Repository changes must
remain understandable without access to those local planning files.
