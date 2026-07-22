# Tasks: Privacy-Safe Usage Intelligence

Ordered website contract first, then Desktop adoption, then derivation/publication. Every phase must leave existing authenticated MCP clients functional. Do not implement silent updater changes from the superseded telemetry proposal.

## 1. Contract and schema foundation

- [x] 1.1 Define the versioned desktop envelope, source row schemas, validation limits, per-source acknowledgement, and error codes in shared planning fixtures for `basebuild-app` and `basebuild-dotnet`; include native, OMP, Claude Code, Codex, and OpenCode examples containing no content or paths.
- [x] 1.2 Add basebuild.net schema/migration records for guest installations, hashed credentials, envelope receipts/idempotency, model-access observations, provenance-carrying evidence, and public usage cohorts; do not add guest identity columns to `User`.
- [x] 1.3 Add migration compatibility checks and indexes for principal/source/idempotency uniqueness, pending processing, access-interval lookup, cohort lookup, and guest revocation.
- [x] 1.4 Add server-side constants for body, decompressed-body, batch, row, identifier, timestamp-skew, historical-window, and per-token processing limits.

## 2. Guest authentication and bounded ingestion (basebuild-dotnet)

- [x] 2.1 Implement guest bootstrap in `src/app/api` using a validated random installation UUID, server-secret keyed installation hash, high-entropy `bb_guest_` token, stored token hash, write-only scopes, and no raw HWID/IP persistence.
- [x] 2.2 Extend bearer resolution/tool context to represent a guest principal separately from `User` and deny every read, profile, declaration, feedback, and non-usage tool to guest tokens.
- [x] 2.3 Register `sync_usage_envelope` in the MCP discovery document and tool registry with a closed JSON schema and documented version negotiation.
- [x] 2.4 Implement envelope validation before durable work, including unknown-field rejection, finite non-negative counters, bounded strings/windows, source allowlist, and content/path field exclusion.
- [x] 2.5 Implement per-principal/source/idempotency receipts that return the prior outcome on replay and never duplicate blobs, snapshots, or evidence.
- [x] 2.6 Add per-token quotas, coarse edge-IP issuance/write limits, revocation checks, and bounded retry metadata without using IP as contributor identity.
- [x] 2.7 Preserve authenticated `sync_raw_usage` and `sync_messages` behavior for third-party clients while routing Desktop envelope writes through the new handler.
- [x] 2.8 Add route/handler tests covering bootstrap, token hashing, scope denial, malformed/oversized envelopes, replay, quota enforcement, revocation, and authenticated envelope acceptance.

## 3. Completion-gated consent and transport (basebuild-app)

- [x] 3.1 Update `FirstRunModal.tsx` so new-install usage sharing is preselected only in component state and Finish atomically persists versioned consent before scheduling; Skip, Escape, dismissal, and persistence failure leave backend permissions disabled.
- [x] 3.2 Preserve existing consent choices on upgrade and add Rust/e2e coverage proving no usage request occurs before successful Finish.
- [x] 3.3 Split usage, product analytics, environment inventory, and advisor-feedback permission gates in permission/settings models and Settings Privacy copy; enabling usage must not enable another upload category.
- [x] 3.4 Replace raw anonymous `computerId` transport with guest bootstrap/token storage and rotation in `sync_service.rs`; prohibit hardware or OS identity reads.
- [x] 3.5 Fix `post_mcp` so authenticated and guest request builders always serialize the complete JSON-RPC body and classify HTTP, JSON-RPC, and tool-result errors correctly.
- [x] 3.6 Add transport tests using a local HTTP fixture for signed-in body/header, guest body/header, malformed response, 401/revocation, timeout, and retry behavior.

## 4. Multi-source coordinator and truthful status (basebuild-app)

- [x] 4.1 Wire `usage_source_service::collect_all_sources()` into one envelope coordinator instead of calling native and OMP transports independently.
- [x] 4.2 Convert OMP stats/usage into the allowlisted local aggregate source contract; stop Desktop guest and account flows from uploading opaque OMP blobs.
- [x] 4.3 Reconcile Claude Code, Codex, and OpenCode readers with the envelope schema and deterministic per-source idempotency keys; retain content-stripping parser tests.
- [x] 4.4 Persist independent source checkpoints and advance each only for accepted/already-accepted acknowledgements; retry the same logical window/key after transport failure.
- [x] 4.5 Replace OMP-led global success with `success | partial | failed | nothing_to_sync` computed from every source outcome; update freshness, backoff, managed-trigger baseline, and exit sync accordingly.
- [x] 4.6 Extend usage-sync status models/hooks/UI with per-source availability, pending state, last accepted/processed time, and actionable error; keep projected account reads signed-in only.
- [x] 4.7 Add Rust tests for absent OMP with native success, native failure with OMP skipped, one rejected harness, replay after timeout, partial checkpoint advance, and exit-sync timeout.

## 5. Access classification and fair derivation (basebuild-dotnet)

- [x] 5.1 Add ingestion types and persistence for `paid_metered`, `subscription_included`, `free_permanent`, `free_promotional`, `trial_or_credit`, and `unknown` observations with effective intervals, source, confidence, and observed time.
- [x] 5.2 Extend model/plan discovery and the scheduled worker to record explicit provider/catalog access metadata, price-zero observations, promotion expiry, and source freshness without treating zero client cost alone as free.
- [x] 5.3 Implement classification precedence and conflict diagnostics so weaker heuristics cannot overwrite authoritative overlapping observations.
- [x] 5.4 Tag accepted usage evidence with the time-valid access class or `unknown`, preserving historical promotion intervals when current access changes.
- [x] 5.5 Refactor `best-match.ts`, community usage, model-value scatter, and related projections so free/promo/trial evidence cannot anchor paid/included sibling estimates.
- [x] 5.6 Persist direct/derived provenance: source model/plan, access class, transformation, sample window/size, freshness, and confidence.
- [x] 5.7 Add regression fixtures for Devin free-promotional GLM versus paid/included GPT, expired promotions, zero-cost subscription usage, conflicting sources, and unknown-only evidence.
- [x] 5.8 Order worker stages as pending-envelope derivation, access refresh, classification, privacy cohort aggregation, then cached snapshot rebuild; expose stage failures.

## 6. Cohort-only publication (basebuild-dotnet)

- [x] 6.1 Build privacy-reviewed public aggregate projections with coarse periods/measures, access class, and distinct contributor count after deduplication and invalid/revoked evidence filtering.
- [x] 6.2 Enforce a minimum of five distinct contributors and subtraction-safe suppression/coarsening across parent, child, and sibling totals.
- [x] 6.3 Replace `/explore/usage` contributor queries/UI with cohort-only request, runtime, token, and spend measures labelled by access class and freshness.
- [x] 6.4 Remove username, display name, image, profile link, guest alias, exact reset timestamp, exact plan-window id, and contributor timing from public usage responses.
- [x] 6.5 Keep private account usage behind authenticated, owner-scoped, no-store endpoints that never reuse the public cache path.
- [x] 6.6 Add publication tests for four-versus-five contributors, repeated submissions from one contributor, subtraction disclosure, revoked evidence, no profile joins, and public cache isolation.

## 7. End-to-end verification and documentation

- [x] 7.1 Exercise a signed-in Desktop sync end to end and prove the website accepts the JSON body, processes every available source, advances acknowledged cursors, and exposes private owner status.
- [x] 7.2 Exercise a fresh signed-out install from unfinished setup through Finish, guest bootstrap, accepted usage, replay, worker processing, and thresholded public aggregation; prove no pre-Finish request and no raw installation identity in server rows.
- [x] 7.3 Run focused security tests for scope escalation, arbitrary tool calls, oversized/decompression payloads, non-finite counters, time abuse, token rotation/revocation, and rate-limit bypass attempts.
- [x] 7.4 Update Privacy/TOS and in-app copy with exact uploaded fields, source list, cohort publication, retention/revocation behavior, independent permission controls, and no-HWID statement.
- [x] 7.5 Update `docs/agents/agent-runtime.md` and relevant website calculation/data-source docs with the envelope, source checkpoint, access-cohort, and public projection contracts.
- [x] 7.6 Run basebuild-app type check, production build, Rust check/tests, UI invariants, and focused e2e; run basebuild-dotnet type check, focused tests, build, migration validation, and worker pipeline fixture before marking the change complete.
