# Tasks: Chat Experience Review Fixes

## 1. Settings credential save (BLOCKER)

- [x] 1.1 Wire `SettingsModal.saveKey` to `nativeSaveProviderCredential`
      with `providerId`, `label`, trimmed key, and optional base URL; move
      draft clearing after the successful save; surface errors via the
      existing error banner
- [x] 1.2 Fix `native_save_provider_credential` mock in
      `src/test-support/tauri-core.ts` to read `args.input.{providerId,
      apiKey, baseUrl}` per the real wrapper contract
- [x] 1.3 Add e2e: Settings → paste key → Save → provider row shows
      connected; Update key → Save → stays connected (rotation)
- [x] 1.4 Add e2e: save failure (mock rejects) keeps the draft and shows
      the error banner

## 2. Markdown highlighter corruption (BLOCKER)

- [x] 2.1 Fix line-comment regexes in `highlightCode` to anchor at the
      cursor (`/^#[^\n]*/`, `/^\/\/[^\n]*/`, no `m` flag)
- [x] 2.2 Add unit/e2e coverage: comment-bearing ts and py fences reassemble
      losslessly (`tokens.map(t => t.text).join("") === input`) and render
      the original line order
- [x] 2.3 Convert `highlightCode` and `parseInline` to cursor-indexed
      matching (sticky regex or index checks) — no per-iteration `slice`
- [x] 2.4 Tighten the inline link guard to explicit scheme allowlisting;
      `javascript:`/`data:`/`vbscript:` URLs render as literal text; update
      the comment to match the code

## 3. Tool runtime hardening

- [x] 3.1 Add `is_sensitive_path()` and redact `diff` + argument body fields
      for sensitive paths before persist/emit; keep path and byte counts
- [x] 3.2 `write_file`: stat before pre-image read; skip diff above
      `MAX_READ_FILE_BYTES`
- [x] 3.3 `edit_file`: stat before read; reject files above
      `MAX_READ_FILE_BYTES` with an explicit error
- [x] 3.4 Rust tests: sensitive-path redaction (`.env`, `id_rsa`,
      `.omp/agent.db`), oversize write skips diff, oversize edit rejects

## 4. Test-layer fidelity

- [x] 4.1 Add streaming mock trigger (`stream-test`) emitting
      `native-chat://phase` + delta events before resolve; assert phase
      indicator and incremental markdown rendering
- [x] 4.2 De-vacuate idea-grounding e2e: seed a configured non-local
      provider so generation returns grounding metadata; assert the batch
      header renders with sections and counts unconditionally
- [x] 4.3 Fix schematic-wizard denial-path e2e: seed a denied tool event
      and assert the denied UI state renders
- [x] 4.4 Implement missing mock commands used by ChatPanel
      (`native_chat_update_session_model`, `native_chat_clear_messages`);
      sort `native_chat_tool_events` by `sequence`

## 5. Verification

- [x] 5.1 `npx tsc --noEmit` and `npm run build` pass
- [x] 5.2 `cargo check` and `cargo test` pass (tool_runtime + native_chat)
- [x] 5.3 `npm run test:e2e` passes including new specs
- [x] 5.4 Manual probe: Settings key save connects a provider; a ts fence
      with `// comment` on line 2 renders verbatim
