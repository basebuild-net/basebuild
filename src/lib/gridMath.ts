/**
 * Pure grid-layout math for the multi-chat grid (`chat-grid-layout`).
 *
 * Layout model: rows of columns. `rows: string[][]` is an ordered list of
 * rows, each an ordered list of chat ids. `chatColumnWidths` maps a chat id
 * to its pixel width. `rowHeights` maps a row index to its pixel height.
 *
 * Ported from the reference IDE's drag/resize logic, adapted to the
 * rows-of-columns M×N model (the reference only supports 1×N). The math is
 * intentionally pure and side-effect-free so it can be unit-tested in
 * isolation.
 *
 * Reference: dream IDE (MIT) — `chat-stack`/`standard-tabs` drag logic.
 * Attribution: docs/agents/design-system.md cites the port source.
 */

/** Minimum chat column width in pixels. A column never collapses below this
 *  during resize, so the composer rail and input stay usable. */
export const CHAT_PANEL_MIN_WIDTH_PX = 320;

/** Minimum row height in pixels. Keeps the composer + a few messages visible. */
export const CHAT_ROW_MIN_HEIGHT_PX = 200;

export type ChatGrid = {
  /** Ordered rows of chat ids. `rows[0]` is the top row. */
  rows: string[][];
  /** Per-chat pixel width. Absent = equal share. */
  chatColumnWidths: Record<string, number>;
  /** Per-row pixel height, keyed by row index. Absent = equal share. */
  rowHeights: Record<number, number>;
};

/** A grid with zero chats: one empty row, no widths. */
export function emptyGrid(): ChatGrid {
  return { rows: [[]], chatColumnWidths: {}, rowHeights: {} };
}

/** A grid seeded from a single chat id (the legacy 1×1 default). */
export function singleColumnGrid(chatId: string): ChatGrid {
  return { rows: [[chatId]], chatColumnWidths: {}, rowHeights: {} };
}

/** Flatten the grid into a single ordered list of chat ids (row-major). */
export function flattenChats(grid: ChatGrid): string[] {
  return grid.rows.flat();
}

/** Count of visible (non-closing) chats across all rows. */
export function chatCount(grid: ChatGrid): number {
  return flattenChats(grid).length;
}

/** Clamp a single width to the minimum. */
export function clampWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return CHAT_PANEL_MIN_WIDTH_PX;
  return Math.max(width, CHAT_PANEL_MIN_WIDTH_PX);
}

/**
 * Clamp a row's column widths so they fit `viewportWidth` without overflow.
 * Each width is floored at `CHAT_PANEL_MIN_WIDTH_PX`; if the row's total
 * exceeds the viewport, widths are scaled down proportionally (keeping the
 * minimum). If the total is smaller than the viewport, widths are grown
 * proportionally to fill it (so closing one column expands the others).
 *
 * Returns the updated `chatColumnWidths` map (a new object; input untouched).
 */
export function clampRowWidths(
  widths: Record<string, number>,
  chatIds: string[],
  viewportWidth: number,
): Record<string, number> {
  const next: Record<string, number> = { ...widths };
  const present = chatIds.filter((id) => id in next);
  if (present.length === 0) return next;
  // Floor every present width at the minimum first.
  for (const id of present) {
    next[id] = clampWidth(next[id]);
  }
  const total = present.reduce((sum, id) => sum + next[id], 0);
  if (total === viewportWidth) return next;
  if (total > viewportWidth) {
    // Scale down. If any width hits the floor, clamp it and redistribute the
    // remainder to the others.
    shrinkToFit(next, present, viewportWidth);
  } else {
    // Scale up to fill the viewport.
    const scale = viewportWidth / total;
    for (const id of present) {
      next[id] = Math.round(next[id] * scale);
    }
    // Rounding can leave a few px; add them to the last column.
    const after = present.reduce((sum, id) => sum + next[id], 0);
    if (after < viewportWidth) {
      next[present[present.length - 1]] += viewportWidth - after;
    }
  }
  return next;
}

/** Iteratively shrink widths, clamping each to the minimum as it hits it. */
function shrinkToFit(
  widths: Record<string, number>,
  ids: string[],
  target: number,
): void {
  const minTotal = ids.length * CHAT_PANEL_MIN_WIDTH_PX;
  if (target <= minTotal) {
    // Everything goes to the minimum.
    for (const id of ids) widths[id] = CHAT_PANEL_MIN_WIDTH_PX;
    return;
  }
  const total = ids.reduce((sum, id) => sum + widths[id], 0);
  const scale = target / total;
  for (const id of ids) {
    const scaled = Math.round(widths[id] * scale);
    widths[id] = Math.max(scaled, CHAT_PANEL_MIN_WIDTH_PX);
  }
  // Rounding drift: adjust the widest column.
  const after = ids.reduce((sum, id) => sum + widths[id], 0);
  if (after !== target) {
    const widest = [...ids].sort((a, b) => widths[b] - widths[a])[0];
    widths[widest] = Math.max(CHAT_PANEL_MIN_WIDTH_PX, widths[widest] + (target - after));
  }
}

/**
 * Resize two adjacent columns by a delta: the left column grows by `delta`,
 * the right shrinks by `delta`, but neither drops below the minimum. Returns
 * the updated widths (new object). If `delta` would breach a minimum, it is
 * clamped so the constrained column sits exactly at the minimum.
 */
export function resizeAdjacent(
  widths: Record<string, number>,
  leftId: string,
  rightId: string,
  delta: number,
): Record<string, number> {
  const left = clampWidth(widths[leftId] ?? CHAT_PANEL_MIN_WIDTH_PX);
  const right = clampWidth(widths[rightId] ?? CHAT_PANEL_MIN_WIDTH_PX);
  let newLeft = left + delta;
  let newRight = right - delta;
  if (newLeft < CHAT_PANEL_MIN_WIDTH_PX) {
    newRight -= CHAT_PANEL_MIN_WIDTH_PX - newLeft;
    newLeft = CHAT_PANEL_MIN_WIDTH_PX;
  }
  if (newRight < CHAT_PANEL_MIN_WIDTH_PX) {
    newLeft -= CHAT_PANEL_MIN_WIDTH_PX - newRight;
    newRight = CHAT_PANEL_MIN_WIDTH_PX;
  }
  return { ...widths, [leftId]: newLeft, [rightId]: newRight };
}

/**
 * Resolve the drop index for a reorder drag: given a flat list of chat ids,
 * the dragged chat id, and the current pointer position (as a fractional
 * index into the list), return the target insertion index in the flat list.
 *
 * The pointer position is the index of the chat the pointer is over, plus
 * 0.5 if the pointer is in the right half of that chat (so dropping past the
 * midpoint inserts after).
 *
 * Returns `null` if the drag is a no-op (dropped on itself with no move).
 */
export function resolveReorderIndex(
  chatIds: string[],
  draggedId: string,
  hoverIndex: number,
  hoverRightHalf: boolean,
): number | null {
  const fromIndex = chatIds.indexOf(draggedId);
  if (fromIndex === -1) return null;
  let toIndex = hoverRightHalf ? hoverIndex + 1 : hoverIndex;
  // Clamp to valid insertion range [0, len].
  toIndex = Math.max(0, Math.min(toIndex, chatIds.length));
  // Dragging onto itself: no-op unless crossing past the midpoint.
  if (toIndex === fromIndex || toIndex === fromIndex + 1) return null;
  // When moving down, the removal of the source shifts the target by one.
  if (toIndex > fromIndex) toIndex -= 1;
  return toIndex;
}

/**
 * Apply a reorder within/across rows: move `draggedId` so it inserts at
 * `targetRowIndex`/`targetColIndex` in the grid. Returns the new grid
 * (rows + chatColumnWidths preserved; rowHeights unchanged). The source row
 * reflows (gaps close), and the destination row's widths rebalance to fit
 * the new column count.
 *
 * This is the `M×N` reflow primitive: it handles within-row moves (same row,
 * different index) and across-row moves (different row) uniformly.
 */
export function moveChat(
  grid: ChatGrid,
  draggedId: string,
  targetRowIndex: number,
  targetColIndex: number,
  viewportWidth: number,
): ChatGrid {
  // Remove from source.
  let rows = grid.rows.map((row) => row.filter((id) => id !== draggedId));
  // Drop empty trailing rows (keep at least one row).
  rows = rows.filter((row) => row.length > 0);
  if (rows.length === 0) rows = [[]];
  // Clamp target row.
  const clampedRow = Math.max(0, Math.min(targetRowIndex, rows.length - 1));
  // Insert at the target column index.
  const targetRow = [...rows[clampedRow]];
  const col = Math.max(0, Math.min(targetColIndex, targetRow.length));
  targetRow.splice(col, 0, draggedId);
  rows[clampedRow] = targetRow;
  // Rebalance widths in every row to fit the viewport.
  let chatColumnWidths = grid.chatColumnWidths;
  for (let i = 0; i < rows.length; i++) {
    chatColumnWidths = clampRowWidths(chatColumnWidths, rows[i], viewportWidth);
  }
  return { rows, chatColumnWidths, rowHeights: grid.rowHeights };
}

/**
 * Add a chat beside `anchorId` (same row, immediately after). If `anchorId`
 * is null, appends to the last row. Returns the new grid with the new chat
 * inserted and widths rebalanced.
 */
export function addChatBeside(
  grid: ChatGrid,
  anchorId: string | null,
  newChatId: string,
  viewportWidth: number,
): ChatGrid {
  let rows = grid.rows.map((row) => [...row]);
  let inserted = false;
  if (anchorId) {
    for (let i = 0; i < rows.length; i++) {
      const idx = rows[i].indexOf(anchorId);
      if (idx !== -1) {
        rows[i].splice(idx + 1, 0, newChatId);
        inserted = true;
        break;
      }
    }
  }
  if (!inserted) {
    // Append to the last row (or a new row if none).
    const lastIdx = rows.length - 1;
    if (lastIdx < 0 || rows[lastIdx].length === 0) {
      rows.push([newChatId]);
    } else {
      rows[lastIdx].push(newChatId);
    }
  }
  let chatColumnWidths = grid.chatColumnWidths;
  for (let i = 0; i < rows.length; i++) {
    chatColumnWidths = clampRowWidths(chatColumnWidths, rows[i], viewportWidth);
  }
  return { rows, chatColumnWidths, rowHeights: grid.rowHeights };
}

/**
 * Remove a chat from the grid (does NOT delete the session — closing the
 * view retains the session for history). Returns the new grid. If the grid
 * becomes empty, it keeps one empty row so the empty-state renders.
 */
export function removeChat(grid: ChatGrid, chatId: string): ChatGrid {
  let rows = grid.rows.map((row) => row.filter((id) => id !== chatId));
  rows = rows.filter((row) => row.length > 0);
  if (rows.length === 0) rows = [[]];
  const chatColumnWidths = { ...grid.chatColumnWidths };
  delete chatColumnWidths[chatId];
  return { rows, chatColumnWidths, rowHeights: grid.rowHeights };
}

/**
 * Reflow a flat list of chat ids into an `M×N` grid that fits a target
 * number of columns per row. Used when restoring a saved grid or when the
 * viewport forces a wrap (e.g. a 1×5 row wraps to 2×3).
 *
 * `colsPerRow` is the max columns per row; rows are filled in order. If
 * `colsPerRow` is 0 or negative, all chats go in one row.
 */
export function reflowFlatList(
  chatIds: string[],
  colsPerRow: number,
  viewportWidth: number,
): ChatGrid {
  if (chatIds.length === 0) return emptyGrid();
  const cols = colsPerRow > 0 ? colsPerRow : chatIds.length;
  const rows: string[][] = [];
  for (let i = 0; i < chatIds.length; i += cols) {
    rows.push(chatIds.slice(i, i + cols));
  }
  let chatColumnWidths: Record<string, number> = {};
  for (const row of rows) {
    chatColumnWidths = clampRowWidths(chatColumnWidths, row, viewportWidth);
  }
  return { rows, chatColumnWidths, rowHeights: {} };
}

/**
 * Decide whether a row should wrap (spawn a new row) based on the minimum
 * width budget: if `count` columns at the minimum width exceed the viewport,
 * they can't fit on one row.
 */
export function rowShouldWrap(count: number, viewportWidth: number): boolean {
  return count * CHAT_PANEL_MIN_WIDTH_PX > viewportWidth;
}

/**
 * Resize two adjacent rows by a delta: the top row grows by `delta`, the
 * bottom shrinks by `delta`, neither below the minimum height. Mirrors
 * `resizeAdjacent` for the horizontal case.
 */
export function resizeAdjacentRows(
  rowHeights: Record<number, number>,
  topIndex: number,
  bottomIndex: number,
  delta: number,
  viewportHeight: number,
): Record<number, number> {
  const top = Math.max(rowHeights[topIndex] ?? CHAT_ROW_MIN_HEIGHT_PX, CHAT_ROW_MIN_HEIGHT_PX);
  const bottom = Math.max(rowHeights[bottomIndex] ?? CHAT_ROW_MIN_HEIGHT_PX, CHAT_ROW_MIN_HEIGHT_PX);
  let newTop = top + delta;
  let newBottom = bottom - delta;
  if (newTop < CHAT_ROW_MIN_HEIGHT_PX) {
    newBottom -= CHAT_ROW_MIN_HEIGHT_PX - newTop;
    newTop = CHAT_ROW_MIN_HEIGHT_PX;
  }
  if (newBottom < CHAT_ROW_MIN_HEIGHT_PX) {
    newTop -= CHAT_ROW_MIN_HEIGHT_PX - newBottom;
    newBottom = CHAT_ROW_MIN_HEIGHT_PX;
  }
  return { ...rowHeights, [topIndex]: newTop, [bottomIndex]: newBottom };
}
