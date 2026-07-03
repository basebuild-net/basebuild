# Proposal: Fix Native Chat Composer, Model Switching, and Harness Execution

## Why

A visual UX audit of the running dev build (maximized, project loaded, "Chat 1" tab active) found the native chat surface is effectively unusable for its stated purpose — "a native chat harness for any agent work":

1. **The composer is invisible/unreachable.** The chat panel renders only the metrics bar and the "Native chat ready" empty state at the top; the `.chat-input-area` (textarea, Send button, and the provider/model/effort selectors) is pushed below the clipped workspace region and cannot be scrolled to. Users literally cannot find the chat input box or the model selectors. This reproduces at every window size.
2. **Model/provider selection does nothing.** `native_chat_send` always returns a hard-coded `local_coordinator_response` string. Provider and model are stored and validated but never used to make a real call, so "switch models in chat" has no functional effect and no external provider is ever contacted.
3. **The default adapter is unavailable.** Runtime defaults ship with `defaultChatProfileId = basebuild-native`, but adapter health reports `basebuild-native was not found on PATH` and the Defaults dropdown shows "Basebuild Native (unavailable)". The app defaults users into a broken adapter.
4. **Provider login is API-key only.** The only way to connect OpenAI/Anthropic/Umans is pasting an API key into a form. The requested experience is web/OAuth-based login (like OhMyPI/OMP), which is not implemented.
5. **No in-chat idea generation.** Idea/plan generation lives in a separate modal and OMP; there is no way to brainstorm ideas from within the chat conversation and promote them to plans.

## What Changes

- Make the chat composer a **persistent footer that can never be clipped**, and move the provider/model/effort controls into an **always-visible composer header** with a discoverable empty-state CTA.
- Replace the stubbed `local_coordinator_response` with a **real provider execution layer** that routes each turn to the selected provider/model, streams assistant output, and records real metrics; keep a clearly-labeled offline "local coordinator" as an explicit fallback, not a silent one.
- Add **web/OAuth-style provider login** ("Connect with…") alongside API-key entry, persisted locally with explicit consent, matching the OMP connection pattern.
- **Stop defaulting to an unavailable adapter**: pick the best available adapter at startup, surface adapter health inline in the composer, and prompt setup instead of silently failing on send.
- Add **in-chat idea generation**: a command that turns the current conversation + project schematic into structured Ideas/Plans that can be promoted into the existing plan pipeline.

## Capabilities

### Modified Capabilities

- `native-chat-workspace` — persistent, non-clippable composer; always-visible model/provider/effort switcher; discoverable empty state; inline adapter-health/setup affordances.
- `native-agent-harness` — real provider-backed turn execution with per-turn model routing and streaming; offline coordinator becomes an explicit, labeled fallback.
- `agent-runtime-defaults` — never default to an unavailable adapter; graceful fallback and inline recovery.

### New Capabilities

- `provider-web-login` — connect to model providers via web/OAuth flow with local, consented credential persistence, in addition to API keys.
- `chat-idea-generation` — generate and promote ideas/plans from within a chat conversation.

## Impact

- `src/components/panels/ChatPanel.tsx`, `src/styles/globals.css` — composer layout fix, always-visible controls, empty-state CTA, connect buttons, idea-generation command.
- `src-tauri/src/services/native_chat_service.rs`, `src-tauri/src/commands/native_chat.rs` — real provider execution, streaming, per-turn routing, offline fallback labeling.
- `src-tauri/src/services/settings_service.rs`, `src/lib/settings.ts`, `src/components/layout/SettingsModal.tsx` — default-adapter selection and health-aware fallback.
- New provider-login service/commands + `src/lib/native-chat.ts` wrappers for the OAuth/web flow and credential persistence.
- `src/state/ideas.ts`, `src/state/plans.ts`, Ideas/Plans panels — promote chat-generated ideas into the plan pipeline.
- `DESIGN.md`, `docs/agents/*` — composer contract, provider execution, web-login, and idea-generation behavior.
