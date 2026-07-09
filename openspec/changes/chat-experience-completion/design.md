# Design: Chat Experience Completion

## Context

The chat surface is one 2,849-line orchestrator (`ChatPanel.tsx`) merging
messages, tool events, and interactions into a flat chronological timeline,
backed by the native Rust agent loop (`agent_loop_service.rs`: streaming,
tool calls, approval gateway, `ask_user` parking). Question cards, approval
flow, streaming indicators, metrics, and the context strip all exist and
have e2e coverage. What's missing is the presentation layer depth (markdown,
diffs, affordances, provenance) and the reliability edges (key rotation,
typed transport states), plus proof that the planning loop's native path
works end to end.

Audit evidence (2026-07-10):

| Area | State | Evidence |
|---|---|---|
| Tool cards | partial | `ChatPanel.tsx:165-310`; basic diff CSS `globals.css:1101-1103` |
| Thinking blocks | good | split-around-tools implemented; `globals.css:1224-1240` |
| Streaming states | good | `streaming-indicators.spec.ts` passes |
| Question cards | good | `QuestionCard.tsx`; `interactive-elements.spec.ts` |
| Approval cards | partial | no rule/mode provenance shown |
| Markdown | **missing** | zero renderer matches in ChatPanel/src/lib/package.json |
| Message affordances | **missing** | no copy/retry/edit anywhere |
| Key rotation UI | **missing** | `SettingsModal.tsx:1398-1460` Disconnect-only when configured |
| Transport states | partial | backend `SetupRequired` exists; no `transport_unavailable` UI |
| Schematic native E2E | unverified | primitives exist; only OMP path was exercised (PR #26 comment 4) |
| Idea grounding | partial | `decision_digest` exists (`planning_prompt_service.rs:165-221`) but invisible to user |
| Artifact quality gate | **missing** | `generate_openspec` → `write_artifacts_atomic` with no validation |

## Goals / Non-Goals

**Goals**
1. Assistant output renders as readable, safe rich text.
2. Every standard agentic-GUI affordance present: copy, retry, edit-resend,
   expandable tool cards with diffs, approval provenance.
3. A provider that appears in the picker either works or explains exactly
   why not (setup / transport / error) before a turn starts; keys rotate.
4. The schematic → ideas → plans → OpenSpec loop is native-path verified,
   with visible grounding and a quality gate on generated artifacts.

**Non-Goals**: see proposal (OMP investment, transport isolation itself,
skill validation, heavy syntax highlighting, pagination/compaction).

## Key Decisions

### D1: In-house markdown renderer emitting React elements

**Decision:** Build `src/lib/markdown.ts` (pure tokenizer → block/inline AST)
plus `src/components/panels/MarkdownView.tsx` (AST → React elements).
No dependency, no HTML strings, no `dangerouslySetInnerHTML`, ever.

**Rationale:**
- Security posture: assistant output is untrusted input. Emitting React
  elements only makes script/HTML injection structurally impossible —
  stronger than sanitizing an HTML string.
- Repo convention: "Do not add dependencies unless clearly needed."
  The needed subset (fences, inline code, emphasis, lists, quotes, tables,
  headings) is small and stable; a full CommonMark dependency (+ sanitizer)
  is a larger supply-chain surface than the feature.
- Determinism: e2e can assert on structural classes (`.md-code-block`,
  `.md-table`) without depending on a library's DOM shape.

**Shape:**
- `parseMarkdown(text: string): MdBlock[]` — block pass (fences first,
  then tables/lists/quotes/headings/paragraphs), inline pass per block
  (code spans, bold, italic, links).
- Fences: preserve content verbatim; language tag stored, rendered as a
  header row with a copy button. Unterminated fence = code to end of
  message (streaming-safe).
- Links: render label + host as text with the full URL in `title=`;
  clicking does nothing by default (no window.open from transcript).
  Raw HTML in source renders as literal text.
- Streaming: `MarkdownView` re-parses the accumulated text per frame;
  parser must be O(n) single-pass per call and tolerate any prefix of
  valid markdown without throwing.
- Minimal highlight pass (in-house): comments, strings, numbers, and a
  small keyword set for ts/js/rust/py/json/bash/css/html/md; anything
  else renders unhighlighted. No grammar dependency.

**Where used:** assistant message bodies, thinking-block bodies (folded),
command notices, tool result text where the tool declares markdown output.
User messages stay plain text (pre-wrap) — user input is not markdown.

### D2: Message affordances as a small action rail

**Decision:** Per-message hover/focus action rail: Copy always; Retry on
the last assistant message; Edit-and-resend on the last user message.

**Mechanics:**
- Copy: `navigator.clipboard.writeText(raw source text)` (not rendered
  DOM), toast on success/failure.
- Retry: re-issues the last user message as a fresh `native_chat_send`
  with the current provider/model/effort. The prior assistant message
  stays (history is append-only); the timeline shows a "retried" marker
  linking the two turns. No message deletion involved.
- Edit-and-resend: prefills the composer with the last user message and
  focuses it; sending replaces nothing — it appends a new turn. (True
  in-place edit would require history rewrite; out of scope.)
- Keyboard: rail buttons are real buttons, tab-reachable, tooltip-covered.

**Rejected:** delete-message (destructive history mutation conflicts with
append-only persistence + metrics ledger; `/clear` already covers reset).

### D3: Tool card depth — structured expansion + unified diff

**Decision:** Extend `ToolEventCard`:
- Collapsed row: kind icon, name, one-line summary, status word + icon,
  duration when available.
- Expanded: arguments rendered as a key/value table (JSON pretty-printed
  in a code block when nested); result as markdown (D1) or code block.
- `edit_file` / `write_file`: compute a unified diff client-side.
  Backend already returns the tool result; extend the tool event payload
  with `before`/`after` content hashes + optional inline `diff` field
  produced by the tool executor (Rust side, `similar` is NOT added —
  write a minimal LCS line-diff in `tool_runtime_service.rs`; output
  capped at 400 lines with head/tail elision).
- Approval provenance line on gated calls: `Allowed by rule <pattern>` /
  `Approved by user` / `Denied by user` / `Auto (mode: balanced)` —
  sourced from the existing `decision`/`ruleSource` fields already
  emitted on tool events (`agent_loop_service.rs:133-145`).

### D4: Provider states + key rotation

**Decision:**
- `NativeProvider.status` gains `transport_unavailable` as a computed
  state (bespoke `api_kind`, no custom base URL, native profile) in
  `provider_model_catalog_service.rs`; picker/composer render it with an
  explanatory tooltip and a "set custom base URL" affordance. Depends on
  `pr26-security-fixes` D3 (resolver returns TransportUnavailable).
- Update key: configured providers get an `Update key` button in both
  `SettingsModal` (`ModelProvidersPanel`) and the chat provider picker's
  card actions (a `Reconnect` button already exists there —
  `ChatPanel.tsx:2490-2506`; SettingsModal is the gap). Both open the
  existing key input path; `save_credential` upserts and unblocks.
  Existing secrets are never displayed; input is `type=password`.
- Per-provider error chip in the picker when `provider.error` is set,
  with a retry (targeted `native_provider_catalog_refresh`).

### D5: Schematic wizard — native path is the contract

**Decision:** The supported wizard flow is:
`ProjectSchematicTab → schematicWizardAction → skill injection
(basebuild-project-schematic) → native agent loop → ask_user cards →
answers → agent write_file → .basebuild/project-schematic.md →
SchematicUpdated event → tab/health refresh`.

**Verification seams (each gets a test):**
1. Skill content resolves and is injected as the turn prompt
   (existing `/skill:` path; registry resolution).
2. `execute_ask_user` round-trip: create → emit → resolve → answers JSON
   (Rust unit test exists for interaction service; add loop-level test).
3. `write_file` to `.basebuild/project-schematic.md` inside the workspace
   passes the gateway under `balanced` (mutating → prompt) and `auto`.
4. `set_project_schematic`/file write triggers `SchematicUpdated` and the
   frontend hook (`useProjectSchematic`) refetches.
5. e2e with mocked provider: scripted tool-call sequence
   (ask_user → write_file) drives the full UI; asserts question card
   rendered, answer submitted, schematic tab shows new content + health.

OMP RPC wizard path: untouched, untested here (maintenance-only).

### D6: Idea grounding — digest is visible and first-class

**Decision:**
- `generate_ideas`/`generate_categories` prompts already receive the
  focus directive + decision digest; make the digest **mandatory** in the
  assembled prompt (empty digest → explicit "no finished plans since last
  schematic update" line) and return grounding metadata on the result:
  `{ schematicSections: string[], finishedPlansCount, pickedCount,
  rejectedCount }` on `NativeGenerateIdeasResult` / pipeline stage output.
- UI: idea batch header renders "Grounded in: Vision, Current priority ·
  3 finished plans" (data from metadata, tooltip lists plan refs).
- New action "Generate from finished plans" (`planningActions.ts` +
  PlanningInspector button): same pipeline stage with an input flag that
  weights the digest section (prompt asks for follow-on/next-step ideas
  derived from what shipped).
- Anchor enforcement stays in `propose_ideas` executor: ideas without
  `anchor` are accepted but flagged; batch summary shows anchored vs
  outside-focus counts (already stored via `anchor: Option<String>`).

### D7: OpenSpec artifact quality gate

**Decision:** Add `openspec_service::validate_artifacts(change_dir) ->
ArtifactValidation { ok, errors: Vec<String>, warnings: Vec<String> }`
run inside the `generate_openspec` stage after `write_artifacts_atomic`:
- proposal.md exists, non-empty, has `## Why` and `## What Changes`.
- ≥1 `specs/*/spec.md` containing ≥1 `### Requirement:` and ≥1
  `#### Scenario:`.
- tasks.md parses to ≥1 task; 0 checked at generation time.
- On failure: plan stays `draft`; stage records the error; UI shows the
  failure on the plan card with a "view raw output" affordance; artifacts
  remain on disk for inspection (atomic write already guarantees no
  partial state).
- `validate_readiness` (dependency service) additionally calls
  `validate_artifacts` when `change_name` is set, folding results into
  its existing errors/warnings.

### D8: Testing strategy

- Rust: markdown has no Rust side; new tests target diff generation
  (`tool_runtime_service`), artifact validation (`openspec_service`),
  grounding metadata (`native_chat_service`/`pipeline_service`), and the
  ask_user/write_file loop seams (`agent_loop_service`).
- TS unit-ish: markdown parser gets a dedicated e2e-light spec asserting
  structural rendering for a fixture message (fences, lists, tables,
  raw-HTML-as-text, unterminated fence).
- e2e (mocked Tauri): message affordances, update-key flow,
  transport-unavailable picker state, schematic wizard loop, idea batch
  grounding header, artifact-gate failure surface.
- `npm run check:ui-invariants` covers tooltips/0px/one-stylesheet for
  all new controls.

## Risks

| Risk | Mitigation |
|---|---|
| In-house markdown misparses edge cases | Subset is deliberately small; unknown constructs fall back to paragraph text; parser never throws (fuzz with prefix-slicing test) |
| Per-frame re-parse cost on long streams | O(n) single pass; parse only the streaming message, memoize completed messages by content hash |
| Diff generation on huge files | Cap at 400 lines with elision; hash-compare short-circuit when unchanged |
| Retry duplicates side effects (tools ran) | Retry is a new turn — tool approvals gate again; marker links turns so history is honest |
| Artifact gate blocks legitimate minimal changes | Gate checks structure, not length; warnings (not errors) for thin-but-valid content |
| Provider state churn during catalog refresh | States computed from cached catalog + resolver result; refresh is explicit |
