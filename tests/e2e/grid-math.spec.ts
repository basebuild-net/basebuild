import { expect, test } from "@playwright/test";
import {
  CHAT_PANEL_MIN_WIDTH_PX,
  addChatBeside,
  clampRowWidths,
  emptyGrid,
  flattenChats,
  moveChat,
  reflowFlatList,
  removeChat,
  resizeAdjacent,
  resolveReorderIndex,
  rowShouldWrap,
  singleColumnGrid,
} from "../../src/lib/gridMath";

/** Pure unit tests for the grid-layout math (`chat-grid-layout`).
 *  Runs in Node via Playwright's test runner — no browser needed. */

test.describe("grid math: width clamping + rebalance", () => {
  test("clampRowWidths grows columns to fill the viewport", () => {
    const w = clampRowWidths({ a: 320, b: 320 }, ["a", "b"], 1000);
    expect(w.a + w.b).toBe(1000);
    expect(w.a).toBeGreaterThanOrEqual(CHAT_PANEL_MIN_WIDTH_PX);
    expect(w.b).toBeGreaterThanOrEqual(CHAT_PANEL_MIN_WIDTH_PX);
  });

  test("clampRowWidths shrinks columns to fit and floors at the minimum", () => {
    const w = clampRowWidths({ a: 600, b: 600 }, ["a", "b"], 800);
    expect(w.a + w.b).toBe(800);
    expect(w.a).toBeGreaterThanOrEqual(CHAT_PANEL_MIN_WIDTH_PX);
    expect(w.b).toBeGreaterThanOrEqual(CHAT_PANEL_MIN_WIDTH_PX);
  });

  test("resizeAdjacent respects the minimum on the shrinking side", () => {
    const w = resizeAdjacent({ a: 400, b: 350 }, "a", "b", 100);
    expect(w.b).toBe(CHAT_PANEL_MIN_WIDTH_PX);
    expect(w.a + w.b).toBe(750);
  });
});

test.describe("grid math: reorder index resolution", () => {
  test("dragging onto itself is a no-op", () => {
    expect(resolveReorderIndex(["a", "b", "c"], "a", 0, false)).toBeNull();
    expect(resolveReorderIndex(["a", "b", "c"], "a", 0, true)).toBeNull();
  });

  test("moving c before b resolves to index 1", () => {
    expect(resolveReorderIndex(["a", "b", "c"], "c", 1, false)).toBe(1);
  });

  test("moving a after c resolves to index 2", () => {
    expect(resolveReorderIndex(["a", "b", "c"], "a", 2, true)).toBe(2);
  });
});

test.describe("grid math: M×N reflow + add/remove/move", () => {
  test("moveChat across rows moves the chat and reflows", () => {
    const grid = { rows: [["a", "b"], ["c", "d"]], chatColumnWidths: { a: 400, b: 400, c: 400, d: 400 }, rowHeights: { 0: 300, 1: 300 } };
    const next = moveChat(grid, "a", 1, 0, 1000);
    expect(next.rows).toEqual([["b"], ["a", "c", "d"]]);
  });

  test("addChatBeside inserts after the anchor", () => {
    const grid = { rows: [["x", "y"]], chatColumnWidths: { x: 500, y: 500 }, rowHeights: {} };
    const next = addChatBeside(grid, "x", "z", 1000);
    expect(next.rows).toEqual([["x", "z", "y"]]);
  });

  test("removeChat retains the session (drops only from the grid)", () => {
    const grid = { rows: [["a", "b", "c"]], chatColumnWidths: { a: 300, b: 300, c: 300 }, rowHeights: {} };
    const next = removeChat(grid, "b");
    expect(next.rows).toEqual([["a", "c"]]);
    expect("b" in next.chatColumnWidths).toBe(false);
  });

  test("removeChat to empty keeps one empty row", () => {
    const grid = { rows: [["a"]], chatColumnWidths: { a: 300 }, rowHeights: {} };
    const next = removeChat(grid, "a");
    expect(next.rows).toEqual([[]]);
  });

  test("reflowFlatList wraps 5 chats into a 2×3 grid", () => {
    const next = reflowFlatList(["a", "b", "c", "d", "e"], 3, 1200);
    expect(next.rows).toEqual([["a", "b", "c"], ["d", "e"]]);
  });

  test("rowShouldWrap respects the minimum-width budget", () => {
    expect(rowShouldWrap(4, 1000)).toBe(true);
    expect(rowShouldWrap(3, 1000)).toBe(false);
  });

  test("flattenChats returns row-major order", () => {
    const grid = { rows: [["a", "b"], ["c"]], chatColumnWidths: {}, rowHeights: {} };
    expect(flattenChats(grid)).toEqual(["a", "b", "c"]);
  });

  test("singleColumnGrid + emptyGrid defaults", () => {
    expect(singleColumnGrid("x").rows).toEqual([["x"]]);
    expect(emptyGrid().rows).toEqual([[]]);
  });
});
