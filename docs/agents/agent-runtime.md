# Agent Runtime

Basebuild wraps terminal-based coding tools. The primary agent is OhMyPi (OMP).
The architecture supports future adapters (Basebuild CLI, other CLIs, IDEs)
without changing the chat UI contract.

## Runtime profiles

Agent and terminal integrations are modeled as **runtime profiles**, not
hardcoded UI branches. Profiles are persisted in SQLite and validated before
use.

- `RuntimeProfile` defines: `id`, `kind` (chat/terminal), `label`, `executable`,
  `args`, `workingDirectoryMode`, `defaultModel`, `capabilities`, `builtIn`.
- Built-in profiles: OMP (chat), Default Terminal (platform shell).
- The Basebuild CLI profile is a placeholder until its executable exists.

## Capabilities

`AgentCapability` enum: `chat`, `messages`, `skills`, `providers`, `commands`,
`info`. The chat UI degrades gracefully when an adapter does not support a
capability. Unsupported capabilities return a typed error, not a crash.

## Defaults

`RuntimeDefaults` (persisted in SQLite):
- `defaultChatProfileId` — which chat adapter to use (default: `omp`).
- `defaultTerminalProfileId` — which terminal to use (default: platform shell).
- `defaultModel` — model selection if the adapter supports it.
- `autoSendGeneratedPrompts` — whether to auto-send drafted prompts (default:
  `false`).

## Permissions

`PermissionRules` (persisted in SQLite, conservative by default):
- `allowCommandExecution`: ask / allow / deny.
- `allowExternalContext`: ask / allow / deny.
- `allowFileModification`: ask / allow / deny.
- `allowUsageAnalyticsCollection`: default `false`.
- `allowUsageAnalyticsUpload`: default `false`.
- `allowDetailedDiagnostics`: default `false`.

Permission checks happen before backend action, not only in UI. All permission
decisions are recorded in the audit trail.

## Privacy and analytics

**Analytics are disabled until explicit opt-in.** This is non-negotiable.

- Local collection and remote upload are separate permissions.
- Fresh install: collection off, upload off.
- No prompt text, chat content, source code, terminal output, secrets, or raw
  absolute paths in analytics events by default.
- Upload toggle is disabled/hidden unless a reviewed endpoint is configured.
- Users can inspect, export, and delete local analytics data.

## No silent side effects

Basebuild does not spawn side effects (commits, PRs, installs, file edits)
unless the user explicitly triggers them through the UI or an approved skill.
When in doubt, ask. The default stance is conservative.

## Respecting underlying tools

Never assume Basebuild owns a project. `git`, `omp`, and editors are the source
of truth; Basebuild persists only project-local metadata in `.basebuild/`.

## Hidden process spawning

Non-interactive helper commands (`omp --version`, `omp stats --json`, `git`,
`node --version`, profile validation) are spawned with `CREATE_NO_WINDOW` on
Windows via `crate::services::process_helpers::hidden_command`. This prevents
visible console windows from appearing when Basebuild (a windowed application
with no console) spawns console-subsystem child processes. PTY-backed terminal
and agent spawns use ConPTY, which already passes `CREATE_NO_WINDOW`.

The release binary is built with `windows_subsystem = "windows"` so the
packaged app does not allocate a console window on launch. Debug builds keep
the console visible for panic output and development logging.

## Update policy

The release channel can declare update policy fields in the signed
`latest.json` manifest. These fields control the startup splash behavior:

- `minimumSupportedVersion` (or `mandatoryBelow`) — If the running app's
  version is strictly below this value, the update is mandatory: the splash
  hides the skip button and auto-starts the update. Example: a manifest
  declaring `"minimumSupportedVersion": "0.1.2"` forces all versions below
  `0.1.2` to update mandatorily.
- `releaseSummary` — Short user-facing summary shown in the splash. Falls
  back to the standard `notes` field when absent.

Skip-version persistence: when the user skips an optional update for version
`X.Y.Z`, Basebuild stores that version locally and suppresses the startup
prompt for that exact target. A newer release clears the skip implicitly.
Mandatory updates always override any skip.

The no-wizard update flow uses NSIS `passive` install mode (shows only a
progress bar, no wizard dialogs). The Tauri updater plugin verifies the
downloaded payload signature before applying. Progress events are emitted
to the frontend via `updater://progress` events with step, downloaded bytes,
total bytes, and a message.
