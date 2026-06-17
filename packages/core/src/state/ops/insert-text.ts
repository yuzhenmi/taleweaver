import * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Position } from "../block-position";
import type { ReadonlyAttrs } from "../attrs";
import { attrsEqual } from "../attrs";
import {
  inlineContentLength,
  splitInlineContentAtOffset,
  mergeAdjacentTextItems,
  findItemAtOffset,
  type InlineItem,
} from "../inline-content";
import { getYBlock, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { buildYInlineContent, buildYInlineItem } from "../y-block";
import { mergeAdjacentSameAttrsTextItemsInPlace, yMapAsObject } from "../y-utils";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";

/**
 * Pre-computed mutation plan for `insertTextInTx`. Discriminated by
 * `mode`:
 *   - `in-place`: insert into an existing Y.Text run at `itemIndex` /
 *     `within`, preserving its per-character CRDT identity.
 *   - `split-in-place`: insert a DIFFERENTLY-attributed run into the
 *     block's LIVE Y.Array, preserving every OTHER run's Y.Text identity.
 *     A boundary insert (`within === 0`, or end-of-content) splits nothing;
 *     a mid-run insert splits ONLY the straddling run. Used by
 *     `replaceWithSuggestion` to drop a suggested run against a block whose
 *     live array is identity-preserved (e.g. surgically struck, not
 *     full-replaced). Carries `attrs` (the new run's attrs) and an optional
 *     `registry` (threaded to the post-insert coalesce normalizer).
 *   - `full-replace`: rebuild the block's Y.Array<inlineContent> from
 *     `items`. Used for cases where in-place mutation cannot reproduce
 *     the documented result shape (attrs split, embed-adjacent, empty
 *     block, post-delete CRDT-identity-already-blown anchor block, etc.).
 */
export type InsertTextPlan = {
  readonly blockId: BlockId;
  // The tree (main / embedContents / templateContents) the block lives in,
  // resolved once during planning. `insertTextInTx` threads it to every
  // `getYBlock` write so a caret inside a header/footer body (templateContents)
  // mutates the OWNING map, not the hardcoded main map. Main-tree blocks
  // resolve to `"block"`, the `getYBlock` default — byte-identical to before.
  readonly kind: BlockTreeKind;
} & (
  | {
      readonly mode: "in-place";
      readonly itemIndex: number;
      readonly within: number;
      readonly text: string;
    }
  | {
      readonly mode: "split-in-place";
      readonly itemIndex: number;
      readonly within: number;
      readonly text: string;
      readonly attrs: ReadonlyAttrs;
      readonly registry?: AttrRegistry;
    }
  | {
      readonly mode: "full-replace";
      readonly items: ReadonlyArray<InlineItem>;
    }
);

/**
 * Insert text into a leaf block's inlineContent at `position`.
 *
 * `attrs` is the attribute bag for the inserted text. Caller computes
 * surrounding-context attrs (e.g., from the cursor's containing run).
 *
 * Returns OperationResult with dirtyIds = { position.blockId }.
 *
 * Behavior:
 *   - Empty `text`: no-op (returns original state with empty dirtyIds).
 *   - Insert in middle of a same-attrs text item: splice text in.
 *   - Insert in middle of a different-attrs text item: split the item
 *     into prefix + new + suffix.
 *   - Insert at a boundary: create new text item or merge with adjacent
 *     same-attrs item.
 *   - Adjacent text items with equal attrs are merged in a normalize pass.
 *
 * Throws if:
 *   - The block does not exist.
 *   - The block is not a leaf (has no inlineContent).
 *   - `position.offset` is outside `[0, inlineContentLength(content)]`.
 *
 * Implementation: prefer a Y.Text-preserving in-place mutation when the
 * insertion point lands inside (or adjacent to) a text run whose attrs
 * match the incoming attrs — this preserves per-character CRDT identity
 * across edits, which is what Yjs is for. Falls back to a full-replace
 * (compute new items via pure helpers, then rebuild the Y.Array) for
 * cases where in-place mutation cannot reproduce the documented result
 * shape (e.g., different-attrs split, insertion adjacent to embed, empty
 * block).
 *
 * Composition: see `insertTextInTx` for the in-transaction primitive
 * used by `replaceRange` to compose delete + insert in a single Y.Doc
 * transaction (T12 atomicity).
 *
 * `registry` (optional): an `AttrRegistry`; threaded to the run-merge
 * normalizer (`mergeAdjacentTextItems`) and the in-place merge-decision
 * helpers, so interpreters with a custom per-key `equals` (e.g. a
 * `comment` interpreter that ignores `timestamp`) opt into custom
 * adjacent-item compare semantics. Omitted → deep-value compare.
 */
export function insertText(
  state: State,
  position: Position,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): OperationResult {
  if (text === "") {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  const plan = planInsertText(state, position, text, attrs, registry);
  return applyOperation(state, (doc) => {
    insertTextInTx(doc, plan);
  });
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `InsertTextPlan`
 * to `doc`. Caller is responsible for all validation and for opening the
 * surrounding `applyOperation` / `runTransaction` (this function MUST run
 * inside an already-open transaction; it does NOT open one itself).
 *
 * Used by:
 *   - `insertText` (thin wrapper that validates + plans + wraps in
 *     `applyOperation`).
 *   - `replaceRange` (composes `deleteRangeInTx` + `insertTextInTx` in a
 *     single `applyOperation` transaction so collab peers can never
 *     observe the post-delete pre-insert mid-state).
 */
export function insertTextInTx(doc: Y.Doc, plan: InsertTextPlan): void {
  requireInTransaction(doc, "insertText");
  if (plan.mode === "in-place") {
    const yBlock = getYBlock(doc, plan.blockId, "insertText", plan.kind);
    const yItems = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
    const yItem = yItems.get(plan.itemIndex);
    const yText = yItem.get("text") as Y.Text;
    yText.insert(plan.within, plan.text);
    return;
  }

  if (plan.mode === "split-in-place") {
    const yBlock = getYBlock(doc, plan.blockId, "insertText", plan.kind);
    const yItems = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
    const newRun = buildYInlineItem({ kind: "text", text: plan.text, attrs: plan.attrs });

    if (plan.itemIndex >= yItems.length) {
      // end-of-content → append
      yItems.insert(yItems.length, [newRun]);
    } else if (plan.within === 0) {
      // run boundary → insert before the run at itemIndex (no run splits)
      yItems.insert(plan.itemIndex, [newRun]);
    } else {
      // strictly inside a text run → split before/after, new run between.
      // within>0 only resolves inside a TEXT item (embeds are length 1, boundaries
      // are within===0), so the text read is safe.
      const yItem = yItems.get(plan.itemIndex);
      const full = (yItem.get("text") as Y.Text).toString();
      const existing = yMapAsObject(yItem.get("attrs") as Y.Map<unknown>) as ReadonlyAttrs;
      const before = buildYInlineItem({ kind: "text", text: full.slice(0, plan.within), attrs: existing });
      const after = buildYInlineItem({ kind: "text", text: full.slice(plan.within), attrs: existing });
      yItems.delete(plan.itemIndex, 1);
      yItems.insert(plan.itemIndex, [before, newRun, after]);
    }
    mergeAdjacentSameAttrsTextItemsInPlace(yItems, plan.registry);
    return;
  }

  const yBlock = getYBlock(doc, plan.blockId, "insertText", plan.kind);
  yBlock.set("inlineContent", buildYInlineContent({ items: plan.items }));
}

/**
 * Validate `position` + `text` against `state` and produce an
 * `InsertTextPlan` describing the Y.Doc mutation. Caller is responsible
 * for the `text === ""` short-circuit BEFORE calling this — `planInsertText`
 * assumes a non-empty text argument and will produce a redundant plan
 * (in-place insert of empty string / full-replace identical items) if
 * called with `text === ""`.
 *
 * All validation reads happen here, BEFORE the surrounding
 * `applyOperation` is opened. Throws on every condition `insertText`'s
 * docstring lists.
 *
 * Used by the public `insertText` wrapper. `replaceRange` does NOT call
 * this — see `planInsertTextFullReplace` below for the
 * post-delete composition path's planner.
 */
export function planInsertText(
  state: State,
  position: Position,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): InsertTextPlan {
  const resolved = resolveBlock(state, position.blockId);
  if (resolved === null) {
    throw new Error(`insertText: block "${position.blockId}" not found`);
  }
  const { block, kind } = resolved;
  if (block.inlineContent === null) {
    throw new Error(`insertText: block "${position.blockId}" is not a leaf (no inlineContent)`);
  }

  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertText: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  return planInsertTextOnItems(position.blockId, kind, block.inlineContent.items, position.offset, text, attrs, registry);
}

/**
 * Plan an insertion against a pre-computed items array. Considers
 * `findInPlaceTarget` and returns an in-place plan when an existing
 * Y.Text run can absorb the new text (preserves per-character CRDT
 * identity); otherwise falls back to a full-replace plan.
 *
 * Currently called only by `planInsertText` — the items array passed in
 * is `block.inlineContent.items`, a snapshot of the CURRENT Y.Array, so
 * in-place targeting is safe (it points at the live Y.Text).
 *
 * NOTE: this helper is unsafe for the CROSS-BLOCK `replaceRange` post-delete
 * path, because there `deleteRangeInTx` full-replaces the anchor block's Y.Array
 * via `buildYInlineContent` — the old Y.Text identity is gone, so in-place
 * targeting against the (stale) snapshot would point at a dead Y.Text; that path
 * uses `planInsertTextFullReplace`. The SAME-BLOCK `replaceRange` path is fine
 * to mutate in place (its delete is surgical, leaving the live Y.Array intact),
 * but it uses `planInsertTextSplitInPlace` (driven by the known post-delete
 * `mergedItems`), not this helper, which reads from a live `State` snapshot.
 *
 * Caller must guarantee `items` is normalized in the sense that
 * `offset ∈ [0, sum(item.length)]`.
 */
function planInsertTextOnItems(
  blockId: BlockId,
  kind: BlockTreeKind,
  items: ReadonlyArray<InlineItem>,
  offset: number,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): InsertTextPlan {
  // Identify the in-place target text item (if any). Two cases:
  //   (a) offset lies strictly inside a text item (withinItem > 0) with matching attrs.
  //   (b) offset is at the leading edge of a text item (withinItem === 0) AND
  //       the previous item is a text item with matching attrs — prefer the
  //       trailing edge of the prev item (the "trailing-edge of text"
  //       preference, so we can keep the prev run's CRDT identity).
  //   (c) offset is at the leading edge of a text item with matching attrs
  //       and no eligible prev (e.g., at offset 0 or after an embed).
  //   (d) offset is at end of content AND the last item is text with
  //       matching attrs — mutate the last item.
  const inPlace = findInPlaceTarget(items, offset, attrs, registry);

  if (inPlace !== null) {
    return {
      blockId,
      kind,
      mode: "in-place",
      itemIndex: inPlace.itemIndex,
      within: inPlace.within,
      text,
    };
  }

  // Full-replace fallback: compute new items via the existing pure
  // helpers, then rebuild the Y.Array. Used when no eligible
  // matching-attrs text run exists at/adjacent to the insertion point
  // (different attrs split, embed-adjacent, empty block, etc.).
  const [left, right] = splitInlineContentAtOffset({ items }, offset);
  const newRun: InlineItem = { kind: "text", text, attrs };
  const merged = mergeAdjacentTextItems([...left, newRun, ...right], registry);

  return {
    blockId,
    kind,
    mode: "full-replace",
    items: merged,
  };
}

/**
 * Build a `full-replace` InsertTextPlan against a pre-computed `items`
 * array (e.g., the `mergedItems` of a `DeleteRangePlan`). Used by the
 * CROSS-BLOCK `replaceRange` post-delete composition: the cross-block
 * `deleteRangeInTx` full-replaces the anchor block's Y.Array via
 * `buildYInlineContent`, destroying its Y.Text identity, so an in-place
 * insert against it would be unsafe — full-replace it is.
 *
 * The SAME-BLOCK `replaceRange` post-delete insert NO LONGER uses this: its
 * delete is surgical (in place, identity-preserved), so the live Y.Array
 * survives and the insert runs through {@link planInsertTextSplitInPlace}
 * (preserving untouched-run identity). `replaceWithSuggestion`'s suggested-insert
 * path likewise uses split-in-place (#492). This full-replace planner now serves
 * only the cross-block `replaceRange` path (until cross-block delete is surgical).
 *
 * Caller must guarantee `offset ∈ [0, sum(item.length)]`. For
 * `replaceRange`, this is always true: the seam offset is
 * `normalized.anchor.offset` and `mergedItems` has length equal to
 * `anchor.offset + (focus block's length - focus.offset)` ≥ anchor.offset.
 *
 * `kind` is the tree the anchor block lives in (resolved by the caller via
 * `resolveBlock`); threaded onto the plan so `insertTextInTx` writes into the
 * owning Y.Map. Main-tree callers pass `"block"` (the `getYBlock` default).
 */
export function planInsertTextFullReplace(
  blockId: BlockId,
  kind: BlockTreeKind,
  items: ReadonlyArray<InlineItem>,
  offset: number,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): InsertTextPlan {
  const [left, right] = splitInlineContentAtOffset({ items }, offset);
  const newRun: InlineItem = { kind: "text", text, attrs };
  const merged = mergeAdjacentTextItems([...left, newRun, ...right], registry);

  return {
    blockId,
    kind,
    mode: "full-replace",
    items: merged,
  };
}

/**
 * Plan a DIFFERENT-attrs insertion against a pre-computed `items` array that is KNOWN
 * to be the live, identity-preserved Y.Array's content (e.g. a block's
 * post-surgical-strike content). Produces a `split-in-place` plan: the new run is
 * inserted at a run boundary (no identity loss) or splits the straddling run (only that
 * run loses identity), preserving every other run's Y.Text. Use ONLY when the target
 * block's live Y.Array matches `items` item-for-item AND retains identity (i.e. it was
 * NOT full-replaced earlier in the same transaction). Caller guarantees
 * `offset ∈ [0, sum(item.length)]`.
 */
export function planInsertTextSplitInPlace(
  blockId: BlockId,
  kind: BlockTreeKind,
  items: ReadonlyArray<InlineItem>,
  offset: number,
  text: string,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): InsertTextPlan {
  const { itemIndex, withinItem } = findItemAtOffset({ items }, offset);
  return { blockId, kind, mode: "split-in-place", itemIndex, within: withinItem, text, attrs, registry };
}

/**
 * Pick the target text item for an in-place Y.Text insertion, using the
 * "prefer trailing edge of text item" preference. Returns `null` when no
 * in-place mutation is possible (caller falls back to the full-replace
 * path).
 *
 * Bails to `null` if the items array contains ANY adjacent same-attrs
 * text pair (i.e., the block is already unnormalized). The in-place
 * strategy only mutates a single Y.Text in isolation, so it would leave
 * such pre-existing unnormalized adjacencies untouched. The full-replace
 * fallback runs `mergeAdjacentTextItems` over the whole items array and
 * therefore restores the normalized-adjacency invariant.
 */
function findInPlaceTarget(
  items: ReadonlyArray<InlineItem>,
  offset: number,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): { itemIndex: number; within: number } | null {
  if (hasAdjacentSameAttrsTextPair(items, registry)) return null;
  return pickCandidate(items, offset, attrs, registry);
}

function hasAdjacentSameAttrsTextPair(
  items: ReadonlyArray<InlineItem>,
  registry?: AttrRegistry,
): boolean {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    if (prev === undefined || curr === undefined) continue;
    if (prev.kind === "text" && curr.kind === "text" && attrsEqual(prev.attrs, curr.attrs, registry)) {
      return true;
    }
  }
  return false;
}

function pickCandidate(
  items: ReadonlyArray<InlineItem>,
  offset: number,
  attrs: ReadonlyAttrs,
  registry?: AttrRegistry,
): { itemIndex: number; within: number } | null {
  const { itemIndex, withinItem } = findItemAtOffset({ items }, offset);

  // Case: offset at end of content. itemIndex === items.length.
  // If the last item is text with matching attrs, append to it.
  if (itemIndex === items.length) {
    const last = items.length - 1;
    const lastItem = items[last];
    if (last >= 0 && lastItem !== undefined) {
      if (lastItem.kind === "text" && attrsEqual(lastItem.attrs, attrs, registry)) {
        return { itemIndex: last, within: lastItem.text.length };
      }
    }
    return null;
  }

  const here = items[itemIndex];
  if (here === undefined) return null;

  // Case: offset strictly inside a text item.
  if (withinItem > 0) {
    if (here.kind === "text" && attrsEqual(here.attrs, attrs, registry)) {
      return { itemIndex, within: withinItem };
    }
    return null;
  }

  // withinItem === 0: leading edge of items[itemIndex].
  // Prefer the trailing edge of the previous item if it's a matching-attrs
  // text item (trailing-edge preference).
  if (itemIndex > 0) {
    const prev = items[itemIndex - 1];
    if (prev !== undefined && prev.kind === "text" && attrsEqual(prev.attrs, attrs, registry)) {
      return { itemIndex: itemIndex - 1, within: prev.text.length };
    }
  }

  // No matching prev — try the leading edge of items[itemIndex].
  if (here.kind === "text" && attrsEqual(here.attrs, attrs, registry)) {
    return { itemIndex, within: 0 };
  }

  return null;
}
