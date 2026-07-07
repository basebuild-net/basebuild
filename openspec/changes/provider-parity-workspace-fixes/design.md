# Design: Provider Parity & Workspace Fixes

## Context

Basebuild's provider system is a hand-maintained fork of a slice of Oh My Pi's
catalog: 15 hardcoded `ProviderSpec`s and ~500 lines of `bundled(...)` model
rows in `provider_model_catalog_service.rs`, all routed through two native
clients (`OpenAiCompatibleClient`, `AnthropicClient`) plus one special-cased
OMP bridge (`OmpCodexRpcClient`, keyed on the `omp://openai-codex` base-URL
sentinel). The owner's target is OMP-level coverage with Devin first.

### Upstream catalog analysis (OMP `models.json`, fetched 2026-07-07)

58 providers, ~4,600 models. Distribution by wire-protocol kind (`api` field):

| api kind | models | transport plan |
|---|---|---|
| `openai-completions` | 2,413 | native (existing client) |
| `openrouter` | 351 | native (openai-compatible + headers) |
| `anthropic-messages` | 372 | native (existing client) |
| `openai-responses` / `azure-openai-responses` | 91 / 35 | native completions-compat for API keys; OMP RPC otherwise |
| `bedrock-converse-stream` | 127 | OMP RPC delegation |
| `devin-agent` | 48 | OMP RPC delegation (**priority**) |
| `cursor-agent` | 42 | OMP RPC delegation |
| `ollama-chat` | 43 | native (openai-compatible endpoint) or OMP RPC |
| `google-generative-ai` / `google-vertex` / `google-gemini-cli` | 38 / 10 / 23 | overlay: `google` pinned to OpenAI-compat `/v1beta/openai` (API key); rest OMP RPC |
| `openai-codex-responses` | 16 | OMP RPC (existing bridge, generalized) |
| `gitlab-duo-agent` | 1 | OMP RPC delegation |

Key data points verified:
- `devin` models carry `"api": "devin-agent"`, `"baseUrl": "https://server.codeium.com"` —
  a protobuf Connect RPC. OMP implements it with ~100 generated proto modules
  (`packages/ai/src/providers/devin/…`) plus a dedicated OAuth flow
  (`packages/ai/src/registry/oauth/devin.ts`).
- `omp models devin --json --no-extensions` (omp 16.3.11, installed) returns
  the full 48-model list with contextWindow/maxTokens/reasoning/input metadata.
- `omp token <provider>` resolves live OAuth access tokens (already used by
  `native_chat_service.rs` with a 5-min TTL cache).
- OMP repo is MIT-licensed → vendoring `models.json` with attribution is fine
  and matches the existing `src-tauri/vendor/portable-pty` convention.

### Verified defect mechanics (dev build, 2026-07-07)

| # | Defect | Mechanism |
|---|---|---|
| 1 | Devin 404 | `resolve_client` → `OpenAiCompatibleClient{base_url: server.codeium.com}` (`provider_client.rs:138-143`) → POST `/chat/completions` against a Connect-RPC host |
| 2 | Only `devin-2.0` selectable | stale cache row + `catalog()` cache-wins rule (`provider_model_catalog_service.rs:53-66`) + devin refresh returns `Err` → `fallback_or_preserve` → `mark_provider_error` preserves the stale row (`:161-174`, `:240-252`) |
| 3 | Changes = raw fatal | `GitService::log` on unborn HEAD exits 128; error string becomes the panel body (`SourcePanel.tsx:430`); `status --porcelain=v2 --branch` itself works on unborn HEAD (`# branch.oid (initial)`) |
| 4 | Cramped modals | dock-width components (`PlanningInspector`, `SourcePanel`) inside fixed 720×540 `.modal` (`globals.css:1329-1334`); `.inspector-tab` chips lack container spacing; `onToggleCollapse={() => {}}` no-op (`AppShell.tsx:1004`) |
| 5 | Blank terminal | live-only PTY emit (`terminal_service.rs:107-142`), listener attaches after `waitForSize`+`listTerminals` (`TerminalPanel.tsx:70-147`) → startup prompt lost; StrictMode double-mount aborts first init; `.terminal-debug-panel` overlay left in |

## Goals / Non-Goals

**Goals**:
- Every OMP-cataloged provider/model selectable; Devin chat works end-to-end.
- Catalog is data-driven and refreshable from upstream with one script.
- OAuth reuse without registering first-party OAuth apps.
- Terminals paint on open; Changes panel survives fresh repos; planning/source
  modals fit their content.

**Non-Goals**:
- Reimplementing bespoke wire protocols (devin-agent Connect RPC, cursor-agent,
  bedrock) natively in Rust.
- First-party OAuth token exchange/refresh (PKCE flows in Rust) — future work.
- Tool-calling over the one-shot OMP bridge (plain chat only; the persistent
  `omp-rpc` session profile in `planning-command-center` is the tools path).
- Provider cost accounting/billing UI (cost fields are carried, not billed).

## Decisions

**D1 — Vendor OMP `models.json` as the bundled catalog.**
`src-tauri/vendor/omp-catalog/{models.json, LICENSE.md, README.md}`, embedded
via `include_str!`, parsed once into a `LazyLock` structure. `bundled_models()`
and `provider_specs()` become views over this data plus a small Basebuild
overlay table (label/auth-method/api-key-URL/pinned-base-URL for the ~15
providers we already document; generic entries for the rest).
`scripts/update-omp-catalog.mjs` re-pulls upstream and stamps a catalog version
(content hash) used by cache invalidation.
- *Rationale*: kills the drift already visible (hand-copied devin rows vs
  upstream), makes "more providers" a data update, not a code change.
- *Alternatives*: hosted-only catalog (rejected: offline-first requirement);
  keep hardcoded rows (rejected: 58 providers × churn).
- *Note*: parse at first use, not per call — the JSON is ~1 MB; hold one
  parsed copy, no re-parsing per catalog build.

**D2 — Route by api kind; delegate bespoke kinds to OMP per turn.**
`NativeModel` gains `api_kind` (+ `base_url`, cost fields) persisted through
the cache. `resolve_client(provider_id, base_url)` becomes
`resolve_client(model: &NativeModel, credential)`:
1. credential base-URL override → `OpenAiCompatibleClient` (unchanged escape hatch);
2. overlay pin (e.g. `google` → `/v1beta/openai`) → native client;
3. `openai-completions`/`openrouter`/`ollama-chat` → `OpenAiCompatibleClient`
   at the model's catalog base URL; `anthropic-messages` → `AnthropicClient`;
   `openai-responses` with a plain API key → completions-compat path;
4. everything else → `OmpRpcClient { omp_provider_id }` — the existing
   `OmpCodexRpcClient` generalized (`omp --mode rpc --provider <id> --model <id>
   --no-tools --no-session --no-title --no-skills --no-rules --no-extensions`);
5. no OMP installed → typed `TransportUnavailable` error surfaced as a setup
   state in the picker and composer, never a wrong-endpoint HTTP call.
- *Rationale*: OMP already implements and maintains every bespoke protocol +
  auth; the one-shot bridge pattern is proven in-tree for openai-codex.
- *Alternatives*: native devin Connect-RPC client (rejected: ~100 proto files,
  high churn, duplicated auth); provider-id match arms (rejected: doesn't
  scale to 58).
- *Risk*: per-send process spawn latency (~1–3 s). Accepted for now;
  `planning-command-center`'s persistent `omp-rpc` profile is the long-term
  path — this change deliberately does not duplicate it (that capability owns
  persistent sessions + OMP-side tools; this one owns per-turn transport
  inside the native harness).

**D3 — Devin catalog/refresh correctness (fix #2).**
Cache rows record the bundled catalog version stamp. On `catalog()`/`refresh`:
bundled-source rows whose stamp ≠ current are replaced by current bundled
models. `refresh_provider_spec` for bundled-only providers returns
`Ok(bundled_models(...))` (source `bundled`) instead of `Err` →
`mark_provider_error`. `omp models <provider> --json` becomes a discovery
source (source `omp_cli`) tried before bundled when OMP is installed.
Migration: first run after update replaces all `bundled`-source rows once
(version stamp absent = stale). User-facing effect: `devin-2.0` disappears,
48 real models appear, "Refresh models" succeeds.

**D4 — Credentials: identity mapping + `omp token` for OAuth.**
`omp_to_basebuild_provider` whitelist inverts to identity for every provider
id present in the vendored catalog (OMP ids are the canonical ids), keeping
the single existing exception (`openai-codex` → `openai` tagged with the
`omp://openai-codex` sentinel). OAuth rows resolve via the existing
`omp_oauth_token` TTL cache. "Login via OMP" = spawn a terminal tab running
`omp login <provider>`, poll credential store on exit, refresh that provider's
catalog. Security: tokens stay process-local (existing in-memory cache), never
logged, never persisted by Basebuild; OMP's store remains the source of truth.
Answering the owner's question directly: **no first-party OAuth keys needed** —
vendors' public client IDs ship inside OMP's flows.

**D5 — Terminal scrollback replay (fix #5).**
`PtySession` gains `Arc<Mutex<Scrollback>>` (`VecDeque<u8>` capped at 512 KiB +
`next_seq: u64`) shared with the reader thread. Reader appends before emitting;
events gain `seq`. New command `terminal_replay(id) -> { data, last_seq }`.
Frontend order: attach listener (queue events) → `terminal_replay` → write
replay → drain queue dropping `seq <= last_seq` → live. This makes StrictMode
double-mount benign (aborted mount loses nothing; surviving mount replays).
Remove `.terminal-debug-panel` + `dbg()` scaffolding. Trust boundary: PTY
output is untrusted bytes; it is written only to xterm (as today), never
interpolated.
- *Alternative*: write `\n` on connect to force a fresh prompt (rejected:
  loses real output, breaks TUI apps like OMP).
- *Cross-change*: implements the P0 diagnosis in `omp-terminal-usage-sync`
  (task annotation there; its remaining scope — telemetry parser, sync gates,
  skills bundling, terminal-first sessions — is untouched).

**D6 — Unborn HEAD handling (fix #3).**
`GitService::log` pre-checks `git rev-parse --verify --quiet HEAD`; failure →
`Ok(vec![])`. `GitStatus` gains `unborn: bool` from porcelain v2
`# branch.oid (initial)` (already emitted; parser extended). SourcePanel:
`unborn && commits.empty` → History shows "No commits yet"; Changes works as
normal (status/stage/commit already function on unborn HEAD); real errors
render as a one-line classified banner with expandable raw output.

**D7 — Modal reflow (fix #4).**
`.modal` becomes adaptive: `width: min(92vw, 960px); height: min(85vh, 640px)`
(0px radius preserved). `PlanningInspector`/`SourcePanel` drop fixed
dock-width assumptions (host-driven `width: 100%`, flex column fills).
`.inspector-filter` chips get `display:flex; gap:4px` + chip padding/active
state. `showHeader`/host context prop hides the collapse toggle in modals
(replacing the `() => {}` no-op). `.schematic-health-badge` styled as a
non-interactive status chip (`cursor: default`, distinct border/background from
`.inspector-tab`). DESIGN.md gains the modal sizing rule.

## Risks / Trade-offs

- **OMP CLI availability/version drift** → probe once per process
  (`omp --version`), degrade to "requires OMP" states; catalog falls back to
  bundled data. RPC frame parsing already tolerant (skip malformed lines).
- **Per-send OMP spawn latency** → acceptable for chat; documented; persistent
  profile arrives via `planning-command-center`.
- **4,600 models in the picker** → search + configured-first grouping;
  virtualize the list if profiling shows jank (scenario requires no
  perceptible lag).
- **Catalog JSON size in binary** (~1 MB) → negligible for a desktop bundle;
  parsed once.
- **`omp models` slowness with broken user extensions** (observed 48 s with a
  failing extension) → always pass `--no-extensions`, add a timeout, fall back
  to bundled.
- **Replay/live race** → seq-based dedupe (D5); covered by a unit test on the
  boundary and an e2e that opens a terminal and asserts a prompt renders.
- **Modifying in-flight surfaces** (`chat-first-shell` modals,
  `omp-terminal-usage-sync` P0) → cross-references recorded in both proposals;
  archive order: `chat-first-shell` before this change.

## Migration Plan

1. Ship vendored catalog + version stamp; on first catalog access,
   stamp-mismatched (or stampless) `bundled`-source cache rows are replaced.
   Discovery/catalog-sync rows untouched. No user data loss; no manual DB
   surgery needed (the stale `devin-2.0` row self-heals).
2. Credential behavior is additive (more providers appear configured); the
   `openai-codex` sentinel path is unchanged.
3. Terminal event payloads gain `seq`; the frontend tolerates events without
   `seq` (treated as live) so a mid-update mismatch degrades to today's
   behavior.
4. Rollback = revert; no schema migrations beyond the cache stamp column
   (nullable, additive).

## Open Questions

- Should `openai-responses`-only models (gpt-5-pro tier) route native-responses
  eventually? Deferred: completions-compat covers current use; revisit when a
  responses client lands.
- Ollama local discovery (`ollama-chat`, 43 models) — native `/v1` endpoint vs
  OMP delegation; default to native openai-compat at `localhost:11434/v1`,
  verify during implementation.
- Whether "Login via OMP" should auto-install/update OMP when missing —
  out of scope here (no silent installs; explicit user action only).
