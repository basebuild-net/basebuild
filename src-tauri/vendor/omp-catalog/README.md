# OMP Catalog (vendored, with basebuild overlay)

This directory contains the bundled provider/model catalog: a vendored copy of
Oh My Pi's model catalog with basebuild.net's desktop catalog overlaid on top.
It is the source of truth for Basebuild's bundled provider/model list.

## Source

- **Upstream**: [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi)
  `packages/catalog/src/models.json` (default branch `main`)
- **License**: MIT (see `LICENSE.md`) — Copyright (c) 2025 Mario Zechner,
  Copyright (c) 2025-2026 Can Bölük

## Structure

`models.json` is a map of provider id → (model id → model entry). Each entry
has: `id`, `name`, `api` (wire-protocol kind), `provider`, `baseUrl`,
`reasoning`, `input` (modalities), `cost`, `contextWindow`, `maxTokens`.

## Updating

```bash
node scripts/update-omp-catalog.mjs
```

Re-pulls the upstream OMP catalog, overlays `GET basebuild.net/api/catalog/desktop`
(additive only — models missing from OMP whose provider has a known wire kind
and base URL), writes a deterministic tab-indented serialization, and stamps a
content-hash version used by the cache-invalidation logic in
`provider_model_catalog_service.rs`. The GitHub Action
`.github/workflows/update-model-catalog.yml` runs this on every push to `main`
and daily, committing the diff — so new model launches (e.g. a fresh Kimi
release) land without a manual step. Review diffs before hand-committing;
upstream adds/removes models frequently.
