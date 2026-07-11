import { expect, test } from "@playwright/test";
import { buildChatTimeline } from "../../src/lib/chatTimeline";
import type { NativeChatMessage, NativeToolEvent } from "../../src/lib/native-chat";
import type { PendingInteraction } from "../../src/lib/interactions";

function makeMessage(partial: Partial<NativeChatMessage> & { role: "user" | "assistant" | "system" }): NativeChatMessage {
  return {
    id: partial.id ?? `msg-${Math.random().toString(36).slice(2)}`,
    sessionId: "sess-1",
    role: partial.role,
    content: partial.content ?? "",
    reasoning: partial.reasoning ?? null,
    sortOrder: partial.sortOrder ?? 0,
    providerId: partial.providerId ?? null,
    modelId: partial.modelId ?? null,
    effortLevel: partial.effortLevel ?? null,
    createdAt: partial.createdAt ?? 1000,
  };
}

function makeToolEvent(partial: Partial<NativeToolEvent> & { kind: string }): NativeToolEvent {
  return {
    id: partial.id ?? `te-${Math.random().toString(36).slice(2)}`,
    sessionId: "sess-1",
    messageId: partial.messageId ?? null,
    kind: partial.kind,
    status: partial.status ?? "success",
    summary: partial.summary ?? "",
    arguments: partial.arguments ?? null,
    diff: partial.diff ?? null,
    decision: partial.decision ?? null,
    ruleSource: partial.ruleSource ?? null,
    sequence: partial.sequence ?? 1,
    createdAt: partial.createdAt ?? 1000,
  };
}

function makeInteraction(partial: Partial<PendingInteraction> & { id: string }): PendingInteraction {
  return {
    id: partial.id,
    sessionId: "sess-1",
    questions: partial.questions ?? [],
    status: partial.status ?? "pending",
    createdAt: partial.createdAt ?? 1000,
  };
}

function kinds(events: ReturnType<typeof buildChatTimeline>): string[] {
  return events.map((e) => e.kind);
}

function ids(events: ReturnType<typeof buildChatTimeline>): string[] {
  return events.map((e) => e.id);
}

test.describe("buildChatTimeline: chronological ordering", () => {
  test("empty inputs produce empty timeline", () => {
    expect(buildChatTimeline([], [], [])).toEqual([]);
  });

  test("single user message produces one event", () => {
    const msgs = [makeMessage({ role: "user", content: "hello", id: "u1", createdAt: 1000 })];
    const events = buildChatTimeline(msgs, [], []);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("user");
    expect(events[0].id).toBe("u1");
  });

  test("user then assistant in chronological order", () => {
    const msgs = [
      makeMessage({ role: "user", content: "hello", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "hi there", id: "a1", createdAt: 2000 }),
    ];
    const events = buildChatTimeline(msgs, [], []);
    expect(ids(events)).toEqual(["u1", "a1"]);
  });

  test("tool event bound to message appears after that message", () => {
    const msgs = [
      makeMessage({ role: "user", content: "do something", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "ok", id: "a1", createdAt: 2000 }),
    ];
    const tools = [
      makeToolEvent({ id: "t1", kind: "read_file", messageId: "a1", createdAt: 2100, sequence: 1 }),
    ];
    const events = buildChatTimeline(msgs, tools, []);
    expect(ids(events)).toEqual(["u1", "a1", "t1"]);
  });

  test("multiple tool events bound to same message sort by sequence", () => {
    const msgs = [
      makeMessage({ role: "user", content: "do it", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "working", id: "a1", createdAt: 2000 }),
    ];
    const tools = [
      makeToolEvent({ id: "t3", kind: "run_command", messageId: "a1", createdAt: 2100, sequence: 3 }),
      makeToolEvent({ id: "t1", kind: "read_file", messageId: "a1", createdAt: 2100, sequence: 1 }),
      makeToolEvent({ id: "t2", kind: "edit_file", messageId: "a1", createdAt: 2100, sequence: 2 }),
    ];
    const events = buildChatTimeline(msgs, tools, []);
    // Tool events should appear after assistant, sorted by sequence.
    expect(ids(events)).toEqual(["u1", "a1", "t1", "t2", "t3"]);
  });

  test("live tool event (null messageId) sorts by its own createdAt, not at top", () => {
    const msgs = [
      makeMessage({ role: "user", content: "hello", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "working", id: "a1", createdAt: 2000 }),
    ];
    const tools = [
      makeToolEvent({ id: "live1", kind: "edit_file", messageId: null, createdAt: 2500, sequence: 1 }),
    ];
    const events = buildChatTimeline(msgs, tools, []);
    // Live tool should appear after assistant message, not before user.
    expect(ids(events)).toEqual(["u1", "a1", "live1"]);
  });

  test("live tool event with early createdAt still sorts correctly", () => {
    const msgs = [
      makeMessage({ role: "user", content: "hello", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "done", id: "a1", createdAt: 3000 }),
    ];
    const tools = [
      makeToolEvent({ id: "live1", kind: "read_file", messageId: null, createdAt: 1500, sequence: 1 }),
    ];
    const events = buildChatTimeline(msgs, tools, []);
    // Live tool at 1500 should appear between user (1000) and assistant (3000).
    expect(ids(events)).toEqual(["u1", "live1", "a1"]);
  });

  test("same-timestamp events break tie by index/sequence", () => {
    const msgs = [
      makeMessage({ role: "user", content: "hello", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "hi", id: "a1", createdAt: 1000 }),
    ];
    const tools = [
      makeToolEvent({ id: "t1", kind: "read_file", messageId: "a1", createdAt: 1000, sequence: 1 }),
      makeToolEvent({ id: "t2", kind: "edit_file", messageId: "a1", createdAt: 1000, sequence: 2 }),
    ];
    const events = buildChatTimeline(msgs, tools, []);
    // All same timestamp: user (index 0), assistant (index 1), t1 (seq 1), t2 (seq 2).
    // But index for messages is the array index, and for tools is the sequence.
    // The sort is (createdAt, index). User has index 0, assistant has index 1,
    // t1 has index 1 (sequence), t2 has index 2 (sequence).
    // So: user(0), assistant(1) and t1(1) tie → assistant comes first because
    // it was pushed first (stable sort). Then t1(1), t2(2).
    expect(ids(events)).toEqual(["u1", "a1", "t1", "t2"]);
  });

  test("interaction sorts by its createdAt", () => {
    const msgs = [
      makeMessage({ role: "user", content: "hello", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "question", id: "a1", createdAt: 2000 }),
    ];
    const intrs = [
      makeInteraction({ id: "i1", createdAt: 2500 }),
    ];
    const events = buildChatTimeline(msgs, [], intrs);
    expect(ids(events)).toEqual(["u1", "a1", "i1"]);
  });

  test("interaction with early createdAt sorts between messages", () => {
    const msgs = [
      makeMessage({ role: "user", content: "hello", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "answer", id: "a1", createdAt: 3000 }),
    ];
    const intrs = [
      makeInteraction({ id: "i1", createdAt: 1500 }),
    ];
    const events = buildChatTimeline(msgs, [], intrs);
    expect(ids(events)).toEqual(["u1", "i1", "a1"]);
  });

  test("multi-turn: tool events from turn 1 don't interleave with turn 2", () => {
    const msgs = [
      makeMessage({ role: "user", content: "turn 1", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "response 1", id: "a1", createdAt: 2000 }),
      makeMessage({ role: "user", content: "turn 2", id: "u2", createdAt: 3000 }),
      makeMessage({ role: "assistant", content: "response 2", id: "a2", createdAt: 4000 }),
    ];
    const tools = [
      makeToolEvent({ id: "t1", kind: "read_file", messageId: "a1", createdAt: 2100, sequence: 1 }),
      makeToolEvent({ id: "t2", kind: "edit_file", messageId: "a1", createdAt: 2200, sequence: 2 }),
    ];
    const events = buildChatTimeline(msgs, tools, []);
    expect(ids(events)).toEqual(["u1", "a1", "t1", "t2", "u2", "a2"]);
  });

  test("interleaved reasoning + tool + message in correct order", () => {
    const msgs = [
      makeMessage({ role: "user", content: "fix the bug", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "I'll read then edit", id: "a1", createdAt: 2000, reasoning: "thinking about the bug" }),
    ];
    const tools = [
      makeToolEvent({ id: "t1", kind: "read_file", messageId: "a1", createdAt: 2100, sequence: 1 }),
      makeToolEvent({ id: "t2", kind: "edit_file", messageId: "a1", createdAt: 2300, sequence: 2 }),
      makeToolEvent({ id: "t3", kind: "run_command", messageId: "a1", createdAt: 2500, sequence: 3 }),
    ];
    const events = buildChatTimeline(msgs, tools, []);
    // Reasoning renders as part of the assistant message row, not a separate event.
    // The timeline is: user, assistant (with reasoning), tool1, tool2, tool3.
    expect(kinds(events)).toEqual(["user", "assistant", "tool", "tool", "tool"]);
    expect(ids(events)).toEqual(["u1", "a1", "t1", "t2", "t3"]);
  });

  test("live tool events with different timestamps sort chronologically", () => {
    const msgs = [
      makeMessage({ role: "user", content: "go", id: "u1", createdAt: 1000 }),
    ];
    const tools = [
      makeToolEvent({ id: "live3", kind: "run_command", messageId: null, createdAt: 3000, sequence: 3 }),
      makeToolEvent({ id: "live1", kind: "read_file", messageId: null, createdAt: 1500, sequence: 1 }),
      makeToolEvent({ id: "live2", kind: "edit_file", messageId: null, createdAt: 2000, sequence: 2 }),
    ];
    const events = buildChatTimeline(msgs, tools, []);
    expect(ids(events)).toEqual(["u1", "live1", "live2", "live3"]);
  });

  test("mixed bound and live tool events sort by createdAt", () => {
    const msgs = [
      makeMessage({ role: "user", content: "go", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "working", id: "a1", createdAt: 2000 }),
    ];
    const tools = [
      makeToolEvent({ id: "bound1", kind: "read_file", messageId: "a1", createdAt: 2100, sequence: 1 }),
      makeToolEvent({ id: "live1", kind: "edit_file", messageId: null, createdAt: 1500, sequence: 1 }),
      makeToolEvent({ id: "bound2", kind: "run_command", messageId: "a1", createdAt: 2300, sequence: 2 }),
    ];
    const events = buildChatTimeline(msgs, tools, []);
    // live1 (1500) between user (1000) and assistant (2000)
    // bound1 (2100) and bound2 (2300) after assistant
    expect(ids(events)).toEqual(["u1", "live1", "a1", "bound1", "bound2"]);
  });

  test("null createdAt on message sorts as 0 (earliest)", () => {
    const msgs = [
      makeMessage({ role: "user", content: "late", id: "u1", createdAt: 3000 }),
      makeMessage({ role: "assistant", content: "early-null", id: "a1", createdAt: null as unknown as number }),
    ];
    const events = buildChatTimeline(msgs, [], []);
    // null createdAt → 0 → sorts first
    expect(ids(events)).toEqual(["a1", "u1"]);
  });

  test("many sequential tool events maintain order", () => {
    const msgs = [
      makeMessage({ role: "user", content: "big task", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "working", id: "a1", createdAt: 2000 }),
    ];
    const tools: NativeToolEvent[] = [];
    for (let i = 1; i <= 10; i++) {
      tools.push(makeToolEvent({
        id: `t${i}`,
        kind: `step_${i}`,
        messageId: "a1",
        createdAt: 2000 + i * 100,
        sequence: i,
      }));
    }
    const events = buildChatTimeline(msgs, tools, []);
    expect(ids(events)).toEqual(["u1", "a1", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"]);
  });

  test("system messages sort by createdAt", () => {
    const msgs = [
      makeMessage({ role: "user", content: "hello", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "system", content: "stopped", id: "s1", createdAt: 1500 }),
      makeMessage({ role: "assistant", content: "hi", id: "a1", createdAt: 2000 }),
    ];
    const events = buildChatTimeline(msgs, [], []);
    expect(ids(events)).toEqual(["u1", "s1", "a1"]);
  });

  test("interaction sorts before tool event at same timestamp (by index)", () => {
    const msgs = [
      makeMessage({ role: "user", content: "go", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "working", id: "a1", createdAt: 2000 }),
    ];
    const tools = [
      makeToolEvent({ id: "t1", kind: "read_file", messageId: "a1", createdAt: 2500, sequence: 1 }),
    ];
    const intrs = [
      makeInteraction({ id: "i1", createdAt: 2500 }),
    ];
    const events = buildChatTimeline(msgs, tools, intrs);
    // Both at 2500. Tool has index=sequence=1. Interaction has index=events.length
    // at the time it was pushed (after all messages and live tools). Messages:
    // u1(0), a1(1), t1(seq 1). Then interaction gets index 3 (events.length after
    // pushing u1, a1, t1). So t1(1) < i1(3) → t1 first.
    expect(ids(events)).toEqual(["u1", "a1", "t1", "i1"]);
  });

  test("three-turn conversation with tools in each turn", () => {
    const msgs = [
      makeMessage({ role: "user", content: "turn 1", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "resp 1", id: "a1", createdAt: 2000 }),
      makeMessage({ role: "user", content: "turn 2", id: "u2", createdAt: 3000 }),
      makeMessage({ role: "assistant", content: "resp 2", id: "a2", createdAt: 4000 }),
      makeMessage({ role: "user", content: "turn 3", id: "u3", createdAt: 5000 }),
      makeMessage({ role: "assistant", content: "resp 3", id: "a3", createdAt: 6000 }),
    ];
    const tools = [
      makeToolEvent({ id: "t1a", kind: "read_file", messageId: "a1", createdAt: 2100, sequence: 1 }),
      makeToolEvent({ id: "t2a", kind: "edit_file", messageId: "a2", createdAt: 4100, sequence: 1 }),
      makeToolEvent({ id: "t3a", kind: "run_command", messageId: "a3", createdAt: 6100, sequence: 1 }),
    ];
    const events = buildChatTimeline(msgs, tools, []);
    expect(ids(events)).toEqual(["u1", "a1", "t1a", "u2", "a2", "t2a", "u3", "a3", "t3a"]);
  });

  test("rapid sequential sends maintain chronological order", () => {
    const msgs = [
      makeMessage({ role: "user", content: "msg 1", id: "u1", createdAt: 1000 }),
      makeMessage({ role: "assistant", content: "resp 1", id: "a1", createdAt: 1001 }),
      makeMessage({ role: "user", content: "msg 2", id: "u2", createdAt: 1002 }),
      makeMessage({ role: "assistant", content: "resp 2", id: "a2", createdAt: 1003 }),
      makeMessage({ role: "user", content: "msg 3", id: "u3", createdAt: 1004 }),
      makeMessage({ role: "assistant", content: "resp 3", id: "a3", createdAt: 1005 }),
    ];
    const events = buildChatTimeline(msgs, [], []);
    expect(ids(events)).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
  });
});
