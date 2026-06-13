import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { getYBlock, requireInTransaction } from "../yjs-doc";
import { buildYAttrs } from "../y-block";
import { getChildIds, buildTableGrid } from "../table-context";
import { largestCleanHeaderCount, readHeaderRowCount, withHeaderRowCount } from "./table-header-rows";

/**
 * Pre-computed mutation plan for `setTableHeaderRowsInTx`. Captures the table id
 * and the FINAL attrs bag to write (with `headerRowCount` spliced in, or dropped
 * when the clamped count is 0). `unchanged` is true when the clamped count equals
 * the table's current `headerRowCount` — the InTx applier then writes nothing, so
 * `applyOperation` returns the input `state` reference (the no-op contract).
 */
export interface SetTableHeaderRowsPlan {
  readonly tableId: BlockId;
  readonly newAttrs: ReadonlyAttrs;
  readonly unchanged: boolean;
}

/**
 * Set a table's repeating-header-row count (#487). Pins the first `count`
 * contiguous rows as header rows; the layout repeats them at the top of every
 * page/column fragment the table spans (Google Docs ▸ "Pin header rows"). `count`
 * is clamped to `[0, rowCount]` AND DOWN to the largest CLEAN-CUT boundary — no
 * merged cell may originate in a header row and span past the boundary into a
 * body row (spec §3). `count === 0` (the default) turns the header OFF.
 *
 * One `applyOperation` transaction → one undo entry. No-op (returns the input
 * `state` reference unchanged, per the `applyOperation` no-op contract) when the
 * clamped count already equals the table's `headerRowCount`. Throws if `tableId`
 * does not resolve to a `table` block.
 *
 * MAIN-TREE ONLY (writes the `blocks` map) — a table in a header/footer/footnote
 * body is out of scope (v1; mirrors the other table ops).
 */
export function setTableHeaderRows(
  state: State,
  tableId: BlockId,
  count: number,
): OperationResult {
  const plan = planSetTableHeaderRows(state, tableId, count);
  return applyOperation(state, (doc) => {
    setTableHeaderRowsInTx(doc, plan);
  });
}

/**
 * Validate `tableId` and compute the clamped `headerRowCount` + the final attrs
 * bag. Throws if `tableId` does not resolve to a main-tree `table` block. The
 * clamp is `min(max(count, 0), rowCount)` then DOWN to `largestCleanHeaderCount`
 * (spec §3 clean-cut invariant).
 */
export function planSetTableHeaderRows(
  state: State,
  tableId: BlockId,
  count: number,
): SetTableHeaderRowsPlan {
  const resolved = resolveBlock(state, tableId);
  if (resolved === null) {
    throw new Error(`setTableHeaderRows: block "${tableId}" not found`);
  }
  if (resolved.kind !== "block" || resolved.block.type !== "table") {
    throw new Error(`setTableHeaderRows: block "${tableId}" is not a table`);
  }
  const table = resolved.block;

  // rowCount = the table's `table-row` children (mirrors resolveTableContext).
  const rowCount = getChildIds(state, tableId).filter(
    (id) => resolveBlock(state, id)?.block.type === "table-row",
  ).length;

  // Clamp to [0, rowCount], then DOWN to the largest clean-cut boundary. The grid
  // is built only when a positive header is requested (count 0 is always clean).
  const inRange = Math.max(0, Math.min(count, rowCount));
  let clamped = inRange;
  if (inRange > 0) {
    const grid = buildTableGrid(state, tableId);
    // `grid` is null only for a non-`table` block, ruled out above; the `?? 0`
    // is unreachable defence (no header rather than a wrong header on a corrupt
    // tree). The clamp uses `inRange` so the validator's own rowCount clamp does
    // not double-apply.
    clamped = grid === null ? 0 : largestCleanHeaderCount(grid, inRange);
  }

  const current = readHeaderRowCount(table.attrs);
  const unchanged = clamped === current;

  // Splice `headerRowCount` into the attrs bag; drop the key when 0 (the absent
  // default), so a `setTableHeaderRows(…, 0)` on a never-pinned table is a clean
  // no-op and an un-pin leaves no vestigial `headerRowCount: 0`.
  const newAttrs = withHeaderRowCount(table.attrs, clamped);
  return { tableId, newAttrs, unchanged };
}

/**
 * Pure Y.Doc-mutation primitive: writes the table's new attrs bag when the count
 * changed; otherwise writes nothing (so the transaction captures no dirty ids and
 * `applyOperation` returns the input state — the no-op contract). MUST run inside
 * an already-open transaction.
 */
export function setTableHeaderRowsInTx(doc: Y.Doc, plan: SetTableHeaderRowsPlan): void {
  requireInTransaction(doc, "setTableHeaderRows");
  if (plan.unchanged) return;
  getYBlock(doc, plan.tableId, "setTableHeaderRows").set("attrs", buildYAttrs(plan.newAttrs));
}
