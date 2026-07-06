/**
 * Legacy per-tab chat grid type. Retained for backward compatibility with
 * old workspace-restore snapshots (`tabGridStates`). The active panel grid
 * uses the split-tree model in `panelGrid.ts` (`PanelGridState`); this type
 * only exists so old restore data can be parsed without crashing.
 */

/** A per-tab layout of chat ids arranged in rows. Legacy shape. */
export type ChatGrid = {
  /** Ordered rows of chat ids. `rows[0]` is the top row. */
  rows: string[][];
  /** Per-chat pixel width. Absent = equal share. */
  chatColumnWidths: Record<string, number>;
  /** Per-row pixel height (keyed by row index). Absent = equal share. */
  rowHeights: Record<number, number>;
};
