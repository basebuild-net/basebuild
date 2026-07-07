# Proposal: Provider Parity & Workspace Fixes

## Why

Live testing of the dev build (2026-07-07) shows the daily-driver loop is blocked
at five points, and the provider system cannot grow past its hardcoded list.
Owner direction: reach Oh My Pi's provider/model coverage (58 providers,
~4,600 models in OMP's `models.json`) — Devin first — and make the planning UI,
Changes panel, and terminals actually usable. All five defects below were
reproduced and traced to specific mechanisms; none are speculative.

1. **Devin chat 404s on every send.** `resolve_client` wires `devin` as an
   OpenAI-compatible client at `https://server.codeium.com`
   (`provider_client.rs:138-143`), so sends POST
   `server.codeium.com/chat/completions` — but that host speaks a protobuf
   Connect RPC, not REST. The code knows this
   (`provider_model_catalog_service.rs:161-164`) yet still routes chat through
   the OpenAI path. No Devin model can chat.
2. **Stale cache suppresses the bundled catalog.** `catalog()` uses bundled
   models only when the DB cache has zero rows for a provider
   (`provider_model_catalog_service.rs:53-66`). A stale `devin-2.0` row (from an
   older build; the id appears nowhere in current source) blocks the 48-model
   bundled Devin list. Refresh makes it worse: Devin's refresh returns
   `Err("...loaded from the bundled catalog")` → `fallback_or_preserve` →
   `mark_provider_error`, preserving the stale row forever.
3. **Changes modal shows a raw git fatal.** Projects with an unborn HEAD (fresh
   `git init`, no commits — e.g. `hooked_inc`) surface
   `git failed (exit Some(128)): fatal: your current branch appears to be broken`
   instead of the untracked files ready for an initial commit. `GitService::log`
   assumes HEAD resolves; the error poisons the whole SourcePanel.
4. **Plans & Ideas / Changes modals are unusable.** Both embed side-rail
   components (`PlanningInspector`, `SourcePanel`) built for a ~300px dock into
   a fixed 720×540 `.modal` (`globals.css:1329`): content jams into a narrow
   column, tabs overflow, the Ideas status filters render as the run-on string
   `AllConceptPickedRejectedArchived`, the collapse button is wired to a no-op
   (`AppShell.tsx:1004`), and the schematic-health badge reads as a broken tab.
5. **New terminals render nothing.** PTY output is emitted live-only with no
   scrollback (`terminal_service.rs:107-142`); the frontend attaches its
   listener only after async `waitForSize` + `listTerminals()`
   (`TerminalPanel.tsx:70-147`), so the shell's startup prompt is emitted into
   the gap and lost. StrictMode double-mount (`main.tsx:16`) aborts the first
   init, and a leftover debug overlay dominates the panel. The shell process is
   alive and receives keystrokes — it is purely an attach/replay problem.

## What Changes

- **Vendored model catalog (data, not code).** Vendor OMP's
  `packages/catalog/src/models.json` (MIT) at
  `src-tauri/vendor/omp-catalog/` following the existing `vendor/portable-pty`
  convention, embed it at build time, and generate the bundled provider/model
  catalog from it — replacing ~500 lines of hand-transcribed `bundled(...)`
  rows that have already drifted. All 58 OMP providers and ~4,600 models become
  available; an update script re-pulls upstream.
- **API-kind routing.** Every catalog model carries its wire-protocol kind
  (OMP's `api` field: `openai-completions`, `anthropic-messages`,
  `openai-responses`, `devin-agent`, …). Sends route by api kind, not by
  provider id. Native transports serve OpenAI-compatible and Anthropic kinds
  (~70% of models); every bespoke kind (devin-agent, cursor-agent,
  google-gemini-cli, bedrock, …) delegates per-turn to OMP by generalizing the
  existing one-shot `OmpCodexRpcClient` bridge (`omp --mode rpc --provider <id>`).
  Without OMP installed, bespoke-kind models surface an actionable
  "requires Oh My Pi" state instead of a wrong-endpoint 404. Fixes #1.
- **Bundled-cache replacement semantics.** Bundled-source cache rows are
  replaced when the embedded catalog changes (catalog version stamp); a
  bundled-only provider's refresh succeeds with bundled data instead of
  error-preserving stale rows. Fixes #2 (stale `devin-2.0` suppressing
  SWE 1.6 / GLM 5.2).
- **OAuth via OMP, no first-party app registration.** Extend the OMP credential
  bridge (currently whitelisted to `umans|openai|anthropic`) to every mapped
  provider: API keys read from OMP's store, OAuth tokens resolved via
  `omp token <provider>` (OMP ships the vendors' public client IDs and handles
  refresh — Basebuild does not need to register its own OAuth apps). Add a
  "Login via OMP" affordance that runs `omp login <provider>` in a terminal
  tab and refreshes credentials on completion. Manual API-key entry unchanged.
- **Terminal output replay.** Backend keeps a bounded per-session scrollback
  buffer with sequence numbers; attaching a panel replays buffered output, then
  streams live events gap- and duplicate-free. Terminal init becomes
  StrictMode-safe; the on-screen debug overlay is removed. Fixes #5, and
  implements the P0 diagnosis of the queued `omp-terminal-usage-sync` change
  (cross-referenced there so the work is not duplicated).
- **Empty-repo source control.** Unborn-HEAD repositories are first-class:
  status/changes work (porcelain v2 already supports `branch.oid (initial)`),
  History shows a "No commits yet" empty state, the initial commit can be made
  from the panel, and raw git fatals never render as the panel body. Fixes #3.
- **Modal layout reflow.** `.modal` sizing becomes adaptive; `PlanningInspector`
  and `SourcePanel` reflow to fill their host container; Ideas filter chips get
  real spacing; the collapse control is hidden where collapse is meaningless;
  the schematic-health badge is styled as a status badge, not a tab. Fixes #4.

## Capabilities

### New Capabilities

- `provider-api-routing` — wire-protocol-kind routing for chat turns, including
  per-turn OMP RPC delegation for bespoke protocols.
- `terminal-output-replay` — server-side scrollback + gapless replay-on-attach
  for PTY terminals.
- `source-control-resilience` — first-class empty/unborn/non-repo states in the
  source control surface.

### Modified Capabilities

- `provider-model-catalog` — bundled catalog becomes vendored OMP data;
  bundled-cache replacement semantics; OMP CLI (`omp models --json`) as a
  discovery source; picker usability at 4-digit model counts.
- `provider-web-login` — OMP credential reuse for all mapped providers; OAuth
  token resolution via `omp token`; login-via-OMP flow; explicit
  no-first-party-OAuth-registration stance.
- `chat-environment-panel` — hosted planning/source surfaces reflow to their
  container; chip spacing; badge/tab distinguishability; no dead controls.
  (Base requirements are the in-flight `chat-first-shell` delta — ordering
  dependency noted in design.md.)

## Impact

- **Rust** (`src-tauri/src/`): `services/provider_client.rs` (routing,
  generalized OMP RPC client), `services/provider_model_catalog_service.rs`
  (vendored-catalog load, cache semantics, provider specs from data),
  `services/native_chat_service.rs` (credential mapping, `omp token` bridge),
  `services/terminal_service.rs` (scrollback buffer, replay, seq),
  `services/git_service.rs` (unborn-HEAD guards), `models/native_chat.rs`
  (`NativeModel` api-kind/base-url/cost fields), `models/terminal.rs`,
  `models/git.rs`, `commands/` (replay command, login-via-OMP command).
- **Data**: new `src-tauri/vendor/omp-catalog/{models.json,LICENSE.md,README.md}`;
  new `scripts/update-omp-catalog.mjs`.
- **TS** (`src/`): `lib/native-chat.ts`, `lib/terminal.ts`, `lib/git.ts` (types
  + wrappers), `components/panels/TerminalPanel.tsx`,
  `components/panels/SourcePanel.tsx`, `components/layout/PlanningInspector.tsx`,
  `components/layout/AppShell.tsx`, model-picker surfaces,
  `styles/globals.css` (modal sizing, chips, badge).
- **Docs**: `DESIGN.md` (modal sizing rules), `docs/agents/agent-runtime.md`
  (provider routing + OMP delegation), `docs/agents/desktop-shell.md`
  (terminal replay), `docs/SECRETS.md` (OMP token bridge).
- **Cross-change**: subsumes the terminal-P0 item of `omp-terminal-usage-sync`
  (annotate there); modifies surfaces owned by in-flight `chat-first-shell`;
  distinct from `planning-command-center`'s `omp-rpc-chat` capability (that is
  a persistent whole-session OMP profile; this is per-turn provider transport
  inside the native harness — see design.md).
