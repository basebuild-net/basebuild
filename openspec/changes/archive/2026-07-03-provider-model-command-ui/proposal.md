# Proposal: Provider Model Catalog, Login Commands, and Compact Chat Controls

## Why

The native chat surface can send real provider-backed turns, but provider connection and model selection still feel hidden and heavy. A screenshot pass also shows the composer header has too many peer controls for the available width: provider, model, effort, health, connect/disconnect, and idea actions can wrap above the textarea, making the chat feel crowded instead of compact and approachable.

## What Changes

- Replace the wrapping composer header with a compact single-line control rail: provider status, model selector, effort selector, connect/disconnect, refresh, and secondary actions stay on one line with truncation/overflow rules.
- Add provider/model management that supports multiple connected providers, locally stores provider metadata and credentials, and exposes connection state consistently to chat, Settings, and slash commands.
- Add automatic model catalog sync after startup, provider login, disconnect, and manual refresh; prefer direct provider/CLI payloads when available and fall back to a Basebuild-hosted model directory only when a provider has no dedicated model-list API.
- Add slash commands in the chat composer: `/login` opens the provider connection UI, `/model` opens the model picker, and `/models refresh` forces catalog sync without sending slash text to the provider.
- Keep the UI usable without slash commands: the model list remains next to effort level, and `/` is a keyboard shortcut for the same provider/model flows.

## Capabilities

### New Capabilities

- `chat-composer-controls` — compact one-line provider/model/effort controls with accessible overflow behavior.
- `provider-model-catalog` — provider login state, provider metadata storage, and automatic model discovery/sync.
- `chat-slash-commands` — in-composer `/login`, `/model`, and model-catalog command handling.

### Modified Capabilities

- None.

## Impact

- `src/components/panels/ChatPanel.tsx`, `src/styles/globals.css` — compact composer header, command parsing, command menu/pickers, model refresh affordances.
- `src/lib/native-chat.ts`, `src-tauri/src/commands/native_chat.rs`, `src-tauri/src/services/native_chat_service.rs` — typed provider/model catalog refresh commands and connection state returned to the frontend.
- `src-tauri/src/services/provider_login_service.rs`, credential storage service/model files — multi-provider credential metadata, login/disconnect refresh hooks, local-only storage guarantees.
- `src-tauri/src/services/provider_model_catalog_service.rs` (new) — provider model discovery, cache freshness, direct provider/CLI discovery, Basebuild hosted fallback.
- `C:/Users/user/Documents/repos/basebuild-dotnet` — optional hosted model-directory endpoint only if direct provider/CLI discovery cannot provide a supported-model payload for a provider.
- `DESIGN.md`, `docs/agents/agent-runtime.md`, `docs/agents/desktop-shell.md` — update behavior and visual contracts when implementation lands.
