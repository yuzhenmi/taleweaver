import type * as Y from "yjs";
import type { BlockId } from "../block-id";
import type { InlineItem } from "../inline-content";
import { getYBlock, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { deleteInlineRange, insertInlineItems, requireYInline } from "../y-inline";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";

/**
 * Pre-computed mutation plan for `insertItemsInTx` — the arbitrary-`InlineItem[]`
 * generalization of `insertTextInTx`. Both are offset writes into the block's
 * inline `Y.Text`; no existing character is re-minted.
 *
 *   - `insert`: insert `items` at `offset`.
 *   - `replace-tail`: keep `[0:offset)`, delete the rest of the block, then append
 *     `items`. Used to TRUNCATE the start block of a multi-block suggested fragment.
 *
 * `registry` is threaded to the insert's canonicalization (registry-equal
 * neighbour attrs are written with the neighbour's stored value). `kind` is the
 * tree the block lives in, so a caret inside a header/footer body mutates the
 * OWNING map.
 */
export interface InsertItemsPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly mode: "insert" | "replace-tail";
  readonly offset: number;
  readonly items: ReadonlyArray<InlineItem>;
  readonly registry?: AttrRegistry;
}

/** Plan an insertion of `items` at `offset`. Caller guarantees `offset` is in range at apply time. */
export function planInsertItemsAt(
  blockId: BlockId,
  kind: BlockTreeKind,
  offset: number,
  items: ReadonlyArray<InlineItem>,
  registry?: AttrRegistry,
): InsertItemsPlan {
  return { blockId, kind, mode: "insert", offset, items, registry };
}

/** Plan a `replace-tail`: keep `[0:keepOffset)`, delete the rest, append `items`. */
export function planReplaceBlockTail(
  blockId: BlockId,
  kind: BlockTreeKind,
  keepOffset: number,
  items: ReadonlyArray<InlineItem>,
  registry?: AttrRegistry,
): InsertItemsPlan {
  return { blockId, kind, mode: "replace-tail", offset: keepOffset, items, registry };
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `InsertItemsPlan` to `doc`.
 * MUST run inside an already-open transaction.
 */
export function insertItemsInTx(doc: Y.Doc, plan: InsertItemsPlan): void {
  requireInTransaction(doc, "insertItems");
  const yBlock = getYBlock(doc, plan.blockId, "insertItems", plan.kind);
  const yText = requireYInline(yBlock, plan.blockId, "insertItems");
  if (plan.mode === "replace-tail") deleteInlineRange(yText, plan.offset, yText.length);
  insertInlineItems(yText, plan.offset, plan.items, plan.registry);
}
