# Proposal: Chat Experience Review Fixes

## Why

Code review of the chat-experience session (`558f0d1..164a407` on
`codex/mvp-workflow-audit`, PR #26) verified the new chat system end to end:
markdown rendering, tool card depth, provider reliability, native schematic
wizard, idea grounding, and the artifact quality gate. Static review plus a
live Playwright probe against the e2e harness confirmed most flows work, but
found two broken user-facing features, two backend security gaps, and a test
layer that cannot catch any of them.

Verified defects (reproduced live unless noted):

1. **Settings API-key save is a silent no-op.** `SettingsModal.saveKey`
   (`SettingsModal.tsx:1338-1355`) clears the draft, closes the form, and
   refreshes the catalog — but never calls `nativeSaveProviderCredential`.
   Both callers are dead: the unconnected "paste API key → Save" flow
   (line 1499) and the connected "Update key" flow (line 1442) introduced by
   commit eb1354b. Reproduced: entered a key for Anthropic, clicked Save →
   input cleared, provider stayed unconfigured, no error shown. Key rotation
   from Settings — the headline of "provider reliability" — does not work.
   ChatPanel's own login form (line 1540) works; only Settings is broken.

2. **Syntax highlighter corrupts code blocks containing line comments.**
   `highlightCode` (`markdown.ts:342,349`) matches line comments with
   `/^#.*$/m` and `/^\/\/.*$/m`. With the `m` flag, `^` anchors at any line
   start, so the lexer matches a comment on a *later* line, emits it at the
   *current* position, and advances the cursor by its length. Reproduced:
   `const x = 1;\n// a comment\nconst y = 2;` renders as
   `// a comment// a commentt\nconst y = 2;` — line 1 destroyed, comment
   duplicated. Any assistant code block with a comment after line 1 displays
   garbage. The e2e fixture's fence contains no comments, so tests pass.

3. **Tool events persist full file bodies with no sensitive-path redaction.**
   `write_file`/`edit_file` results carry a unified diff of verbatim old/new
   content (`tool_runtime_service.rs:517,554`), and the tool event's
   `arguments` JSON already contains the full `content` argument. Both are
   persisted to `native_tool_events` and emitted on
   `native-chat://tool-event`. If the agent writes `.env`, key files, or any
   credential store, secrets land in the chat DB and event bus — against the
   repo's security posture.

4. **Unbounded read before diff.** `write_file` calls
   `std::fs::read_to_string` on the pre-existing file with no size cap
   (`tool_runtime_service.rs:506`); `edit_file` likewise (line 542). The
   2000-line LCS fallback in `compute_diff` runs only *after* the full
   allocation. A write to a path holding a multi-GB file OOMs the app.

5. **The e2e mock layer cannot catch any of the above.**
   `native_save_provider_credential` in `tauri-core.ts:986` reads top-level
   `args.providerId`/`args.apiKey`, but the real wrapper sends `{ input }` —
   a faithful mock would still store `"unknown"`/`"test-key"`. The
   credential-lifecycle spec never saves a key end to end. `native_chat_send`
   resolves synchronously, so streaming deltas/phases/approval interactions
   are never exercised. The idea-grounding assertions are conditional
   (`if (headerCount > 0)`) and pass vacuously; the schematic-wizard "denial
   path" test asserts the approved fixture doesn't say "denied".

## What Changes

- **provider-model-catalog**: wire `SettingsModal.saveKey` to
  `nativeSaveProviderCredential` (both connect and update flows), surface
  save failures inline, and use the unused `label` argument. Add a spec
  requirement for credential save/rotation from Settings.
- **tool-transcript-rendering**: fix the line-comment lexer anchors (drop
  the `m` flag; match `[^\n]*` at cursor), make lexers single-pass without
  per-iteration `slice`, and tighten the link guard to an explicit
  `http(s)` allowlist so the code matches its comment.
- **core-tool-runtime**: stat-then-skip diff for oversized pre-images
  (reuse `MAX_READ_FILE_BYTES`), and redact diff + content arguments for
  sensitive paths (dotenv, key material, credential DBs) before persist/emit.
- **testing-automation**: fix the `native_save_provider_credential` mock arg
  shape, add an e2e that saves a key and asserts the provider connects, add
  streaming-phase mock coverage, de-vacuate the grounding and denial-path
  tests.

## Impact

- Affected specs: `provider-model-catalog`, `tool-transcript-rendering`,
  `core-tool-runtime`, `testing-automation`
- Affected code: `src/components/layout/SettingsModal.tsx`,
  `src/lib/markdown.ts`, `src-tauri/src/services/tool_runtime_service.rs`,
  `src/test-support/tauri-core.ts`, `tests/e2e/*`
- No wire or schema changes; `native_tool_events.diff` stays nullable.

## Non-Goals

- OMP credential disconnect (tracked in `pr26-security-fixes`).
- ChatPanel effect-hygiene refactors (listener re-registration windows,
  module-level expansion map, handleSend decomposition) — tracked as
  warnings in the PR review, not regressions from this session.
- Main-chunk code-splitting regression (518.79 kB > 500 kB budget) — follow
  the existing lazy-loading pattern from mvp-workflow-hardening in a
  separate perf pass.
