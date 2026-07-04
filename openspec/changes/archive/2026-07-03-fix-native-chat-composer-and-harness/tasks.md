# Tasks

## 1. Fix composer visibility (highest priority)
- [x] 1.1 Restructure `.chat-panel` so the message list and composer are separate rows (`grid-template-rows: 1fr auto` or a bounded flex column with `.chat-messages { flex: 1 1 0; min-height: 0 }`).
- [x] 1.2 Render the composer (controls + textarea + send) as a `flex-shrink: 0` footer that is a sibling of the scroll region, never inside `overflow:hidden` content that can clip it.
- [x] 1.3 Add a defensive `min-height` and visible top border to the composer so it is unmistakably present when empty.
- [x] 1.4 Verify at multiple window sizes (small restored window and maximized) that the input and all three selectors are visible and clickable.

## 2. Always-visible model/provider controls + empty state
- [x] 2.1 Move provider/model/effort selectors into a persistent composer header that shows even before the catalog fully loads (skeleton while loading).
- [x] 2.2 Update the empty state to name the active provider/model and point at the input + connect action.
- [x] 2.3 Add an inline adapter-health dot + "Set up"/"Connect" affordance in the composer when the active adapter is degraded.

## 3. Real provider execution (replace stub)
- [x] 3.1 Introduce a `ProviderClient` trait with `LocalCoordinator`, `OpenAiClient`, `AnthropicClient`, `UmansClient` (OpenAI-compatible) implementations.
- [x] 3.2 Rewrite `native_chat_service::send_message` to resolve the per-turn provider/model, load the stored credential, and dispatch to the matching client.
- [x] 3.3 Stream assistant chunks back to the UI via an event channel and append incrementally.
- [x] 3.4 Capture real TTFT/TTLT/token metrics from the request instead of synthesizing them.
- [x] 3.5 Return a typed `SetupRequired` result (not an error) when the chosen provider has no credential; render it as an inline connect prompt without dropping the draft.
- [x] 3.6 Label local-coordinator turns explicitly as offline; never present them as provider answers.

## 4. Health-aware default adapter
- [x] 4.1 Compute adapter health before selecting `defaultChatProfileId`; choose the first available adapter.
- [x] 4.2 Never persist/activate an unavailable adapter; show a warning + setup guidance if the user picks one manually.
- [x] 4.3 If no adapter is available, route the composer to a setup path.

## 5. Provider web login
- [x] 5.1 Add `native_provider_login_start(provider_id)` that opens the auth URL in the system browser and captures the token via loopback/device-code.
- [x] 5.2 Persist the captured token through the existing local credential store; refresh the catalog on success.
- [x] 5.3 Add "Connect with {provider}" buttons in the composer and Settings → Account, keeping manual API-key entry as fallback.
- [x] 5.4 Add disconnect; ensure no secret is logged or placed in a URL.

## 6. In-chat idea generation
- [x] 6.1 Add a "Generate ideas" composer action that sends conversation + schematic to the active provider with an ideation prompt.
- [x] 6.2 Parse the structured result into Idea records via `src/state/ideas.ts`.
- [x] 6.3 Add "Promote to Plan" wiring into the existing plan pipeline, linked to the originating session.
- [x] 6.4 Prompt to connect a provider when none is configured instead of producing empty ideas.

## 7. Verification
- [x] 7.1 Manually drive the app (built + `dev.bat`): open a chat, confirm composer + selectors visible, connect a provider, switch models mid-conversation, confirm real responses and metrics.
- [x] 7.2 Confirm defaults no longer land on "Basebuild Native (unavailable)".
- [x] 7.3 Generate ideas from a chat and promote one to a plan.
