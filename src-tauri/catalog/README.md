# Model catalog (first-party)

This directory holds Basebuild's own model catalog — the source of truth for the
bundled provider/model list. `models.json` is embedded at compile time via
`include_str!` in `src-tauri/src/models/model_catalog.rs`.

## Sourcing

- **Offline default**: the `models.json` shipped here is what the app uses with
  no network access.
- **Runtime sync**: much of the catalog is kept current by auto-syncing from
  `basebuild.net` at runtime (see `services/catalog_sync_service.rs`); the
  synced data supersedes the bundled rows when available.
- **OhMyPi sourcing**: OhMyPi's model catalog is the baseline (providers,
  models, wire kinds, base URLs, costs); the basebuild.net desktop catalog is
  additively overlaid on top.

## Attribution

Portions of the seed data were originally derived from OhMyPi's model catalog,
distributed under the MIT License (see `LICENSE.md`) — Copyright (c) 2025 Mario
Zechner, Copyright (c) 2025-2026 Can Bölük. Basebuild curates and extends this
data as first-party content.

## Structure

`models.json` is a map of provider id → (model id → model entry). Each entry
has: `id`, `name`, `api` (wire-protocol kind), `provider`, `baseUrl`,
`reasoning`, `input` (modalities), `cost`, `contextWindow`, `maxTokens`.

`VERSION` is a content-hash stamp of `models.json`, consumed by the
cache-invalidation logic in `services/provider_model_catalog_service.rs` to
detect and self-heal stale bundled rows.
