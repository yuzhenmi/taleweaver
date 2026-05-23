import * as Y from "yjs";
import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import { STATE_INTERNAL } from "./state-internal";
import type { BlockId } from "./block-id";
import type { Position } from "./block-position";
import type { ReadonlyAttrs } from "./attrs";
import { attrsEqual } from "./attrs";
import {
  inlineContentLength,
  splitInlineContentAtOffset,
  mergeAdjacentTextItems,
  findItemAtOffset,
  type InlineItem,
} from "./inline-content";
import { getYBlock } from "./yjs-doc";
import { buildYInlineContent } from "./y-block";

/**
 * Pre-computed mutation plan for `insertTextInTx`. Discriminated by
 * `mode`:
 *   - `in-place`: insert into an existing Y.Text run at `itemIndex` /
 *     `within`, preserving its per-character CRDT identity.
 *   - `full-replace`: rebuild the block's Y.Array<inlineContent> from
 *     `items`. Used for cases where in-place mutation cannot reproduce
 *     the documented result shape (attrs split, embed-adjacent, empty
 *     block, post-delete CRDT-identity-already-blown anchor block, etc.).
 */
export type InsertTextPlan = {
  readonly blockId: BlockId;
} & (
  | {
      readonly mode: "in-place";
      readonly itemIndex: number;
      readonly within: number;
      readonly text: string;
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
 */
export function insertText(
  state: State,
  position: Position,
  text: string,
  attrs: ReadonlyAttrs,
): OperationResult {
  if (text === "") {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  const plan = planInsertText(state, position, text, attrs);
  return applyOperation(state, () => {
    insertTextInTx(state[STATE_INTERNAL].doc, plan);
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
  if (plan.mode === "in-place") {
    const yBlock = getYBlock(doc, plan.blockId, "insertText");
    const yItems = yBlock.get("inlineContent") as Y.Array<Y.Map<unknown>>;
    const yItem = yItems.get(plan.itemIndex);
    const yText = yItem.get("text") as Y.Text;
    yText.insert(plan.within, plan.text);
    return;
  }

  const yBlock = getYBlock(doc, plan.blockId, "insertText");
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
): InsertTextPlan {
  const block = getBlock(state, position.blockId);
  if (block === null) {
    throw new Error(`insertText: block "${position.blockId}" not found`);
  }
  if (block.inlineContent === null) {
    throw new Error(`insertText: block "${position.blockId}" is not a leaf (no inlineContent)`);
  }

  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertText: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  return planInsertTextOnItems(position.blockId, block.inlineContent.items, position.offset, text, attrs);
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
 * NOTE: this helper is unsafe for the post-delete composition path
 * (`replaceRange`), because by then the anchor block's Y.Array has been
 * fully replaced by `deleteRangeInTx` via `buildYInlineContent` — the
 * old Y.Text identity is gone. Use `planInsertTextFullReplace` instead
 * from that path.
 *
 * Caller must guarantee `items` is normalized in the sense that
 * `offset ∈ [0, sum(item.length)]`.
 */
function planInsertTextOnItems(
  blockId: BlockId,
  items: ReadonlyArray<InlineItem>,
  offset: number,
  text: string,
  attrs: ReadonlyAttrs,
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
  const inPlace = findInPlaceTarget(items, offset, attrs);

  if (inPlace !== null) {
    return {
      blockId,
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
  const merged = mergeAdjacentTextItems([...left, newRun, ...right]);

  return {
    blockId,
    mode: "full-replace",
    items: merged,
  };
}

/**
 * Build a `full-replace` InsertTextPlan against a pre-computed `items`
 * array (e.g., the `mergedItems` of a `DeleteRangePlan`). Used by
 * `replaceRange` to compose insert AFTER delete in a single transaction:
 * the post-delete Y.Array doesn't exist yet (`deleteRangeInTx` will
 * create it), so we can't use the in-place strategy — full-replace it is.
 *
 * Caller must guarantee `offset ∈ [0, sum(item.length)]`. For
 * `replaceRange`, this is always true: the seam offset is
 * `normalized.anchor.offset` and `mergedItems` has length equal to
 * `anchor.offset + (focus block's length - focus.offset)` ≥ anchor.offset.
 */
export function planInsertTextFullReplace(
  blockId: BlockId,
  items: ReadonlyArray<InlineItem>,
  offset: number,
  text: string,
  attrs: ReadonlyAttrs,
): InsertTextPlan {
  const [left, right] = splitInlineContentAtOffset({ items }, offset);
  const newRun: InlineItem = { kind: "text", text, attrs };
  const merged = mergeAdjacentTextItems([...left, newRun, ...right]);

  return {
    blockId,
    mode: "full-replace",
    items: merged,
  };
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
): { itemIndex: number; within: number } | null {
  if (hasAdjacentSameAttrsTextPair(items)) return null;
  return pickCandidate(items, offset, attrs);
}

function hasAdjacentSameAttrsTextPair(items: ReadonlyArray<InlineItem>): boolean {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const curr = items[i];
    if (prev.kind === "text" && curr.kind === "text" && attrsEqual(prev.attrs, curr.attrs)) {
      return true;
    }
  }
  return false;
}

function pickCandidate(
  items: ReadonlyArray<InlineItem>,
  offset: number,
  attrs: ReadonlyAttrs,
): { itemIndex: number; within: number } | null {
  const { itemIndex, withinItem } = findItemAtOffset({ items }, offset);

  // Case: offset at end of content. itemIndex === items.length.
  // If the last item is text with matching attrs, append to it.
  if (itemIndex === items.length) {
    const last = items.length - 1;
    if (last >= 0) {
      const lastItem = items[last];
      if (lastItem.kind === "text" && attrsEqual(lastItem.attrs, attrs)) {
        return { itemIndex: last, within: lastItem.text.length };
      }
    }
    return null;
  }

  const here = items[itemIndex];

  // Case: offset strictly inside a text item.
  if (withinItem > 0) {
    if (here.kind === "text" && attrsEqual(here.attrs, attrs)) {
      return { itemIndex, within: withinItem };
    }
    return null;
  }

  // withinItem === 0: leading edge of items[itemIndex].
  // Prefer the trailing edge of the previous item if it's a matching-attrs
  // text item (trailing-edge preference).
  if (itemIndex > 0) {
    const prev = items[itemIndex - 1];
    if (prev.kind === "text" && attrsEqual(prev.attrs, attrs)) {
      return { itemIndex: itemIndex - 1, within: prev.text.length };
    }
  }

  // No matching prev — try the leading edge of items[itemIndex].
  if (here.kind === "text" && attrsEqual(here.attrs, attrs)) {
    return { itemIndex, within: 0 };
  }

  return null;
}
