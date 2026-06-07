import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import { getBlocksMap, getYBlock } from "../yjs-doc";
import { buildYBlock } from "../y-block";
import { assertNoIdCollision } from "../id-collision-check";
import { planRemoveBlock, removeBlockInTx } from "./remove-block";

/**
 * Delete a whole table. When the table is its parent's SOLE child, a fresh
 * empty-leaf paragraph is inserted in its place — in the SAME transaction — so
 * the body is never left empty (Google Docs / Word / Pages never allow an empty
 * body). When the table has a sibling, this is a plain subtree removal (no
 * replacement). One undo entry either way.
 *
 * This is the single whole-table-delete primitive that `DELETE_TABLE` and the
 * (later) last-row / last-column collapse route through.
 *
 * Returns the new paragraph id when a replacement was created (sole-child case),
 * else null — the handler uses it for caret placement.
 *
 * Span-agnostic: removing the entire table is always safe regardless of
 * `rowSpan`/`colSpan` (unlike the row/column insert/delete ops). MAIN-TREE ONLY
 * (mirrors `removeBlock`).
 */
export function deleteTableWithReplacement(
  state: State,
  tableId: BlockId,
  allocator: IdAllocator,
): OperationResult & { readonly newParagraphId: BlockId | null } {
  const table = getBlock(state, tableId);
  if (table === null) {
    throw new Error(`deleteTableWithReplacement: block "${tableId}" not found`);
  }
  const parentId = table.parentId;
  if (parentId === null) {
    throw new Error(`deleteTableWithReplacement: "${tableId}" is the root (cannot delete)`);
  }

  const removePlan = planRemoveBlock(state, tableId);
  const isSoleChild = table.prevSiblingId === null && table.nextSiblingId === null;

  if (!isSoleChild) {
    const result = applyOperation(state, (doc) => {
      removeBlockInTx(doc, removePlan);
    });
    return { ...result, newParagraphId: null };
  }

  // Sole child: remove the table AND establish a fresh empty paragraph as the
  // parent's only child, atomically. After removeBlockInTx the parent is empty,
  // so we write the new paragraph + the parent's first/last child directly (an
  // insertBlock plan would carry stale pre-mutation sibling pointers).
  const newParagraphId = allocator.allocate();
  const result = applyOperation(state, (doc) => {
    removeBlockInTx(doc, removePlan);
    assertNoIdCollision(doc, newParagraphId, "deleteTableWithReplacement");
    getBlocksMap(doc).set(
      newParagraphId,
      buildYBlock({
        type: "paragraph",
        attrs: {},
        parentId,
        prevSiblingId: null,
        nextSiblingId: null,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items: [] },
      }),
    );
    const yParent = getYBlock(doc, parentId, "deleteTableWithReplacement");
    yParent.set("firstChildId", newParagraphId);
    yParent.set("lastChildId", newParagraphId);
  });
  return { ...result, newParagraphId };
}
