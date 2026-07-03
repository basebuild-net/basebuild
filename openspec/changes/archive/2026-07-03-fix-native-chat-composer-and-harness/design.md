# Design: Fix Native Chat Composer, Model Switching, and Harness Execution

## Diagnosis (observed in the running dev build)

Observed by driving the maximized app with a project open and the auto-created "Chat 1" tab active:

- The chat panel shows the metrics bar (`0 req 0 tok TTFT TTLT`) and the centered "Native chat ready" empty state anchored at the **top** of the panel. The entire lower region is empty black space down to the status bar. Scrolling the panel does nothing. The `.chat-input-area` (rendered unconditionally in `ChatPanel.tsx`) is therefore laid out **below the clipped region** of `.workspace-scroll` (`overflow: hidden`) and is unreachable.
- Settings → Defaults shows **Default chat adapter = "Basebuild Native (unavailable)"**, adapter health **"basebuild-native was not found on PATH"**, default model `basebuild-local-coordinator`.
- Settings → Updates shows **"Updater manifest is missing required platform 'windows'"** (tracked separately; noted here for context, not fixed by this change).
- `native_chat_service.rs::send_message` calls `local_coordinator_response(...)` for every turn — a canned string. `validate_provider_model(.., allow_unconfigured = false)` rejects unconfigured providers, so non-local providers error and the local provider only ever echoes.

## Root cause: composer clipping

The height chain is `app-container(100vh) → app-shell(flex:1, grid) → workspace-panel(flex col, overflow:hidden) → workspace-scroll(flex:1, overflow:hidden, flex col) → chat-panel(flex:1) → [chat-messages(flex:1, overflow:auto), chat-input-area(flex-shrink:0)]`. In the running build the composer ends up beyond the clipped bottom edge, so the last flex-shrink:0 child is not visible and, because ancestors are `overflow:hidden`, cannot be scrolled into view.

Rather than chase one fragile flex declaration, the fix makes the composer **structurally un-clippable**:

- `.chat-panel` becomes an explicit `grid-template-rows: 1fr auto` (or `min-height: 0` flex column with `.chat-messages { min-height: 0; flex: 1 1 0 }`), guaranteeing the messages region absorbs all overflow and the composer row keeps its intrinsic height at the bottom.
- The composer (controls + textarea + send) renders inside a `flex-shrink: 0` footer that is a **sibling of the scroll region**, never inside it, so message volume can never push it out of view.
- Add a defensive `min-height` on the composer and a visible top border so it is unmistakably present even when empty.

## Root cause: model switching is a stub

`send_message` must route by provider:

- Introduce a `ProviderClient` trait with implementations: `LocalCoordinator` (current canned behavior, explicitly labeled "offline"), `OpenAiClient`, `AnthropicClient`, `UmansClient` (OpenAI-compatible base URL).
- `send_message` resolves the provider from the per-turn `provider_id`, loads the stored credential, and dispatches. Streaming chunks flow back over the existing `agent://output`-style event channel (or a new `native-chat://chunk` event) so the UI can append incrementally like the legacy path already does.
- Metrics (TTFT/TTLT/tokens) are captured from the real request instead of synthesized.
- When no credential exists for the chosen provider, the turn does not hard-fail: it returns a typed `SetupRequired` result the composer renders as an inline "Connect {provider}" prompt.

## Default-adapter selection

At settings load, compute adapter health first, then choose `defaultChatProfileId` as the first *available* adapter (prefer a working native/local coordinator, else OMP). Never persist a default that reports unavailable. The composer shows a small health dot + "Set up" affordance when the active adapter is degraded.

## Provider web login

Add a `provider-web-login` flow modeled on OMP's connection UX:

- `native_provider_login_start(provider_id)` opens the provider's auth URL in the system browser and starts a local loopback listener (or device-code poll) to capture the token.
- On success, persist via the existing `native_save_provider_credential` path (same local SQLite store), mark the provider `configured`, and refresh the catalog.
- API-key entry remains available as a manual fallback. No secret is ever placed in a URL or logged.

## In-chat idea generation

Add a composer command / button "Generate ideas" that sends the conversation + project schematic to the active provider with an ideation prompt, parses the structured result into Idea records (`src/state/ideas.ts`), and offers one-click "Promote to Plan" into the existing plan pipeline. Reuses `handleGenerateFromGoal` plumbing already in `AppShell.tsx`.

## Out of scope

- The updater manifest `windows` platform error (separate change).
- Multi-agent orchestration and tool-approval UX (owned by `native-agent-harness` umbrella change `native-harness-ide-chat`).
- Session-list clutter cleanup (date-only session titles) — recommended follow-up, tracked separately.
