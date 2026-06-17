import type * as Y from "yjs";
import type { BlockId } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import { findItemAtOffset, type InlineItem } from "../inline-content";
import { getYBlock, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { buildYInlineItem } from "../y-block";
import { mergeAdjacentSameAttrsTextItemsInPlace, yMapAsObject } from "../y-utils";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";

/**
 * Pre-computed mutation plan for `insertItemsInTx` — the arbitrary-`InlineItem[]`
 * generalization of `insert-text.ts`'s `split-in-place` mode (which inserts a single
 * text run). Both modes mutate a block's LIVE Y.Array in place, preserving every
 * UNTOUCHED run's Y.Text CRDT identity. Discriminated by `mode`:
 *
 *   - `split-in-place`: insert `items` at `itemIndex` / `within`, preserving every
 *     OTHER run's Y.Text identity. A boundary insert (`within === 0`, or
 *     end-of-content) splits nothing; a mid-run insert splits ONLY the straddling
 *     run. The arbitrary-items twin of `insertText`'s `split-in-place`.
 *   - `replace-tail`: keep `[0:keepOffset]` (resolved to `itemIndex` / `within`),
 *     delete the rest of the block, then append `items`. Used to TRUNCATE the start
 *     block B of a multi-block suggested fragment (n > 1) while keeping B's prefix
 *     runs' identity.
 *
 * Carries an optional `registry` threaded to the post-insert coalesce normalizer
 * (`mergeAdjacentSameAttrsTextItemsInPlace`), so interpreters with a custom per-key
 * `equals` opt into custom adjacent-item compare semantics. `kind` is the tree
 * (main / embedContents / templateContents) the block lives in, resolved once during
 * planning and threaded to `getYBlock` so a caret inside a header/footer body mutates
 * the OWNING map. Main-tree blocks resolve to `"block"` (the `getYBlock` default).
 */
export type InsertItemsPlan = {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
  readonly registry?: AttrRegistry;
} & (
  | { readonly mode: "split-in-place"; readonly itemIndex: number; readonly within: number }
  | { readonly mode: "replace-tail"; readonly itemIndex: number; readonly within: number }
);

/**
 * Plan a `split-in-place` insertion of `items` against a pre-computed `liveItems`
 * array that is KNOWN to be the live, identity-preserved Y.Array's content (e.g. a
 * block's post-surgical-strike content). The arbitrary-items twin of
 * `planInsertTextSplitInPlace`. Caller guarantees `offset ∈ [0, sum(item.length)]`.
 */
export function planInsertItemsSplitInPlace(
  blockId: BlockId,
  kind: BlockTreeKind,
  liveItems: ReadonlyArray<InlineItem>,
  offset: number,
  items: ReadonlyArray<InlineItem>,
  registry?: AttrRegistry,
): InsertItemsPlan {
  const { itemIndex, withinItem } = findItemAtOffset({ items: liveItems }, offset);
  return { blockId, kind, mode: "split-in-place", itemIndex, within: withinItem, items, registry };
}

/**
 * Plan a `replace-tail` against a pre-computed `liveItems` array that is KNOWN to be
 * the live, identity-preserved Y.Array's content: keep `[0:keepOffset]`, delete the
 * rest, append `items`. Used to truncate the start block of a multi-block suggested
 * fragment while preserving the kept prefix runs' Y.Text identity. Caller guarantees
 * `keepOffset ∈ [0, sum(item.length)]`.
 */
export function planReplaceBlockTailInPlace(
  blockId: BlockId,
  kind: BlockTreeKind,
  liveItems: ReadonlyArray<InlineItem>,
  keepOffset: number,
  items: ReadonlyArray<InlineItem>,
  registry?: AttrRegistry,
): InsertItemsPlan {
  const { itemIndex, withinItem } = findItemAtOffset({ items: liveItems }, keepOffset);
  return { blockId, kind, mode: "replace-tail", itemIndex, within: withinItem, items, registry };
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `InsertItemsPlan` to `doc`.
 * Caller is responsible for all validation and for opening the surrounding
 * `applyOperation` / `runTransaction` (this function MUST run inside an
 * already-open transaction; it does NOT open one itself).
 *
 * Preserves every untouched run's Y.Text CRDT identity:
 *   - `split-in-place`: a boundary / end insert splits nothing; a mid-run insert
 *     splits ONLY the straddling run (its two halves become fresh Y.Text).
 *   - `replace-tail`: the kept prefix runs are untouched; only the straddling run at
 *     `keepOffset` (if any) is split, and the dropped tail is deleted.
 *
 * After the structural edit, `mergeAdjacentSameAttrsTextItemsInPlace` restores the
 * normalization invariant (with the plan's optional `registry` threaded) — a
 * converging seam keeps the receiver run's Y.Text identity.
 */
export function insertItemsInTx(doc: Y.Doc, plan: InsertItemsPlan): void {
  requireInTransaction(doc, "insertItems");
  const yBlock = getYBlock(doc, plan.blockId, "insertItems", plan.kind);
  const yItems = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
  const newRuns = plan.items.map((it) => buildYInlineItem(it));

  if (plan.mode === "split-in-place") {
    if (plan.itemIndex >= yItems.length) {
      // end-of-content → append
      yItems.insert(yItems.length, newRuns);
    } else if (plan.within === 0) {
      // run boundary → insert before the run at itemIndex (no run splits)
      yItems.insert(plan.itemIndex, newRuns);
    } else {
      // strictly inside a text run → split before/after, new runs between.
      // within>0 only resolves inside a TEXT item (embeds are length 1, boundaries
      // are within===0), so the text read is safe.
      const yItem = yItems.get(plan.itemIndex);
      const full = (yItem.get("text") as Y.Text).toString();
      const existing = yMapAsObject(yItem.get("attrs") as Y.Map<unknown>) as ReadonlyAttrs;
      const before = buildYInlineItem({ kind: "text", text: full.slice(0, plan.within), attrs: existing });
      const after = buildYInlineItem({ kind: "text", text: full.slice(plan.within), attrs: existing });
      yItems.delete(plan.itemIndex, 1);
      yItems.insert(plan.itemIndex, [before, ...newRuns, after]);
    }
  } else {
    // replace-tail: keep [0:keepOffset], delete the rest, append `items`.
    if (plan.within === 0) {
      // keepOffset is at a run boundary → drop [itemIndex:] wholesale, then append.
      yItems.delete(plan.itemIndex, yItems.length - plan.itemIndex);
      yItems.insert(yItems.length, newRuns);
    } else {
      // keepOffset is strictly inside a text run → keep its prefix half, drop the
      // straddler + everything after, then append.
      const yItem = yItems.get(plan.itemIndex);
      const full = (yItem.get("text") as Y.Text).toString();
      const existing = yMapAsObject(yItem.get("attrs") as Y.Map<unknown>) as ReadonlyAttrs;
      const before = buildYInlineItem({ kind: "text", text: full.slice(0, plan.within), attrs: existing });
      yItems.delete(plan.itemIndex, yItems.length - plan.itemIndex);
      yItems.insert(yItems.length, [before, ...newRuns]);
    }
  }
  mergeAdjacentSameAttrsTextItemsInPlace(yItems, plan.registry);
}
