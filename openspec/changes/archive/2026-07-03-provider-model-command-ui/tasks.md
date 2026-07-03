# Tasks: Provider Model Catalog, Login Commands, and Compact Chat Controls

## 1. Catalog foundation

- [x] 1.1 Add provider/model catalog data shapes to `src/lib/native-chat.ts` and matching Rust models.
- [x] 1.2 Add `provider_model_catalog_service.rs` with cache-first catalog load, freshness metadata, and stale-cache behavior.
- [x] 1.3 Add `native_provider_catalog_refresh(provider_id?: string, force?: boolean)` command and thin frontend wrapper.
- [x] 1.4 Persist non-secret provider metadata: configured state, source, last synced timestamp, model count, and last sync error.

## 2. Provider discovery and sync

- [x] 2.1 Implement direct discovery for built-in local and OpenAI-compatible providers using `/v1/models` where available.
- [x] 2.2 Add provider-specific normalizers for labels, context windows, reasoning efforts, image support, and source metadata.
- [x] 2.3 Refresh a provider's catalog after successful web login, manual API-key save, and disconnect.
- [x] 2.4 Add manual refresh with force-online semantics and non-destructive failure handling.
- [x] 2.5 Add hosted Basebuild model-directory fallback only for providers with no direct provider/CLI model-list payload.

## 3. Compact composer UI

- [x] 3.1 Refactor `ChatPanel.tsx` composer header into a one-line provider/model/effort rail with primary controls always visible.
- [x] 3.2 Update `src/styles/globals.css` so the rail uses nowrap, truncation, compact widths, icon-only constrained buttons, and overflow menu behavior.
- [x] 3.3 Move lower-priority actions such as Generate ideas into overflow before controls wrap.
- [x] 3.4 Ensure every interactive control and overflow item has a `title` tooltip and 0px radius styling.

## 4. Provider and model pickers

- [x] 4.1 Add a compact provider connection picker reachable from the rail and `/login`.
- [x] 4.2 Add a searchable model picker reachable from the rail and `/model`, showing provider, model id, label, effort support, and freshness/source state.
- [x] 4.3 Keep model selection next to effort level for pointer users; slash commands are accelerators only.
- [x] 4.4 Preserve current draft text when a picker opens, provider login starts, or setup-required state appears.

## 5. Slash commands

- [x] 5.1 Add composer-local slash parsing before `nativeChatSend`.
- [x] 5.2 Implement `/login`, `/login <provider>`, `/model`, `/model <filter>`, and `/models refresh`.
- [x] 5.3 Show unknown slash command help locally with an explicit “send as text” escape.
- [x] 5.4 Add keyboard navigation and escape/enter behavior for command menus and pickers.

## 6. Optional hosted fallback API

- [x] 6.1 Inspect `C:/Users/user/Documents/repos/basebuild-dotnet` provider/catalog schema and confirm `src/app/api/catalog/providers/route.ts` already exposes public provider/model metadata.
- [x] 6.2 Wire the Desktop hosted fallback parser to the existing `basebuild-dotnet` catalog shape when `BASEBUILD_MODEL_DIRECTORY_URL` is configured.
- [x] 6.3 Ensure Basebuild Desktop sends only provider id/version/fallback query data, never secrets, prompts, project paths, or local account identifiers.

## 7. Documentation and verification

- [x] 7.1 Update `DESIGN.md`, `docs/agents/agent-runtime.md`, and `docs/agents/desktop-shell.md` for the compact rail, slash commands, and model sync behavior.
- [x] 7.2 Run typecheck/build for changed frontend/backend code.
- [x] 7.3 Visually verify the running Tauri app with a screenshot: controls fit on one line, narrow width overflows predictably, `/login` opens provider UI, `/model` opens model picker, and refresh preserves cached models on failure.
