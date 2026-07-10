# Tasks: Chat Experience Completion

## 1. Markdown Renderer (in-house, safe)

- [x] 1.1 Add `src/lib/markdown.ts`: block tokenizer (`fence`, `heading`,
      `list`, `blockquote`, `table`, `paragraph`) + inline tokenizer
      (`code`, `bold`, `italic`, `link`) producing a typed `MdBlock[]`
      AST. Single pass O(n); never throws; unterminated fence treated as
      code-to-end (streaming prefix safe). `type` over `interface` for
      all shapes.
- [x] 1.2 Add `src/components/panels/MarkdownView.tsx`: AST → React
      elements only (no HTML strings, no `dangerouslySetInnerHTML`);
      raw HTML in source rendered as literal text; links render as
      label + host text with full URL in `title=`, no navigation.
- [x] 1.3 Fenced blocks: language label header, copy button
      (`navigator.clipboard`, toast feedback, `title=` tooltip),
      verbatim content preservation.
- [x] 1.4 Minimal in-house highlight pass (comments/strings/numbers/small
      keyword sets for ts/js/rust/py/json/bash/css/html); unknown
      languages render unhighlighted; no dependency added.
- [x] 1.5 Wire `MarkdownView` into `ChatPanel.tsx` for assistant message
      bodies, thinking-block bodies, and command notices; user messages
      remain plain pre-wrapped text. Memoize completed messages by
      content hash; only the streaming message re-parses per frame.
- [x] 1.6 Add `.md-*` classes to `src/styles/globals.css` (code block,
      inline code, table, list, blockquote, heading scale inside chat,
      copy button) — 0px radius, tokenized colors, one stylesheet.
- [x] 1.7 e2e `tests/e2e/chat-markdown.spec.ts`: fixture assistant
      message renders fence+copy, table, list, blockquote; `<script>`
      renders as text; unterminated fence renders as code; user message
      with markdown stays plain.

## 2. Message Action Rail

- [x] 2.1 Add per-message action rail in `ChatPanel.tsx`: Copy on all
      persisted messages; Retry on latest assistant message;
      Edit-and-resend on latest user message. Buttons tab-reachable,
      `title=` tooltips, styles in `globals.css`.
- [x] 2.2 Copy: clipboard write of raw source text with success/failure
      toast.
- [x] 2.3 Retry: re-issue last user message via existing send path with
      current provider/model/effort; append-only (prior assistant reply
      preserved); timeline marker links original and retried turns.
- [x] 2.4 Edit-and-resend: prefill + focus composer with latest user
      message text; send appends a new turn.
- [x] 2.5 e2e `tests/e2e/message-actions.spec.ts`: copy visible and
      clickable, retry produces a new turn with marker, edit prefills
      composer; rail controls covered by `check:ui-invariants`.

## 3. Tool Card Depth

- [x] 3.1 Backend diff: add a minimal LCS line-diff helper in
      `src-tauri/src/services/tool_runtime_service.rs`; `edit_file` /
      `write_file` results carry a unified `diff` field (cap 400 lines,
      head/tail elision marker, unchanged → explicit "no changes");
      extend the tool event payload accordingly
      (`models/native_chat.rs` NativeToolEvent additive field).
- [x] 3.2 Rust tests: diff added/removed counts, elision over cap,
      unchanged short-circuit, multi-hunk output.
- [x] 3.3 Frontend `ToolEventCard` (`ChatPanel.tsx:165-310`): per-kind
      icons, duration display, expanded key/value argument table with
      nested JSON pretty-printed, result via `MarkdownView` or code
      block, diff rendering with add/remove line classes
      (`globals.css`).
- [x] 3.4 Approval provenance line on gated tool cards from existing
      `decision`/`ruleSource` fields: "Approved by user" / "Denied by
      user" / "Allowed by rule `<pattern>`" / "Auto (mode)" — text +
      icon, tooltip carries rule source.
- [x] 3.5 Expansion state persistence: expanded cards stay expanded
      while the turn streams (key by tool call id, not index).
- [x] 3.6 e2e: extend `tests/e2e/streaming-indicators.spec.ts` or add
      `tool-card-depth.spec.ts` — expanded card shows argument table +
      diff lines + provenance text for a fixture edit tool event.

## 4. Provider Reliability

- [x] 4.1 `SettingsModal.tsx` (`ModelProvidersPanel`): add Update key
      button beside Disconnect when `p.configured`; opens the existing
      password key input + Save (upsert via
      `nativeSaveProviderCredential`); never displays stored secret.
- [x] 4.2 Chat provider picker (`ChatPanel.tsx:2440-2510`): rename
      configured-state "Reconnect" to "Update key" with update-mode
      modal title/copy; keep Disconnect.
- [x] 4.3 Backend: compute `transport_unavailable` status in
      `provider_model_catalog_service.rs` for models whose `api_kind`
      has no native transport and no custom base URL (consumes
      `pr26-security-fixes` resolver change); expose on
      `NativeProvider.status` / model capability flags; mirror type in
      `src/lib/native-chat.ts`.
- [x] 4.4 Picker/composer render `transport_unavailable` with
      explanation tooltip + custom-base-URL affordance; selecting such
      a model never starts a request (draft preserved).
- [x] 4.5 Per-provider error chip in picker when `provider.error` set;
      tooltip carries error text; retry triggers targeted
      `native_provider_catalog_refresh(providerId)`.
- [x] 4.6 Rust tests: catalog marks bespoke-kind-no-base-url providers
      `transport_unavailable`; custom base URL flips them to ready;
      save_credential upsert path unchanged (existing tests still pass).
- [x] 4.7 e2e: extend `tests/e2e/provider-credential-lifecycle.spec.ts` —
      update-key flow on a configured provider; transport-unavailable
      state renders for a fixture bespoke provider.

## 5. Schematic Wizard — Native Round Trip

- [x] 5.1 Rust seam test (`agent_loop_service.rs`): ask_user →
      resolve_interaction returns answers JSON to the parked turn
      (loop-level, using the interaction service test harness).
- [x] 5.2 Rust test (`tool_runtime_service.rs`): `write_file` to
      `.basebuild/project-schematic.md` inside a temp workspace
      succeeds and is workspace-scoped (traversal already covered —
      assert the schematic path specifically).
- [x] 5.3 Verify `SchematicUpdated` emission covers agent-driven file
      writes: if the agent writes via `write_file` (not
      `set_project_schematic`), ensure the schematic tab still
      refreshes — add an mtime watch or post-turn inspect hook in the
      native send path; test the chosen mechanism.
- [x] 5.4 e2e `tests/e2e/schematic-wizard-native.spec.ts` (mocked
      provider scripted tool calls): start wizard from schematic tab →
      question card renders → answer → `write_file` fixture → schematic
      tab shows new content + recomputed health; cancel path leaves the
      prior schematic intact.
- [x] 5.5 Wizard denial path: approval denial of the schematic write
      leaves file untouched and the turn ends gracefully (e2e assertion
      in 5.4 spec).

## 6. Idea Grounding

- [x] 6.1 Backend: make the decision digest mandatory in
      `generate_ideas` / `generate_categories` prompt assembly
      (`native_chat_service.rs:1116-1238`,
      `pipeline_service.rs:148-218,301-448`); empty digest → explicit
      "no decisions since schematic update" prompt line.
- [x] 6.2 Backend: return grounding metadata
      (`schematic_sections`, `finished_plans` refs + count,
      `picked_count`, `rejected_count`) on
      `NativeGenerateIdeasResult` and the pipeline stage output
      (additive serde fields; mirror in `src/lib/native-chat.ts` /
      `src/lib/planPipeline.ts` types).
- [x] 6.3 Frontend: idea batch header renders grounding provenance
      ("Grounded in: <sections> · N finished plans"), plan refs in
      tooltip; anchored vs outside-focus counts in the batch summary;
      unanchored idea cards show the outside-current-focus flag
      (`IdeasPanel.tsx`, `PlanningInspector.tsx`).
- [x] 6.4 New action "Generate from finished plans"
      (`planningActions.ts` + PlanningInspector button): digest-weighted
      prompt variant; disabled with tooltip when no finished plans since
      schematic update.
- [x] 6.5 Rust tests: digest included when finished plans exist; empty
      digest explicit; metadata counts correct; digest-weighted variant
      includes plan refs.
- [x] 6.6 e2e: idea batch header shows grounding text for fixture data;
      generate-from-finished-plans disabled state renders tooltip.

## 7. OpenSpec Artifact Quality Gate

- [ ] 7.1 Add `validate_artifacts(change_dir) -> ArtifactValidation` to
      `src-tauri/src/services/openspec_service.rs`: proposal non-empty
      with Why/What-Changes; ≥1 spec with ≥1 requirement + scenario
      heading; tasks.md ≥1 task, 0 checked; errors vs warnings split.
- [ ] 7.2 Wire into `pipeline_service::generate_openspec` after
      `write_artifacts_atomic`: failure keeps plan `draft`, records
      stage error, preserves artifacts on disk; success advances status
      and links `change_name` (existing path).
- [ ] 7.3 Fold `validate_artifacts` into
      `PlanDependencyService::validate_readiness` when `change_name`
      is set (errors → errors, warnings → warnings).
- [ ] 7.4 Frontend: plan card failure surface — validation error text +
      "view raw output" affordance (raw generation output persisted on
      the pipeline run record).
- [ ] 7.5 Task progress parser: count nested/indented checkboxes and
      mixed markers in `openspec_service::parse_task_progress`
      (lines 165-183); one parser feeds plan cards, context strip, and
      run completion (`plan_runner_service::evaluate_checklist_completion`).
- [ ] 7.6 Rust tests: gate passes minimal-valid change; fails
      zero-task tasks.md; fails missing scenario; warnings for thin
      content; nested checkbox counting; progress consistency between
      parser call sites.

## 8. Verification

- [ ] 8.1 `npx tsc --noEmit` passes.
- [ ] 8.2 `npm run build` passes.
- [ ] 8.3 `cd src-tauri && cargo check` passes.
- [ ] 8.4 `cd src-tauri && cargo test` — new tests from 3.2, 4.6, 5.1,
      5.2, 6.5, 7.6 pass; existing native_chat/plan/pipeline suites
      stay green.
- [ ] 8.5 Targeted e2e: chat-markdown, message-actions, tool-card-depth,
      provider-credential-lifecycle, schematic-wizard-native, plus
      existing native-chat / streaming-indicators / interactive-elements
      / command-palette specs pass.
- [ ] 8.6 `npm run check:ui-invariants` passes (tooltips, 0px radius,
      one stylesheet) for all new controls.
- [ ] 8.7 UI smoke with screenshots: markdown-rich assistant reply
      (fences/tables/lists), expanded edit tool card with diff +
      provenance, message action rail, update-key flow,
      transport-unavailable picker state, wizard question → written
      schematic, grounded idea batch header.

## 9. Docs & Roadmap

- [ ] 9.1 `docs/agents/agent-runtime.md`: markdown rendering contract
      (React-elements-only, link policy), message affordances, tool
      card diff/provenance, provider availability states, native
      wizard round trip, grounding metadata, artifact quality gate.
- [ ] 9.2 `docs/agents/design-system.md` + `DESIGN.md`: `.md-*` and
      action-rail classes, diff line classes, provider state chips.
- [ ] 9.3 `docs/agents/testing.md`: new e2e specs and the mocked
      scripted-tool-call pattern for wizard tests.
- [ ] 9.4 Refresh `openspec/ROADMAP.md` via
      `node scripts/openspec-status.mjs --write` + narrative entry
      placing this change relative to `pr26-security-fixes` and
      `openspec-chat-workbench` (whose 7.1/7.2 markdown claims are
      superseded by this change's real implementation).
