# Design: Chat Experience Review Fixes

## Context

Four verified defects from the PR #26 session review, plus the test-layer
gaps that let them through. Each fix is small and local; the design notes
below record the non-obvious decisions.

## Decision 1: Settings save reuses the ChatPanel credential path

`ChatPanel` already calls
`nativeSaveProviderCredential({ providerId, label, apiKey, baseUrl })` and
handles errors inline (line 1540). `SettingsModal.saveKey` adopts the same
call shape:

```ts
await nativeSaveProviderCredential({
  providerId,
  label,
  apiKey: key,
  baseUrl: (baseUrlDrafts[providerId] ?? "").trim() || null,
});
await refresh();
```

- Draft clearing (`setKeyDrafts`, `setUpdateKeyId(null)`) moves *after* the
  successful save so a failed save keeps the user's input.
- Errors surface through the existing `setError` banner; no new UI.
- Backend `save_credential` already upserts (`INSERT … ON CONFLICT DO
  UPDATE`), so connect and rotate are the same call. No backend change.

## Decision 2: Comment lexing anchors at the cursor, not any line

The `m` flag turns `^` into a line anchor, which is wrong for a
cursor-relative lexer. Replace:

- `/^#.*$/m`   → `/^#[^\n]*/`
- `/^\/\/.*$/m` → `/^\/\/[^\n]*/`

`[^\n]*` bounds the match to the current line without needing `$`/`m` at
all. The block-comment regex (`/^\/\*[\s\S]*?\*\//`) is already anchored
correctly and stays.

While touching the lexers, remove the per-iteration `remaining =
content.slice(pos)` (O(n²) on large inputs, multiplied by streaming
re-parses). Use sticky regexes (`/y` flag with `lastIndex = pos`) or
index-based `startsWith`/`indexOf` checks. `parseInline` gets the same
treatment. Behavior is observable through `highlightCode`'s public
signature; unit-testable by asserting
`tokens.map(t => t.text).join("") === input` (lossless reassembly) for
comment-bearing fixtures.

Link guard: replace `/^https?:\/\//i.test(url) || /^[^/]/.test(url)` with
an explicit scheme check — allow `https?://`, and for everything else
require the URL to contain no `:` before the first `/`, `?`, or `#`
(i.e. genuinely relative). `javascript:`, `data:`, `vbscript:`, `file:`
fall through to literal text. Links remain non-navigating spans; this
closes the latent gap before anyone wires up link opening.

## Decision 3: Sensitive-path redaction happens in the tool runtime

Redaction must cover **both** the `diff` field and the `content`/`old_text`/
`new_text` members of the persisted `arguments` JSON — the arguments already
leak the full body today. Doing it in `tool_runtime_service` (where the path
is resolved) rather than in `record_tool_event` keeps one source of truth.

- Add `fn is_sensitive_path(path: &Path) -> bool` matching, case-insensitive:
  `.env` and `.env.*` file names, `*.pem`, `*.key`, `*.p12`, `*.pfx`,
  `id_rsa*`/`id_ed25519*`, `credentials.json`, `*.sqlite`/`*.db` under a
  dotdir, and anything under `.ssh/`, `.aws/`, `.gnupg/`, `.omp/`.
- For sensitive paths: `diff = None`, and the recorded arguments replace
  body fields with `"[redacted: sensitive path]"`. Path and byte counts
  stay visible so the user can still audit *what* was touched.
- The tool result content string (`Wrote N bytes to …`) is unaffected.

## Decision 4: Stat before reading the pre-image

`write_file` stats the target first; if `len() > MAX_READ_FILE_BYTES`
(1 MB, existing constant) it skips the pre-read and records
`diff = None` with the existing oversize summary convention. `edit_file`
must read the file to edit it, so it stats first and fails with an
explicit "file exceeds 1 MB edit limit" error instead of allocating
unbounded memory — consistent with `read_file`'s cap and honest about the
tool's contract.

## Decision 5: Mock fidelity before new tests

Fix the arg shape (`args.input.…`) first, then add the e2e that would have
caught Decision 1: fill key → Save → assert the provider row flips to
connected. Streaming coverage: extend `native_chat_send` mock with an
opt-in `stream-test` trigger that emits `native-chat://phase` and delta
events on a timer before resolving, so the phase indicator and incremental
markdown paths run under test. De-vacuate grounding/denial tests by seeding
the states they assert (configured non-local provider fixture; a denied
tool event fixture).

## Risks / Trade-offs

- Redaction list is heuristic; a secret in `notes.txt` still flows. That is
  the same trust boundary as the model itself reading the file — the list
  targets *systemic* credential locations, not DLP.
- Sticky-regex lexer refactor risks subtle tokenization drift; the lossless
  reassembly property test pins it.
- `edit_file` 1 MB cap is a behavior change for huge files; previously it
  "worked" by luck of available memory. Explicit error beats OOM.
