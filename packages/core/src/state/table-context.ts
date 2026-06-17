import type { State } from "./state";
import { getBlock, blockCount } from "./state";
import type { BlockId } from "./block-id";
import { ancestorChain } from "./block-traversal";
import { isSpan, spanValue } from "./table-cell-span";
import { assignTableGrid } from "./table-grid-core";
import type { GridCell, TableGrid } from "./table-grid-core";

/**
 * The table-editing context derived from a caret position (P15a). Identifies the
 * caret's table / row / cell and the full row×cell grid, in document order, so the
 * insert/delete row/column handlers can operate without re-walking the tree.
 *
 * `hasSpans = spanned || ragged` is a DERIVED CONVENIENCE — "is this anything
 * other than a plain uniform table?" It is NOT the editor no-op boundary: the
 * handlers gate on `ragged` ALONE (a degenerate, hole-bearing table) and route a
 * well-formed `spanned` table to the span-aware op. `spanned` is true when any
 * cell carries a real `rowSpan`/`colSpan`; `ragged` when the occupancy grid has
 * a hole (an uncovered slot).
 *
 * `spanned` and `ragged` are exposed SEPARATELY (not just their `hasSpans` union)
 * because the handlers dispatch on them DIFFERENTLY: a `spanned` (well-formed) table
 * routes to the span-aware op, but a `ragged` table stays gated (a degenerate
 * state, out of P15b scope). A handler must check `ragged` BEFORE `spanned` so a
 * spanned-AND-ragged table still no-ops (the ragged gate wins).
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
  /** Any cell carries a real `rowSpan`/`colSpan` (> 1, per `isSpan`). */
  readonly spanned: boolean;
  /** Rows have differing cell counts (a degenerate table; P15b leaves it gated). */
  readonly ragged: boolean;
  /** `spanned || ragged` — a derived convenience, NOT the editor no-op boundary
   *  (that is `ragged` alone; `spanned` routes to the span-aware op). */
  readonly hasSpans: boolean;
  /**
   * The P8 occupancy grid for this table, built ONCE from the PRE-mutation
   * `state` (it is what `ragged` is derived from). `null` only for a non-main-tree
   * table — unreachable here, since `tableId` is already proven a main-tree
   * `table`. Span-aware handlers reuse this for caret targeting instead of
   * re-scanning the tree with a second `buildTableGrid` call.
   */
  readonly grid: TableGrid | null;
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
  // cellIdsByRow is built 1:1 from rowIds via map, so a valid rowIndex (>= 0,
  // < rowIds.length) always indexes a present row.
  const caretRowCells = rowIndex >= 0 ? cellIdsByRow[rowIndex] : undefined;
  const colIndex = caretRowCells !== undefined ? caretRowCells.indexOf(cellId) : -1;
  if (rowIndex < 0 || colIndex < 0 || caretRowCells === undefined) return null;

  const spanned = cellIdsByRow.some((cells) =>
    cells.some((cid) => {
      const c = getBlock(state, cid);
      return c !== null && (isSpan(c.attrs.rowSpan) || isSpan(c.attrs.colSpan));
    }),
  );
  // `ragged` (degenerate) is SPAN-AWARE: the occupancy grid is not a clean
  // rectangle — some slot is uncovered (a hole). A well-formed spanned table
  // tiles its grid fully (no holes → ragged false, so P15b's span-aware ops run);
  // genuinely-missing cells OR a malformed span that leaves a gap produce a hole
  // (ragged true → stays gated, the degenerate carve-out). Computing from raw cell
  // COUNTS per row would wrongly flag every colSpan/rowSpan table as ragged (a span
  // legitimately makes a row hold fewer cells than the grid is wide). `buildTableGrid`
  // returns null only for a non-main-tree table, which `tableId` is already proven
  // not to be — the count-based fallback is unreachable defence.
  const grid = buildTableGrid(state, tableId);
  const ragged =
    grid === null
      ? // `caretRowCells` is non-undefined here: the `colIndex < 0` guard above
        // already returned null for an absent caret row.
        cellIdsByRow.some((cells) => cells.length !== caretRowCells.length)
      : grid.occupancy.some((row) => row.some((slot) => slot === null));

  return {
    tableId,
    rowId,
    cellId,
    rowIndex,
    colIndex,
    rowIds,
    cellIdsByRow,
    spanned,
    ragged,
    hasSpans: ragged || spanned,
    grid,
  };
}

/**
 * Build the P8 occupancy grid (`TableGrid`) for a main-tree `table` block from
 * the STATE Block tree — the state-side counterpart of the layout Table FC's grid
 * pass, so the P15b span-aware editing ops can reason in grid coordinates
 * (gridRow/gridCol/occupancy) from the PRE-mutation `State`.
 *
 * Spans are read as `spanValue(attrs.rowSpan/colSpan) ?? 1` — the SAME predicate
 * `table-cell.ts` stamps into layout metadata — so the state-built grid is
 * BYTE-IDENTICAL to the layout-built grid. (NOT `clampSpan` on raw attrs:
 * `clampSpan(2.9) = 2` would diverge from the layout path's `1×1`. See the
 * `table-grid-core` F1 contract.)
 *
 * Returns `null` when `tableId` is not a main-tree `table` block. Rows/cells are
 * filtered to `table-row`/`table-cell` types (anonymous-row/cell synthesis is a
 * layout concern, not present in the state tree).
 */
export function buildTableGrid(state: State, tableId: BlockId): TableGrid | null {
  if (getBlock(state, tableId)?.type !== "table") return null;
  const rows: GridCell[][] = getChildIds(state, tableId)
    .filter((rid) => getBlock(state, rid)?.type === "table-row")
    .map((rid) =>
      getChildIds(state, rid)
        .filter((cid) => getBlock(state, cid)?.type === "table-cell")
        .map((cid): GridCell => {
          const attrs = getBlock(state, cid)?.attrs ?? {};
          return {
            cellId: cid,
            rowSpan: spanValue(attrs.rowSpan) ?? 1,
            colSpan: spanValue(attrs.colSpan) ?? 1,
          };
        }),
    );
  return assignTableGrid(rows);
}
