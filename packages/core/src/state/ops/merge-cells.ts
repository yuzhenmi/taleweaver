import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { getBlocksMap, getYBlock, requireInTransaction } from "../yjs-doc";
import { setBlockAttrsInTx } from "./set-block-attrs";
import { buildTableGrid, getChildIds } from "../table-context";
import { isDevMode } from "../dev-mode";
import type { CellRange } from "../table-cell-range";

/**
 * Fully-resolved mutation plan for `mergeCellsInTx` — everything is read from the
 * PRE-mutation grid + tree so the applier reads nothing (the `computeReparentWrites`
 * discipline). A merge keeps the SURVIVOR (the cell originating at the range's
 * top-left), grows its span to cover the range, appends every other in-range
 * cell's block-children into it (row-major), and removes those cells.
 */
export interface MergeCellsPlan {
  /** The surviving cell (originates at `(minRow, minCol)`). */
  readonly survivorId: BlockId;
  /** Survivor attrs with `rowSpan`/`colSpan` set to the range dims (dropped when 1). */
  readonly survivorAttrs: ReadonlyAttrs;
  /** Survivor's `lastChildId` BEFORE the merge (the splice point for migrated children). */
  readonly survivorOrigLastChildId: BlockId | null;
  /** Block-children of the non-empty donor cells, in final (row-major) order; they
   *  become the survivor's tail children. Empty donors (single empty paragraph)
   *  contribute NOTHING (F9 — don't pile up blank lines). */
  readonly migratedChildIds: readonly BlockId[];
  /** Per affected grid row: the cells that REMAIN after donors are removed, in
   *  grid-column order (the row's new sibling chain; empty → a row covered entirely
   *  by the survivor's rowSpan). */
  readonly rowChains: readonly { readonly rowId: BlockId; readonly cellIds: readonly BlockId[] }[];
  /** Donor cells to delete from the blocks map (their children were migrated, or —
   *  for empty donors — are in `deletedChildIds`). */
  readonly donorCellIds: readonly BlockId[];
  /** Empty donors' (non-migrated) paragraph children to delete alongside their cell. */
  readonly deletedChildIds: readonly BlockId[];
}

/**
 * Merge a rectangular `range` of table cells into a single spanned cell, as one
 * atomic transaction (one undo entry). The survivor (top-left) keeps its content
 * FIRST; every other in-range cell's content is appended row-major, except a cell
 * that is a single empty paragraph contributes nothing (Google Docs parity). Caret
 * positioning is the handler's concern.
 *
 * NO-OP (same `state` ref) when the range resolves to a single cell or the grid
 * can't be built. MAIN-TREE ONLY.
 */
export function mergeCells(state: State, range: CellRange): OperationResult {
  const plan = planMergeCells(state, range);
  if (plan === null) return { state, dirtyIds: new Set<BlockId>() };
  return applyOperation(state, (doc) => {
    mergeCellsInTx(doc, plan);
  });
}

/** Build the merge plan, or null when the range is a single cell (nothing to merge). */
export function planMergeCells(state: State, range: CellRange): MergeCellsPlan | null {
  const grid = buildTableGrid(state, range.tableId);
  if (grid === null) return null;

  const inRange = (gridRow: number, gridCol: number): boolean =>
    gridRow >= range.minRow && gridRow <= range.maxRow &&
    gridCol >= range.minCol && gridCol <= range.maxCol;

  // resolveCellRange expanded the range to whole span-rectangles, so a cell whose
  // ORIGIN is in the range is fully inside it; rows partition cleanly into in-range
  // (donor/survivor) vs out-of-range (untouched).
  const survivor = grid.cells.find((c) => c.gridRow === range.minRow && c.gridCol === range.minCol);
  if (survivor === undefined) return null;
  const donors = grid.cells
    .filter((c) => c.cellId !== survivor.cellId && inRange(c.gridRow, c.gridCol))
    .sort((a, b) => (a.gridRow - b.gridRow) || (a.gridCol - b.gridCol));
  if (donors.length === 0) return null; // single-cell range → nothing to merge

  const survivorBlock = getBlock(state, survivor.cellId);
  if (survivorBlock === null) return null;

  const newRowSpan = range.maxRow - range.minRow + 1;
  const newColSpan = range.maxCol - range.minCol + 1;
  const survivorAttrs = withSpan(survivorBlock.attrs, newRowSpan, newColSpan);

  const migratedChildIds: BlockId[] = [];
  const deletedChildIds: BlockId[] = [];
  const donorCellIds: BlockId[] = [];
  for (const donor of donors) {
    donorCellIds.push(donor.cellId);
    const children = getChildIds(state, donor.cellId);
    if (isSingleEmptyParagraph(state, children)) {
      deletedChildIds.push(...children); // the lone empty paragraph — F9: contributes nothing
    } else {
      migratedChildIds.push(...children);
    }
  }

  // Row blocks in document order map 1:1 to grid rows (the table is non-ragged here).
  const rowIds = getChildIds(state, range.tableId).filter(
    (id) => getBlock(state, id)?.type === "table-row",
  );
  const donorIdSet = new Set<BlockId>(donorCellIds);
  const rowChains: MergeCellsPlan["rowChains"][number][] = [];
  for (let r = range.minRow; r <= range.maxRow; r++) {
    const rowId = rowIds[r];
    if (rowId === undefined) {
      // Unreachable by contract: a CellRange from `resolveCellRange` is bounded by
      // the grid, so r ≤ rowIds.length-1. Surface a malformed-range caller loudly
      // rather than silently leaving the row's donor pointers dangling.
      if (isDevMode()) throw new Error(`mergeCells: rowIds[${r}] undefined — range exceeds grid bounds`);
      continue;
    }
    const remaining = grid.cells
      .filter((c) => c.gridRow === r && !donorIdSet.has(c.cellId))
      .sort((a, b) => a.gridCol - b.gridCol)
      .map((c) => c.cellId);
    rowChains.push({ rowId, cellIds: remaining });
  }

  return {
    survivorId: survivor.cellId,
    survivorAttrs,
    survivorOrigLastChildId: survivorBlock.lastChildId,
    migratedChildIds,
    rowChains,
    donorCellIds,
    deletedChildIds,
  };
}

/** A copy of `attrs` with `rowSpan`/`colSpan` set to the span dims (key dropped when the dim is 1). */
function withSpan(attrs: ReadonlyAttrs, rowSpan: number, colSpan: number): ReadonlyAttrs {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "rowSpan" || k === "colSpan") continue;
    next[k] = v;
  }
  if (rowSpan > 1) next.rowSpan = rowSpan;
  if (colSpan > 1) next.colSpan = colSpan;
  return next;
}

/**
 * F9: a cell whose only child is a paragraph with zero inline items (regardless of
 * its attrs). A child with `inlineContent === null` (a container, not a text block)
 * is conservatively NOT empty — its content migrates, never silently dropped.
 */
function isSingleEmptyParagraph(state: State, childIds: readonly BlockId[]): boolean {
  const onlyChildId = childIds[0];
  if (childIds.length !== 1 || onlyChildId === undefined) return false;
  const only = getBlock(state, onlyChildId);
  if (only === null || only.inlineContent === null) return false;
  return only.inlineContent.items.length === 0;
}

/**
 * Pure Y.Doc-mutation primitive: grows the survivor's span, reparents the migrated
 * children onto the survivor's tail, re-chains every affected row's surviving cells,
 * and deletes the donor cells (+ empty donors' paragraphs). MUST run inside an
 * already-open transaction.
 */
export function mergeCellsInTx(doc: Y.Doc, plan: MergeCellsPlan): void {
  requireInTransaction(doc, "mergeCells");
  const blocksMap = getBlocksMap(doc);

  // 1. Survivor span attrs (REPLACE).
  setBlockAttrsInTx(doc, plan.survivorId, plan.survivorAttrs, "mergeCells");

  // 2. Append migrated children onto the survivor's tail, re-chaining them linearly.
  const migrated = plan.migratedChildIds;
  for (const [i, childId] of migrated.entries()) {
    const yChild = getYBlock(doc, childId, "mergeCells");
    yChild.set("parentId", plan.survivorId);
    yChild.set("prevSiblingId", i === 0 ? plan.survivorOrigLastChildId : (migrated[i - 1] ?? null));
    yChild.set("nextSiblingId", i === migrated.length - 1 ? null : (migrated[i + 1] ?? null));
  }
  const firstMigrated = migrated[0];
  const lastMigrated = migrated[migrated.length - 1];
  if (firstMigrated !== undefined && lastMigrated !== undefined) {
    const ySurvivor = getYBlock(doc, plan.survivorId, "mergeCells");
    if (plan.survivorOrigLastChildId !== null) {
      getYBlock(doc, plan.survivorOrigLastChildId, "mergeCells").set("nextSiblingId", firstMigrated);
    } else {
      ySurvivor.set("firstChildId", firstMigrated); // defensive: survivor had no children
    }
    ySurvivor.set("lastChildId", lastMigrated);
  }

  // 3. Re-chain each affected row's surviving cells (donors excluded). An empty
  //    chain → a row fully covered by the survivor's rowSpan.
  for (const { rowId, cellIds } of plan.rowChains) {
    const yRow = getYBlock(doc, rowId, "mergeCells");
    for (const [i, cellId] of cellIds.entries()) {
      const yCell = getYBlock(doc, cellId, "mergeCells");
      yCell.set("prevSiblingId", i === 0 ? null : (cellIds[i - 1] ?? null));
      yCell.set("nextSiblingId", i === cellIds.length - 1 ? null : (cellIds[i + 1] ?? null));
    }
    yRow.set("firstChildId", cellIds[0] ?? null);
    yRow.set("lastChildId", cellIds[cellIds.length - 1] ?? null);
  }

  // 4. Delete donor cells (children already migrated) + empty donors' paragraphs.
  for (const id of plan.donorCellIds) blocksMap.delete(id);
  for (const id of plan.deletedChildIds) blocksMap.delete(id);
}
