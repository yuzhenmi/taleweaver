import type { State } from "./state";
import { getBlock, blockCount } from "./state";
import type { BlockId } from "./block-id";
import { ancestorChain } from "./block-traversal";
import { isSpan } from "./table-cell-span";

/**
 * The table-editing context derived from a caret position (P15a). Identifies the
 * caret's table / row / cell and the full row×cell grid, in document order, so the
 * insert/delete row/column handlers can operate without re-walking the tree.
 *
 * `hasSpans` is the P15a no-op boundary: it is true when the table contains ANY
 * real `rowSpan`/`colSpan` OR is ragged (rows with differing cell counts). Both
 * make the simple grid model unsafe, so every P15a action no-ops and defers to the
 * span-aware piece (P15b).
 */
export interface TableContext {
  readonly tableId: BlockId;
  readonly rowId: BlockId;
  readonly cellId: BlockId;
  readonly rowIndex: number;
  readonly colIndex: number;
  readonly rowIds: readonly BlockId[];
  /** cells per row, document order; `cellIdsByRow[rowIndex]` is the caret row. */
  readonly cellIdsByRow: readonly (readonly BlockId[])[];
  readonly hasSpans: boolean;
}

/** The main-tree child ids of `parentId` in document order (sibling-chain walk).
 *  Empty when the block is absent (e.g. not in the main tree) or childless. */
export function getChildIds(state: State, parentId: BlockId): BlockId[] {
  const parent = getBlock(state, parentId);
  if (parent === null) return [];
  const out: BlockId[] = [];
  // Cycle-detection bound, matching block-traversal's chain walks: a corrupt
  // `nextSiblingId` cycle would otherwise loop forever.
  const maxSteps = blockCount(state) + 1;
  let steps = 0;
  let cur: BlockId | null = parent.firstChildId;
  while (cur !== null) {
    if (++steps > maxSteps) {
      throw new Error(`getChildIds: cycle detected in sibling chain under "${parentId}"`);
    }
    const child = getBlock(state, cur);
    if (child === null) break; // malformed chain (missing child) — stop defensively
    out.push(cur);
    cur = child.nextSiblingId;
  }
  return out;
}

/**
 * Resolve the table-editing context for the block at `blockId` (the caret's focus
 * block), or `null` when it is not inside an editable main-tree table.
 *
 * MAIN-TREE ONLY: every lookup uses `getBlock` (main tree). A table inside a
 * header/footer/footnote body resolves to `null` (the structural ops the handlers
 * call are main-tree-only), so those tables are out of P15a scope — the handler
 * no-ops.
 */
export function resolveTableContext(state: State, blockId: BlockId): TableContext | null {
  // Walk up to the nearest table-cell. `ancestorChain` resolves across ALL trees
  // (resolveBlock), but the type check uses `getBlock` (MAIN-TREE-ONLY) — so a
  // table-cell living in a header/footer/footnote body never matches and the
  // walk falls through to `null`. This asymmetry IS the main-tree guard (the ops
  // the handlers call are main-tree-only); do NOT switch this to `resolveBlock`
  // or non-main-tree tables would resolve a context the ops can't edit.
  let cellId: BlockId | null = null;
  for (const id of ancestorChain(state, blockId)) {
    if (getBlock(state, id)?.type === "table-cell") {
      cellId = id;
      break;
    }
  }
  if (cellId === null) return null;

  const cell = getBlock(state, cellId);
  const rowId = cell?.parentId ?? null;
  if (rowId === null || getBlock(state, rowId)?.type !== "table-row") return null;

  const tableId = getBlock(state, rowId)?.parentId ?? null;
  if (tableId === null || getBlock(state, tableId)?.type !== "table") return null;

  const rowIds = getChildIds(state, tableId).filter(
    (id) => getBlock(state, id)?.type === "table-row",
  );
  const cellIdsByRow = rowIds.map((rid) =>
    getChildIds(state, rid).filter((id) => getBlock(state, id)?.type === "table-cell"),
  );

  const rowIndex = rowIds.indexOf(rowId);
  const colIndex = rowIndex >= 0 ? cellIdsByRow[rowIndex].indexOf(cellId) : -1;
  if (rowIndex < 0 || colIndex < 0) return null;

  const colCount = cellIdsByRow[rowIndex].length;
  const ragged = cellIdsByRow.some((cells) => cells.length !== colCount);
  const spanned = cellIdsByRow.some((cells) =>
    cells.some((cid) => {
      const c = getBlock(state, cid);
      return c !== null && (isSpan(c.attrs.rowSpan) || isSpan(c.attrs.colSpan));
    }),
  );

  return {
    tableId,
    rowId,
    cellId,
    rowIndex,
    colIndex,
    rowIds,
    cellIdsByRow,
    hasSpans: ragged || spanned,
  };
}
