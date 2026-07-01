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
