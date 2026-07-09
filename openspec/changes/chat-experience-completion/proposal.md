# Proposal: Chat Experience Completion

## Why

Owner direction (2026-07-10, follows PR #26 comments 5–6): Basebuild's core
value is a **complete, polished, reliable native chat** for agentic coding —
tool calls, thinking, approvals, questions, all standard agentic GUI — plus
the planning loop around it: schematic → ideas → plans → OpenSpec artifacts.
Skills and slash commands stay native. OMP remains maintenance-only.

Code audit (2026-07-10, this branch) found the chat surface is structurally
present but incomplete in ways users hit every session:

1. **No markdown rendering — despite specs claiming it.**
   `openspec-chat-workbench` tasks 7.1/7.2 are checked, but zero markdown
   tokenizer/renderer exists: no matches for
   `markdown|marked|remark|rehype|highlight|dangerouslySetInnerHTML` in
   `ChatPanel.tsx`, `src/lib/`, or `package.json`. Assistant output renders
   as plain text. Every model reply with code fences, lists, or tables is
   unreadable. This is the single largest polish gap.

2. **No message-level affordances.** No copy button, no retry/regenerate,
   no edit-and-resend. Standard agentic-GUI table stakes are absent
   (`ChatPanel.tsx` message rendering ~1832–2067).

3. **Tool cards lack depth.** `ToolEventCard` (`ChatPanel.tsx:165-310`)
   renders name/status/summary, but: edit/write results have only basic
   diff highlighting (`globals.css:1101-1103, 1189-1191`); approval cards
   don't show which rule/mode produced the decision; long arguments/results
   have no structured expand.

4. **Provider reliability is uneven.**
   - Bespoke API kinds silently fall through to OMP RPC
     (`provider_client.rs:299-313`, `native_chat_service.rs:759-767`) —
     contradicts native-first; when OMP is absent the turn fails late with
     an opaque error instead of a typed pre-launch capability state.
   - A configured provider's API key cannot be updated from Settings or the
     composer rail (`SettingsModal.tsx:1398-1460` shows only Disconnect when
     configured; PR #26 comment 2, Bug 2). "All models working" requires
     working key rotation.
   - Transport/setup states exist in the backend (`SetupRequired`) but the
     UI has no distinct transport-unavailable presentation.

5. **Schematic wizard is verified only over the deprioritized OMP path.**
   The native path (skill injection → native `ask_user`
   (`agent_loop_service.rs:705-789`) → answers → `write_file` →
   `.basebuild/project-schematic.md` → `ProjectSchematicTab` refresh) has
   all primitives in place (`schematic_service.rs:40-45`,
   `tool_runtime_service.rs` workspace-scoped `write_file`) but no
   end-to-end test proves the loop produces a written schematic.

6. **Idea generation underuses its grounding.**
   `PlanningPromptService::decision_digest` (picked/rejected ideas + plans
   finished since the schematic's mtime) exists and is fed into pipeline
   prompts, but generation output does not tell the user what grounding was
   used, anchor coverage is partial, and "generate from implemented plans"
   is not a first-class entry point. Owner explicitly wants ideas generated
   from schematics **and implemented plans**.

7. **OpenSpec wrapper generates artifacts but with no quality gate.**
   `pipeline_service::generate_openspec` (lines 514-636) produces
   proposal/specs/tasks via the model and writes them atomically
   (`openspec_service::write_artifacts_atomic`), but nothing validates the
   result (missing sections, empty tasks, unparseable checkboxes) before
   the plan advances to `openspec` status. `openspec_runtime_service`
   detects the CLI but install/update are stubs and validation is unused.

## What Changes

### 1. Markdown + transcript rendering (agent-chat, tool-transcript-rendering)
- In-house safe markdown renderer emitting React elements (never raw HTML,
  no `dangerouslySetInnerHTML`): fenced code blocks with language label +
  copy button, inline code, bold/italic, ordered/unordered lists,
  blockquotes, tables, headings, links rendered as non-navigating text with
  full URL tooltip.
- Tokenized styles in `globals.css` only; 0px radius; mono for code.
- Tool cards: structured argument/result expansion, per-kind icons,
  unified diff view for `edit_file`/`write_file` results, approval cards
  show decision provenance (rule/mode/user) — text + icon, not color alone.

### 2. Message affordances (agent-chat)
- Copy message (clipboard) on every user/assistant message.
- Retry: re-run the last user turn (new request, prior assistant reply
  preserved in history until the new one lands).
- Edit-and-resend for the latest user message.
- All controls tooltip-covered, keyboard reachable.

### 3. Provider reliability (provider-model-catalog)
- Update-key affordance for configured providers in SettingsModal and the
  chat provider picker (backend upsert already exists).
- Typed pre-launch capability states in the picker/composer: `ready`,
  `setup_required`, `transport_unavailable` (bespoke kind, no native
  transport, no custom base URL) — no silent OMP launch from the native
  profile (transport isolation itself lands in `pr26-security-fixes`).
- Provider error surfaced per provider in picker with retry.

### 4. Schematic wizard native E2E (schematic-wizard)
- Verify and, where broken, fix the native loop:
  wizard start → skill injection → native `ask_user` question cards →
  answers → agent `write_file` → schematic written → tab/health refresh.
- Deterministic e2e with mocked provider tool calls; Rust tests for the
  write/inspect path already exist — add the missing seam tests.

### 5. Idea generation grounding (chat-idea-generation)
- "Generate ideas" always assembles: schematic focus directive + decision
  digest (finished plans since schematic mtime, picked/rejected ideas).
- Surface grounding provenance in the UI: which schematic sections and how
  many finished plans fed the batch.
- Anchor coverage: every generated idea carries `anchor` or is explicitly
  flagged "outside current focus"; batch results show anchor distribution.
- First-class entry point: "Generate from finished plans" action alongside
  the existing generate actions.

### 6. OpenSpec artifact quality gate (openspec-artifacts)
- Post-generation validation before a plan advances to `openspec`:
  proposal non-empty, ≥1 spec with ≥1 requirement + scenario, tasks.md
  parseable with ≥1 unchecked task; failures keep the plan in `draft`
  with a visible, actionable error and the raw output preserved.
- Task progress fidelity: checkbox parser tolerant of nested/indented
  tasks; progress shown in plan cards and context strip stays consistent.

## Non-Goals

- OMP RPC feature work, OMP credential writes, real-provider OMP wizard
  E2E (maintenance-only per architecture direction).
- Transport isolation enforcement (native profile never launches OMP) —
  already scoped in `pr26-security-fixes`, which this change depends on.
- Skill name validation — `pr26-security-fixes` task 1.x.
- Syntax highlighting beyond a minimal in-house tokenizer (no heavyweight
  highlight dependency in this change).
- Voice input, context compaction, message pagination (tracked in
  `chat-first-shell` / `session-compaction` / `chat-history-persistence`).
- Custom Basebuild planner replacing OpenSpec.

## Dependencies

- `pr26-security-fixes` (transport isolation + skill validation) should
  land first or together; this change's provider states assume bespoke
  kinds yield `transport_unavailable` rather than silently using OMP.
