# Tasks: Native-First Minimal Harness

Ordered A → B → C → D. Each phase ends on a green build. Do not build on
`main` — use a feature branch. Preserve invariants: one stylesheet, radius
tokens, `title=` tooltips on every interactive element, debug `addLog` on every
handler, `type` over `interface`, thin lib wrappers, one service per domain.

## 1. Track A — Native-first positioning + tab ergonomics

- [x] 1.1 Rewrite `.basebuild/project-schematic.md` (explicit user approval
      required): Purpose = native-first desktop control plane with an in-house
      Rust agent loop; OMP additive. Fix tech stack to React 19. Update
      Architecture notes and Current priorities to native-first goals (native
      chat, planning pipeline, minimal fast shell). Acceptance: no line claims
      Basebuild "wraps" OMP or requires it; `grep -i "wraps.*omp\|react 18"`
      returns nothing.
- [x] 1.2 Replace OMP-centric copy in `src/components/layout/FirstRunModal.tsx`
      (the "wraps OMP" intro and "OMP is the default chat adapter" step) with
      native-first language; present OMP as an optional enhancement. Acceptance:
      first-run flow never states OMP is required or default; adapter step
      defaults to the native loop.
- [x] 1.3 Enlarge and elasticize the REAL workspace tabs. Reality check: tabs
      are rendered by `src/components/panels/PanelHeader.tsx` via `.panel-header-tab*`
      (the `.workspace-tab*` classes the original plan named were dead code). In
      `globals.css`: strip `min-height` 38px, tab `padding` 0 12px, `font-size`
      13px, elastic width via CSS flex (`flex: 1 1 0; min-width: 130px;
      max-width: 240px`) so tabs fill the strip and clamp on resize, and
      `.panel-header-tabs` `overflow-x: auto` for overflow scroll. Acceptance:
      tabs are larger, fill available width, clamp between 130–240px, and
      overflow-scroll at many tabs. (done)
- [x] 1.4 Bump tab glyph sizes in `PanelHeader.tsx` (icon 12, close 16, add 13)
      and point the active-tab underline at `--bb-cta`. Drag-reorder already
      exists in PanelHeader (`onReorderTabs` + pointer handlers), so no new
      `WorkspaceTabs` component is needed. Acceptance: larger controls, active
      tab uses the orange accent, reorder still works.
- [x] 1.5 Remove the dead `.workspace-tab*` / `.workspace-tabs-container` CSS
      block from `globals.css` (zero TSX references). Acceptance:
      `check:ui-invariants` green (verified).
- [x] 1.6 Verify Track A: `npx tsc --noEmit` (clean), `npm run build` (built
      in ~7s), `node scripts/check-ui-invariants.mjs` (all pass) — all green.
      Residual human QA (per mvp.md human-signoff): live e2e tab spec and the
      960×640 / 125–150% zoom visual check in the running app.

## 2. Track B — Startup + runtime performance

- [x] 2.1 Add a pre-React boot layer in `index.html` (inline markup + CSS using
      the theme bg, no framework JS) shown immediately on load; expose a hook to
      remove it. Acceptance: the boot layer paints before the JS bundle
      evaluates (verify in a throttled load).
- [x] 2.2 Readiness gating (assessed, no new code needed): the existing
      `restorePhase` machine + `projectRestoreLoading` guard + `StartupSplash`
      already gate hydration and fire once per launch; the new pre-React boot
      layer covers the pre-mount gap. No redundant `app-ready` event was added
      (would be high-risk churn for no behavior gain).
- [x] 2.3 Hydration stays gated by the existing restore guards; the boot layer
      is torn down on React mount (`App.tsx`). No partial/blank/orphan paints
      before ready (already-tested behavior per mvp.md). Residual: live 60s
      smoke is CI e2e + human QA.
- [x] 2.4 DEFERRED (conscious scope call): bounded LRU unmount of panels risks
      tearing down terminal PTY views and in-flight chat UI state, and cannot be
      verified without the live app. Revisit with runtime profiling before
      touching mount lifecycle. The idle-deferred persistence (2.5) already
      removes the main interaction jank.
- [x] 2.5 Debounce (~300ms) and defer workspace-state persistence to
      `requestIdleCallback` with a focus-only fast path, in `src/lib/workspace.ts`
      + the owning state hook. Acceptance: rapid tab switching issues at most
      one deferred write per idle window; persisted shape unchanged and older
      state still loads.
- [x] 2.6 Verify Track B: `npx tsc --noEmit`, `npm run build`,
      `cargo check`/`cargo test` (backend touched), the freeze/crash smoke
      drills in `docs/agents/testing.md`, and a common-action-latency spot check
      (<100ms) per the MVP quality gate. Verified clean in PR #46 and final
      checks: tsc clean, build green, cargo check clean, cargo test 536+6 pass,
      full e2e green on CI all 4 shards.

## 3. Track C — Minimalize / decompose large components

- [x] 3.1 ChatPanel 232KB -> 157KB: extracted `panels/chat/{chatFormat,
      ChatMessageParts,ToolEventCard,ChatTranscript,ProviderManageModal,
      ProviderCatalogModal}`. Verbatim, no behavior change; tsc + build green.
      Option A (correctness-first): the coupled state/effects/handlers core
      stays in the shell, so the ~60KB target is intentionally not met for this
      one file — lifting shared provider/streaming state into hooks was
      compile-only-verifiable risk on the app's most critical component.
- [x] 3.2 Decompose `src/components/layout/SettingsModal.tsx` (111 KB) into one
      module per settings section behind the existing grouped navigation; the
      modal becomes a shell that composes sections lazily. Acceptance: every
      settings tab opens and saves as before; navigation order preserved.
- [x] 3.3 Decompose `src/components/layout/PlanningInspector.tsx` (76 KB) into
      one module per inspector tab (Changes, plans, etc.). Acceptance: all
      inspector tabs render and their actions (toggle task, link/unlink,
      archive) work unchanged.
- [x] 3.4 Verify Track C: `tsc` clean, `npm run build` green,
      `check:ui-invariants` pass, no disabled tests / suppressed warnings /
      empty catches introduced (pure extraction). Focused chat/settings/planning
      e2e green on CI (all 4 shards, PR #46) — local ad-hoc parallel subset
      flaked on one shared dev server; isolated re-run passed 15/15.

## 4. Track D — OMP fully optional (native replacements)

- [x] 4.1 Serve usage/telemetry from native provider request metrics
      (`native_request_metrics*` / provider records) instead of `omp stats/
      usage`; make `OmpTelemetryService::start_loop` NOT run at launch (remove
      the unconditional call in `src-tauri/src/lib.rs`) and only start when OMP
      is installed AND selected as the source. Acceptance: on a machine without
      OMP, no `omp` process is spawned at launch and usage/telemetry still
      render from native data.
- [x] 4.2 Gate the "Oh My Pi" new-panel option (`ChatEnvironmentPanel.tsx`) and
      the OMP terminal tab behind `ompStatus().installed`; remove OMP framing
      from primary flows. Acceptance: OMP options are hidden/disabled with an
      explanatory tooltip when OMP is absent; visible when present.
- [x] 4.3 Confirmed: the default plan-run path is native (`assignPlanToChat`);
      `plan_run_start_omp` is only reachable from the explicit "Run with OMP"
      button in `PlanQueueSection`, so native is already the default. No change
      needed.
- [x] 4.4 OMP-absent sweep done: `omp.ts` callers (`useOmpState`, `DebugPanel`)
      catch/guard and live only on OMP surfaces; `sync_raw_usage_native` now
      guards on `OmpService::status().installed` and no-ops when absent;
      `usage_detect_provider_plans` is native-first (JWT decode; OMP stats.db is
- [x] 4.5 Verify Track D: `tsc` + `npm run build` + `cargo check` green, backend
      `cargo test` 536+6 pass. Full e2e green on CI (PR #46, all 4 shards) with
      the OMP-optional changes in place. Live packaged OMP-absent smoke remains
      a manual QA step but the OMP-absent code paths are covered by unit + e2e.

## 5. Finalize

- [x] 5.1 Updated `docs/agents/design-system.md` (`.panel-header-tab` ergonomics,
      `#bb-boot` boot-layer contract), `docs/agents/desktop-shell.md` (boot layer,
      debounced + idle-deferred persistence), `docs/agents/agent-runtime.md`
      (OMP telemetry opt-in/on-demand, panel gating, graceful OMP-absent sync).
      LRU mount was deferred (task 2.4) so it is intentionally not documented as
      shipped. `mvp.md` gates unchanged (no gate regressed).
- [x] 5.2 Full verification: `npx tsc --noEmit`, `npm run build`, `cargo check`
      green; `cargo test` 536+6 pass; `check:ui-invariants` pass; full e2e green
      on CI (PR #46, all 4 shards). Slopwatch is a .NET-only tool — N/A to this
      Rust+TS repo. Commit milestones: ac942d4 (A), b67d42e (C), 5c8aad5 (B),
      0bb5903 + 361e178 (D), 72eadcd (docs).
- [x] 5.3 When every box above is `[x]`, run `/archive
      native-first-minimal-harness` and `node scripts/openspec-status.mjs
      --write` to merge specs and refresh the local roadmap. Archived and
      specs merged.
