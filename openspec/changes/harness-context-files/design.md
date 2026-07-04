# Design: Harness Context Files

## Context

`native_chat_service.rs` creates sessions with no project context; `schematic_service.rs` already reads `.basebuild/project-schematic.md`; `read_skill` exists for bundled skills. OMP's behavior (reference bar): ancestor-walk AGENTS.md discovery stopping at the repo root, dot-directories skipped, skills exposed as metadata with on-demand bodies. `native-agent-loop` (planned) adds the token budget accounting this change feeds.

## Goals / Non-Goals

**Goals**: every native session knows the project's rules, cheaply and inspectably.

**Non-Goals**: glob-scoped rules (`globs:` frontmatter), always-apply rule packs, memory systems, MCP resources as context — later parity waves. No mid-turn context mutation.

## Decisions

**Decision**: One `context_service.rs` owns discovery + assembly, returning a structured `AssembledContext { parts: Vec<ContextPart> }` (source, kind, text, tokens, truncated) that `native_chat_service` serializes into the system prompt. — **Rationale**: structured parts make the inspector and budget accounting free; string-concat assembly would need re-parsing to display. **Alternatives**: assemble in TS — rejected, discovery needs FS walking and must also serve backend-initiated plan-run sessions.

**Decision**: Discovery cache keyed by `(project_path, file mtimes)`, invalidated lazily on session create/refresh — no file watcher. — **Rationale**: matches OMP (no watcher for commands either); watchers add platform-specific failure modes for a per-session read.

**Decision**: Nearer-file-last ordering (root AGENTS.md before project-dir AGENTS.md) so more specific instructions override general ones by recency in the prompt. Same rationale as OMP's level/depth merge.

**Decision**: Skills stay metadata-only in the prompt; explicitly reuse the existing `read_skill` command as the fetch path. — **Rationale**: bulk-injecting bodies would blow the budget this change is accountable to.

## Risks / Trade-offs

- Prompt growth on large AGENTS.md → per-part caps with explicit truncation markers; defaults conservative (schematic 4k tokens, each context file 8k).
- Refresh semantics mid-session can confuse ("why did behavior change?") → transcript system row on every refresh; never silent.
- Parallel work: `native_chat_service.rs` is touched by two in-flight changes → this change's injection point is the session-create seam only; land after `native-agent-loop`.

## Migration Plan

Additive only: settings keys for toggles/caps, no schema changes to existing tables. Rollback = disable all sources per project (assembly returns base prompt only).

## Open Questions

- Should plan-run sessions (`plan-pipeline-harness`) get a reduced context set (schematic may duplicate plan context)? Decide at integration; default to full set minus duplicates by source path.
- Cap defaults may need tuning against real models' effective windows once budget telemetry exists.
