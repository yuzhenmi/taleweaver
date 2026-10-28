import type * as Y from "yjs";
import { requireBlockText } from "../block-text";
import type { BlockId } from "../block-id";
import type { InlineItem } from "../inline-content";
import { requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { insertInlineItems } from "../y-inline";
import { attrRegistryOf } from "../mark-attrs";

/**
 * Pre-computed mutation plan for `insertItemsInTx` — the arbitrary-`InlineItem[]`
 * generalization of `insertTextInTx`. Both are offset writes into the block's
 * inline `Y.Text`; no existing character is re-minted.
 *
 * The insert canonicalizes against the attr registry bound to the doc (registry-equal
 * neighbour attrs are written with the neighbour's stored value). `kind` is the
 * tree the block lives in, so a caret inside a header/footer body mutates the
 * OWNING map.
 */
export interface InsertItemsPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly offset: number;
  readonly items: ReadonlyArray<InlineItem>;
}

/** Plan an insertion of `items` at `offset`. Caller guarantees `offset` is in range at apply time. */
export function planInsertItemsAt(
  blockId: BlockId,
  kind: BlockTreeKind,
  offset: number,
  items: ReadonlyArray<InlineItem>,
): InsertItemsPlan {
  return { blockId, kind, offset, items };
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `InsertItemsPlan` to `doc`.
 * MUST run inside an already-open transaction.
 */
export function insertItemsInTx(doc: Y.Doc, plan: InsertItemsPlan): void {
  requireInTransaction(doc, "insertItems");
  const yText = requireBlockText(doc, plan.blockId, "insertItems");
  insertInlineItems(yText, plan.offset, plan.items, attrRegistryOf(doc));
}
