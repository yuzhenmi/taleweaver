import type * as Y from "yjs";
import type { Document, OperationResult } from "../document";
import { applyOperation, resolveBlock } from "../document";
import type { BlockId, IdAllocator } from "../block-id";
import type { Position } from "../block-position";
import { createPosition } from "../block-position";
import { requireInTransaction } from "../yjs-doc";
import { insertChildren, type TreeNode } from "../flow-ops";
import { assertNoIdCollision } from "../id-collision-check";
import {
  planSplitBlockAtPosition,
  splitBlockAtPositionInTx,
  type SplitBlockPlan,
} from "./split-block";

/** One fresh table cell: a `table-cell` container holding one empty paragraph. */
export interface TableCellPlan {
  readonly cellId: BlockId;
  readonly paragraphId: BlockId;
}

/** One fresh table row: a `table-row` container holding `cells` left-to-right. */
export interface TableRowPlan {
  readonly rowId: BlockId;
  readonly cells: readonly TableCellPlan[];
}

/**
 * A fully-allocated (but not-yet-materialized) table subtree: the `table`
 * container's id + its equal `columnWidths` + its rows top-to-bottom. All ids
 * are freshly allocated; no spans (every cell is 1×1).
 */
export interface TableSubtreePlan {
  readonly tableId: BlockId;
  /** Equal column fractions (`1 / cols` each), summing to 1 — the Google Docs default. */
  readonly columnWidths: readonly number[];
  readonly rows: readonly TableRowPlan[];
}

/**
 * Pre-computed mutation plan for `createTableInTx`. Captures:
 *   - `subtree` — the freshly-allocated table subtree shape (ids + widths).
 *   - `parentId` — the container the table is spliced under (the caret block's
 *     parent — a document/section container; always valid since the caret block
 *     is a leaf child of it).
 *   - `afterId` — the existing sibling the table is inserted immediately AFTER;
 *     `null` means the table becomes the parent's new first child (prepend).
 *   - `beforeId` — the existing sibling immediately AFTER the table; `null`
 *     means the table becomes the parent's new last child (append).
 *   - `split` — when the caret is mid-block, the `SplitBlockPlan` that bisects
 *     the caret's block first (the table lands between the two halves); `null`
 *     for a block-boundary insert (caret at block start or end).
 *   - `caretInto` — the post-insert collapsed caret target: cell (0,0)'s
 *     paragraph at offset 0.
 *
 * Plain data — no Y types. MAIN-TREE only (mirrors `insertBlocksAfter`).
 */
export interface CreateTablePlan {
  readonly subtree: TableSubtreePlan;
  readonly parentId: BlockId;
  readonly afterId: BlockId | null;
  readonly beforeId: BlockId | null;
  readonly split: SplitBlockPlan | null;
  readonly caretInto: Position;
}

/**
 * Allocate a fresh `rows × cols` table subtree (no spans). Pure: the only side
 * effect is bumping `allocator`. Every cell gets one empty paragraph; columns
 * are equal fractions (`1 / cols`).
 *
 * Throws if `rows < 1` or `cols < 1` (a degenerate table has no meaning; the
 * editor-action layer no-ops on a 0 request before reaching here).
 */
export function buildTableSubtreePlan(
  rows: number,
  cols: number,
  allocator: IdAllocator,
): TableSubtreePlan {
  if (rows < 1 || cols < 1) {
    throw new Error(`createTable: a table needs at least 1 row and 1 column (got ${rows}×${cols})`);
  }
  const tableId = allocator.allocate();
  const rowPlans: TableRowPlan[] = [];
  for (let r = 0; r < rows; r++) {
    const rowId = allocator.allocate();
    const cells: TableCellPlan[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push({ cellId: allocator.allocate(), paragraphId: allocator.allocate() });
    }
    rowPlans.push({ rowId, cells });
  }
  // Equal columns (Google Docs default). Fresh mutable array — not aliased to
  // any shared structure once stored in the table's attrs.
  const columnWidths = Array.from({ length: cols }, () => 1 / cols);
  return { tableId, columnWidths, rows: rowPlans };
}

/**
 * Insert a fresh `rows × cols` table at `caretPosition` and return the caret
 * target inside cell (0,0). The keystone create-entry-point for the (already
 * span-aware) tables subsystem — Google Docs' Insert ▸ Table.
 *
 * Insertion is BLOCK-level (a table is a sibling of paragraphs), resolved to
 * the nearest block boundary of the caret's block:
 *   - caret at block START (offset 0) → table BEFORE the block;
 *   - caret at offset k > 0 → a ¶ ends the head at the caret, then the table:
 *     head (new id), table, tail (the caret's block — empty at the end).
 *
 * One `applyOperation` transaction (the optional split + the whole subtree +
 * the splice) → one undo entry. Returns `OperationResult` plus:
 *   - `newTableId` — the new table container's id;
 *   - `caretInto` — a collapsed caret in cell (0,0)'s paragraph at offset 0.
 *
 * MAIN-TREE only: the caret block must live in the main document tree. A caret
 * in a footnote/header/footer body throws a clear "main-body only" error; the
 * editor handler also refuses those contexts before calling this (tables there
 * are out of scope).
 *
 * Throws if the caret block does not exist, is in a non-main-tree body, is a
 * container (non-leaf), is the root (no parent to host a sibling), or if
 * `rows < 1` / `cols < 1`.
 */
export function createTable(
  document: Document,
  caretPosition: Position,
  rows: number,
  cols: number,
  allocator: IdAllocator,
): OperationResult & { readonly newTableId: BlockId; readonly caretInto: Position } {
  const plan = planCreateTable(document, caretPosition, rows, cols, allocator);
  const result = applyOperation(document, (doc) => {
    createTableInTx(doc, plan);
  });
  return { ...result, newTableId: plan.subtree.tableId, caretInto: plan.caretInto };
}

/**
 * Validate `caretPosition` against `document` and produce a `CreateTablePlan`.
 * Throws on every condition `createTable`'s docstring lists. Allocates the
 * subtree (and, for a mid-block insert, the split's new block) once, outside
 * any transaction, so the allocator is bumped exactly once.
 */
export function planCreateTable(
  document: Document,
  caretPosition: Position,
  rows: number,
  cols: number,
  allocator: IdAllocator,
): CreateTablePlan {
  // Resolve across all trees so a footnote/header/footer-body caret yields a
  // clear "main-body only" error rather than a misleading "not found" (the
  // body-context refusal also lives in the editor handler, but the op states
  // its own MAIN-TREE precondition explicitly).
  const resolved = resolveBlock(document, caretPosition.blockId);
  if (resolved === null) {
    throw new Error(`createTable: block "${caretPosition.blockId}" not found`);
  }
  if (resolved.kind !== "block") {
    throw new Error(
      `createTable: block "${caretPosition.blockId}" is in a ${resolved.kind} body; ` +
        `tables are supported in the main document body only`,
    );
  }
  const block = resolved.block;
  if (block.inlineContent === null || block.firstChildId !== null) {
    throw new Error(`createTable: block "${caretPosition.blockId}" is a container, not a leaf`);
  }
  // Defense-in-depth (mirrors splitBlockAtPosition): a leaf with a null parent
  // is a malformed tree — the well-formed root is a container, caught above.
  if (block.parentId === null) {
    throw new Error(
      `createTable: block "${caretPosition.blockId}" is the root and has no parent to host a sibling`,
    );
  }

  // Resolve the block-boundary insertion case. The split (if any) is planned
  // BEFORE the subtree so the canonical split errors win, and so allocation
  // order is deterministic.
  let split: SplitBlockPlan | null = null;
  let afterId: BlockId | null;
  let beforeId: BlockId | null;
  if (caretPosition.offset <= 0) {
    // START: only the table item is written, before the caret's block.
    afterId = block.prevSiblingId;
    beforeId = caretPosition.blockId;
  } else {
    // k > 0: a ¶ ends the head at the caret, then the table: head H,
    // table, tail = the caret's block (empty when k = len).
    split = planSplitBlockAtPosition(document, caretPosition, allocator);
    afterId = split.newBlockId;
    beforeId = caretPosition.blockId;
  }

  const subtree = buildTableSubtreePlan(rows, cols, allocator);
  const firstRow = subtree.rows[0];
  if (firstRow === undefined) {
    throw new Error("createTable: subtree has no rows (unreachable)");
  }
  const firstCell = firstRow.cells[0];
  if (firstCell === undefined) {
    throw new Error("createTable: first row has no cells (unreachable)");
  }
  const caretInto = createPosition(firstCell.paragraphId, 0);

  return { subtree, parentId: block.parentId, afterId, beforeId, split, caretInto };
}

/**
 * Pure Y.Doc-mutation primitive: applies a `CreateTablePlan` to `doc`. MUST run
 * inside an already-open transaction (it does not open one). Performs the
 * optional split, materializes the full table subtree, then splices the table
 * as a sibling between `afterId` / `beforeId`.
 *
 * MAIN-TREE only (writes the `blocks` map) — see `createTable`'s docstring.
 */
export function createTableInTx(doc: Y.Doc, plan: CreateTablePlan): void {
  requireInTransaction(doc, "createTable");

  // 1. Mid-block insert: bisect the caret's block first. After this, the prefix
  //    keeps `plan.afterId`'s id and points at the suffix (`plan.beforeId`); the
  //    splice below re-wires both to thread the table between them.
  if (plan.split !== null) {
    splitBlockAtPositionInTx(doc, plan.split);
  }

  const { tableId, columnWidths, rows } = plan.subtree;

  // Dev-mode defense against allocator id collision (every fresh id).
  assertNoIdCollision(doc, tableId, "createTable");
  for (const row of rows) {
    assertNoIdCollision(doc, row.rowId, "createTable");
    for (const cell of row.cells) {
      assertNoIdCollision(doc, cell.cellId, "createTable");
      assertNoIdCollision(doc, cell.paragraphId, "createTable");
    }
  }

  // 2. Materialize the subtree (cells + paragraphs + rows), then the table.
  const node: TreeNode = {
    id: tableId,
    type: "table",
    attrs: { columnWidths: [...columnWidths] },
    inlineContent: null,
    children: rows.map((row) => ({
      id: row.rowId,
      type: "table-row",
      attrs: {},
      inlineContent: null,
      children: row.cells.map((cell) => ({
        id: cell.cellId,
        type: "table-cell",
        attrs: {},
        inlineContent: null,
        children: [{ id: cell.paragraphId, type: "paragraph", attrs: {}, inlineContent: { items: [] }, children: [] }],
      })),
    })),
  };
  // The table mark goes after `afterId` (or first in the parent).
  insertChildren(doc, plan.parentId, plan.afterId, [node], "block");
}
