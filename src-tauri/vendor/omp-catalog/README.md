# OMP Catalog (vendored)

This directory contains a vendored copy of Oh My Pi's model catalog. It is the
source of truth for Basebuild's bundled provider/model list.

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

Re-pulls the upstream catalog, writes `models.json`, and stamps a content-hash
version used by the cache-invalidation logic in
`provider_model_catalog_service.rs`. Review the diff before committing —
upstream adds/removes models frequently.
