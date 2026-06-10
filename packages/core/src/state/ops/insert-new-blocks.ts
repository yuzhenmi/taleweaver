import type * as Y from "yjs";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import type { InlineItem } from "../inline-content";
import { getTreeMap, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { buildYBlock } from "../y-block";
import { assertNoIdCollision } from "../id-collision-check";

/**
 * A fresh leaf block, fully pre-linked as DATA: every parent/sibling pointer is
 * resolved from the pre-transaction state by the caller, so {@link insertNewBlocksInTx}
 * needs no live-doc lookup to write it. Each block is materialized into its OWN
 * tree (`kind`).
 */
export interface NewBlockSpec {
  readonly id: BlockId;
  readonly kind: BlockTreeKind;
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  readonly items: readonly InlineItem[];
  readonly parentId: BlockId;
  readonly prevSiblingId: BlockId;
  readonly nextSiblingId: BlockId | null;
}

/**
 * Materialize a run of NEW leaf blocks whose parent/sibling pointers are already
 * fully resolved as DATA. Each block is written into its own tree (`spec.kind`).
 *
 * Unlike {@link insertBlocksAfterInTx} (main-tree only, computes prev/next from an
 * `afterBlockId` anchor), this primitive does NOT rewire any existing block — the
 * CALLER's plan owns the boundary writes (the prefix block's `nextSiblingId` and the
 * old-next's `prevSiblingId` / parent's `lastChildId` are set by the caller via its
 * own writes). This lets the fragment plan (paste-as-suggestion) compute the entire
 * post-op block structure as data and apply it in one transaction. Must run inside an
 * `applyOperation` transaction.
 */
export function insertNewBlocksInTx(doc: Y.Doc, specs: readonly NewBlockSpec[]): void {
  requireInTransaction(doc, "insertNewBlocks");
  for (const s of specs) assertNoIdCollision(doc, s.id, "insertNewBlocks");
  for (const s of specs) {
    getTreeMap(doc, s.kind).set(
      s.id,
      buildYBlock({
        type: s.type,
        attrs: s.attrs,
        parentId: s.parentId,
        prevSiblingId: s.prevSiblingId,
        nextSiblingId: s.nextSiblingId,
        firstChildId: null,
        lastChildId: null,
        inlineContent: { items: [...s.items] },
      }),
    );
  }
}
