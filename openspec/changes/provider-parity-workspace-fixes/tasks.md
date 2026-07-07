# Tasks: Provider Parity & Workspace Fixes

## 1. Catalog Data Foundation

- [x] 1.1 Vendor OMP catalog: add `src-tauri/vendor/omp-catalog/models.json`
      (from `can1357/oh-my-pi` `packages/catalog/src/models.json`),
      `LICENSE.md` (MIT attribution), `README.md` (source, update procedure),
      and `scripts/update-omp-catalog.mjs` (re-pull + content-hash version
      stamp).
- [x] 1.2 Rust loader: `include_str!` embed + serde types + `LazyLock` parse in
      `provider_model_catalog_service.rs` (or a new `omp_catalog` module);
      expose catalog version stamp.
- [x] 1.3 Extend `NativeModel` (`models/native_chat.rs`) with `api_kind`,
      `base_url`, `cost_input`/`cost_output` (optional); persist through the
      model cache table (additive columns incl. bundled version stamp); mirror
      in `src/lib/native-chat.ts` types.
- [x] 1.4 Replace hardcoded `bundled_models()` with a view over the vendored
      data (label/effort mapping from `reasoning`, image support from `input`);
      keep `basebuild-local` synthetic entry.
- [x] 1.5 Replace hardcoded `provider_specs()` with vendored providers + a
      Basebuild overlay table (existing 15 providers keep label/auth/api-key
      URL/pinned base URL; new providers get generic specs with auth method
      derived from OMP metadata).
- [x] 1.6 Cargo test: vendored catalog parses; devin exposes 48 models incl.
      `swe-1-6` and `glm-5-2`; every model has a non-empty `api_kind`.

## 2. Cache Semantics (fix #2 — stale devin-2.0)

- [x] 2.1 Stamp `bundled`-source cache rows with the catalog version; on
      catalog build/refresh, replace stamp-mismatched or stampless bundled
      rows with current bundled models (discovery/catalog-sync rows preserved).
- [x] 2.2 `refresh_provider_spec`: bundled-only providers (devin without OMP)
      return `Ok(bundled)` and replace the cache — remove the
      `Err("...bundled catalog")` → `fallback_or_preserve` → `mark_provider_error`
      preserve path for this case.
- [x] 2.3 Add `omp models <provider> --json --no-extensions` discovery source
      (source `omp_cli`, with timeout + bundled fallback) tried when OMP is
      installed and no native discovery exists.
- [x] 2.4 Cargo tests: stale `devin-2.0` row is replaced on catalog build;
      refresh of a bundled-only provider succeeds without preserving stale
      rows; discovery-sourced rows survive a bundled stamp bump.

## 3. API-Kind Routing (fix #1 — Devin 404)

- [x] 3.1 Rework `resolve_client` (`provider_client.rs`) to route by model
      `api_kind` per design D2 (credential base-URL override → overlay pin →
      native kinds → OMP RPC → `TransportUnavailable`); thread the resolved
      `NativeModel` through `native_chat_service` send paths.
- [x] 3.2 Generalize `OmpCodexRpcClient` → `OmpRpcClient { omp_provider_id }`;
      keep the `omp://openai-codex` sentinel behavior; map tool-bearing
      requests to a clear "plain chat only over this bridge" error.
- [x] 3.3 OMP availability probe (once per process) + typed
      `TransportUnavailable` error; picker/composer surface "requires Oh My Pi"
      for bespoke-kind models when OMP is missing.
- [x] 3.4 Cargo tests: kind→client mapping (completions/anthropic/openrouter
      native; devin-agent → OMP RPC; unknown kind + no OMP → unavailable);
      custom base-URL override still routes native.
- [ ] 3.5 Live smoke: send "hi" to `devin/swe-1-6` and `devin/glm-5-2` on the
      dev build — response streams, no 404.

## 4. Credentials & OAuth via OMP

- [x] 4.1 Replace the `omp_to_basebuild_provider` whitelist with identity
      mapping over vendored provider ids (keep `openai-codex` → `openai`
      sentinel); OAuth rows resolve via existing `omp_oauth_token`.
- [x] 4.2 "Login via OMP" command + UI affordance for OAuth providers
      (terminal tab running `omp login <provider>`; on exit re-read
      credentials + refresh that provider's catalog); OAuth-only providers
      without OMP show the requires-OMP setup state.
- [ ] 4.3 Provider settings UI: show credential origin (Basebuild key vs OMP
      store) and auth method per provider; tooltips on all new controls.
- [ ] 4.4 Update `docs/SECRETS.md` (OMP token bridge: in-memory TTL cache,
      never logged/persisted) and verify no token can reach logs.
- [x] 4.5 Cargo test: OMP store rows for a non-whitelisted provider (e.g.
      `groq`, `devin`) surface as configured credentials.

## 5. Terminal Output Replay (fix #5)

- [x] 5.1 Backend: per-session bounded scrollback (`VecDeque<u8>`, 512 KiB) +
      `seq` shared with the reader thread (`terminal_service.rs`); events gain
      `seq`; new `terminal_replay` command returning `{ data, last_seq }`;
      buffer freed on close.
- [x] 5.2 Frontend (`TerminalPanel.tsx`, `lib/terminal.ts`): attach listener →
      queue → replay → seq-dedupe → live; tolerate seq-less events; remove
      `waitForSize` abort dead-end (surviving StrictMode mount must render).
- [x] 5.3 Remove `.terminal-debug-panel` overlay and `dbg()` scaffolding (or
      gate behind a developer flag off by default).
- [x] 5.4 Cargo test: scrollback cap + replay tail; seq monotonicity. Unit
      test (TS or e2e): replay/live boundary drops duplicates, no gaps.
- [ ] 5.5 E2E/manual smoke: `+ → Terminal` shows a shell prompt; typing echoes;
      tab switch away/back repaints; OMP tab still renders its TUI.
- [ ] 5.6 Annotate `openspec/changes/omp-terminal-usage-sync/tasks.md`: its P0
      terminal-plumbing item is implemented here (reference this change); its
      remaining scope (telemetry, sync gates, skills bundling) unchanged.

## 6. Source Control Resilience (fix #3)

- [x] 6.1 `GitService::log`: pre-check `git rev-parse --verify --quiet HEAD`;
      unresolvable HEAD → `Ok(vec![])`. Parse `# branch.oid (initial)` into
      `GitStatus.unborn` (`models/git.rs`, `parse_porcelain_v2`).
- [x] 6.2 `SourcePanel.tsx`: unborn state → History shows "No commits yet"
      empty state; Changes lists untracked/staged as normal; initial commit
      path verified; real git failures render as one-line classified banner
      with expandable raw output (never the bare panel body).
- [x] 6.3 Cargo test: `log`/`status` against a fresh `git init` temp repo
      (no commits) — no error, empty history, untracked listed; commit then
      succeeds.
- [ ] 6.4 Manual smoke with a fresh-repo project (e.g. `hooked_inc`): Changes
      and History tabs usable, initial commit from panel works.

## 7. Modal & Inspector Layout (fix #4)

- [x] 7.1 `globals.css`: adaptive `.modal` sizing
      (`min(92vw, 960px)` × `min(85vh, 640px)`, radius 0); host-driven widths
      for `PlanningInspector`/`SourcePanel` (no dock-width assumptions).
- [x] 7.2 Ideas status filters render as spaced chips (flex + gap + padding +
      active state) in `PlanningInspector.tsx` + CSS.
- [x] 7.3 Hide the collapse toggle when hosted in a modal (host-context prop
      replacing the `onToggleCollapse={() => {}}` no-op in `AppShell.tsx`);
      keep tab row from overflowing at modal width.
- [x] 7.4 Style `.schematic-health-badge` as a non-interactive status chip
      (cursor default, distinct from `.inspector-tab`; tooltip retained).
- [ ] 7.5 Visual verification: capture Plans & Ideas and Changes modals
      (scripts/capture-window.ps1) — content fills the modal, chips separated,
      no dead controls.

## 8. Verification

- [ ] 8.1 `npx tsc --noEmit` and `npm run build` pass.
- [ ] 8.2 `cd src-tauri && cargo check && cargo test` pass (incl. new tests
      from 1.6, 2.4, 3.4, 4.5, 5.4, 6.3).
- [ ] 8.3 `npm run test:e2e` passes (mocked Tauri commands updated for new
      catalog/terminal payload shapes).
- [ ] 8.4 Live dev-build smoke matrix: Devin SWE-1.6 + GLM-5.2 chat (fix #1/#2),
      new terminal renders prompt (fix #5), fresh-repo Changes panel (fix #3),
      Plans & Ideas / Changes modals reflow (fix #4), at least one
      native-transport provider (e.g. Anthropic or Groq) still chats.

## 9. Docs & Roadmap

- [ ] 9.1 Update `docs/agents/agent-runtime.md` (api-kind routing, OMP
      delegation, credential bridge) and `docs/agents/desktop-shell.md`
      (terminal replay contract).
- [ ] 9.2 Update `DESIGN.md` with the adaptive modal sizing rule and status-
      badge-vs-tab treatment; update `AGENTS.md` provider notes if conventions
      changed.
- [ ] 9.3 Refresh roadmap: `node scripts/openspec-status.mjs --write`.
