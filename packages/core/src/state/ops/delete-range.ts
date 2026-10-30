import type * as Y from "yjs";
import { requireBlockText } from "../block-text";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import type { Position, Span } from "../block-position";
import {
  inlineContentLength,
  splitInlineContentAtOffset,

} from "../inline-content";
import { requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { snapOffset, snapRange } from "../y-inline";
import { bookmarksRemovedBy, widenOverBookmarkMarkers } from "../bookmarks";
import { createPosition, createSpan, positionsEqual } from "../block-position";
import type { InlineItem } from "../inline-content";
import { joinWithNext, removeBlockStorage, entityTracker, deleteUnits } from "../flow-ops";
import { normalizeSpan, iterateSpan, isObjectBlock, firstTextAfter } from "../span-iteration";
import { nextBlockInDocOrder, nextBlockAfterSubtree } from "../block-traversal";
import type { Block } from "../block";
import { collectEmbedContentSubtreeFromInlineContent } from "../embed-content-cascade";
import { assertSameTree } from "../assert-same-tree";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).

/**
 * Pre-computed mutation plan for `deleteRangeInTx`. Discriminated by
 * `mode`: same-block deletes `[anchorOffset, focusOffset)` of one block;
 * cross-block deletes the anchor's tail, every intervening block (a leaf's content
 * + ¶, an object / container with its subtree), the focus prefix `[0, focusOffset)`
 * and ¶A — the FOCUS survives (Word: the last ¶ the span needs). An OBJECT endpoint
 * (`isObjectBlock`: the range covers it whole) is removed with the intervening
 * blocks and has no text side: the other endpoint's block survives with its
 * remaining text, unjoined. No character moves. `embedContentIds` is the set of
 * embed-content subtree roots to cascade-delete from `state.embedContents`.
 *
 * `kind` is the owning tree of the span's blocks (resolved once during
 * planning via `resolveBlock`). `deleteRangeInTx` threads it to every
 * block-level `getTreeMap` / `getYBlock` write so a span inside a
 * header/footer body (templateContents) mutates that tree, not the main
 * `blocks` map. Main-tree spans resolve to `"block"` — the historical
 * default. NOTE: the embed-content cascade-delete writes always target the
 * `embedContents` map regardless of `kind` — they delete embed BODIES
 * referenced by dropped inline content, which are independent of the edited
 * block's own tree.
 */
export type DeleteRangePlan =
  | {
      readonly mode: "same-block";
      readonly kind: BlockTreeKind;
      readonly blockId: BlockId;
      /** Normalized deletion range, snapped OUT to grapheme boundaries (block offsets). */
      readonly anchorOffset: number;
      readonly focusOffset: number;
      readonly embedContentIds: ReadonlySet<BlockId>;
      /** The bookmarks the delete removes — one set for the whole span ({@link bookmarkDeletionSpan}). */
      readonly removedBookmarks: ReadonlySet<string>;
    }
  | {
      readonly mode: "cross-block";
      readonly kind: BlockTreeKind;
      /** The text start block whose tail is cut, or null for an object start (removed whole). */
      readonly anchorId: BlockId | null;
      /** The text end block whose prefix is cut, or null for an object end (removed whole). */
      readonly focusId: BlockId | null;
      /** The blocks removed whole, in document order: the intervening siblings and any object endpoint. */
      readonly interveningIds: ReadonlyArray<BlockId>;
      /** The block holding the seam after the delete ({@link seamBlockOf}). */
      readonly seamId: BlockId;
      /**
       * The seam offset in `seamId`: the anchor offset (grapheme-snapped) where the
       * anchor's tail is cut, or 0 for an object start.
       */
      readonly anchorOffset: number;
      /** Focus offset (grapheme-snapped): the focus prefix `[0, focusOffset)` is deleted. */
      readonly focusOffset: number;
      readonly embedContentIds: ReadonlySet<BlockId>;
      readonly removedBookmarks: ReadonlySet<string>;
    };

/**
 * Delete the inline content within a Span.
 *
 * Same-block case: the block's inlineContent becomes
 *   items[0..anchor.offset) ⊕ items[focus.offset..)
 * (adjacent equal-attrs runs read back as one run).
 *
 * Cross-block case (same parent only): the span's ¶s are deleted
 * (¶A and every intervening one) and the FOCUS block survives with
 *   anchor.items[0..anchor.offset) ⊕ focus.items[focus.offset..)
 * (adjacent equal-attrs runs read back as one run). The merge-formatting rule runs
 * once: the anchor's type + attrs + ¶ props are written onto the focus, unless the
 * anchor is left an empty DEFAULT paragraph (Google Docs / Quill); then the focus keeps its own.
 * Every block wholly inside the span — an intervening sibling, or an OBJECT endpoint
 * (`isObjectBlock`, `(objectId, 0)`: the whole object is in the span) — is removed
 * with its subtree. An object endpoint has no text side: no join happens, and the
 * other endpoint's block survives with its remaining text (an object start leaves
 * focus.items[focus.offset..); an object end leaves anchor.items[0..anchor.offset)).
 *
 * Empty-span (collapsed) is a no-op.
 *
 * Returns OperationResult with dirtyIds containing every block id whose
 * Y representation changed (captured by the Y.Doc transaction).
 *
 * Throws if:
 *   - either endpoint references a missing block,
 *   - either endpoint is a container that is not an object (a section, a cell),
 *   - the span crosses parents (cross-parent deleteRange not supported
 *     in this phase — action handlers compose primitives for that),
 *   - cross-context (inherited via normalizeSpan's comparePositions
 *     call which throws on no-common-ancestor),
 *   - any offset is outside [0, inlineContentLength].
 *
 * Y.Doc note: the SAME-BLOCK path is one offset `Y.Text.delete` — every
 * surviving character keeps its CRDT identity, so a `RelativePosition` anchored
 * there survives. The CROSS-BLOCK path deletes characters and ¶ items only: every
 * surviving character (the anchor's prefix, the focus suffix) keeps its identity.
 *
 * Cascade-deletes embed-content references for the DELETED inline portion:
 * walks dropped `EmbedItem.properties.contentBlockId` references and
 * recursively removes each referenced block (plus its descendants and any
 * nested contentBlockId refs) from `state.embedContents`. The transferred
 * suffix (focus.items[focus.offset..) into anchor) is preserved, so embed
 * references that survive the operation are NOT cascade-deleted. Mirrors
 * the same invariant `removeBlock` upholds; see `embed-content-cascade.ts`.
 *
 * Cost: a same-block delete is O(1) block-writes (one offset delete). A cross-block delete is O(K) in K = the blocks
 * the span covers — the focus block plus every intervening leaf are
 * deleted from the owning tree map, all within the single `applyOperation`
 * transaction. K is the selection width, not the document size (a typical
 * edit spans one or two blocks).
 *
 * Composition: see `deleteRangeInTx` for the in-transaction primitive
 * used by `replaceRange` to compose delete + insert in a single Y.Doc
 * transaction (atomic).
 */
export function deleteRange(
  state: State,
  span: Span,
): OperationResult {
  // Empty-span no-op (collapsed-ness is normalization-invariant).
  if (
    span.anchor.blockId === span.focus.blockId &&
    span.anchor.offset === span.focus.offset
  ) {
    return { state, dirtyIds: new Set<BlockId>() };
  }

  const plan = planDeleteRange(state, span);
  if (plan === null) {
    // Re-collapsed after normalization (e.g., reverse-order positions in
    // the same block at the same offset).
    return { state, dirtyIds: new Set<BlockId>() };
  }

  return applyOperation(state, (doc) => {
    deleteRangeInTx(doc, plan);
  });
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `DeleteRangePlan`
 * to `doc`. Caller is responsible for all validation and for opening the
 * surrounding `applyOperation` / `runTransaction` (this function MUST run
 * inside an already-open transaction; it does NOT open one itself).
 *
 * Used by:
 *   - `deleteRange` (thin wrapper that validates + plans + wraps in
 *     `applyOperation`).
 *   - `replaceRange` (composes `deleteRangeInTx` + `insertTextInTx` in a
 *     single `applyOperation` transaction so collab peers can never
 *     observe the post-delete pre-insert mid-state).
 *
 * Postcondition: the deletion seam is at `plan.anchorOffset` (grapheme-snapped by the
 * planner) of the surviving block — the anchor (same-block) or the focus
 * (cross-block, see {@link seamBlockOf}) — so a composed insert targets it.
 */
export function deleteRangeInTx(doc: Y.Doc, plan: DeleteRangePlan): void {
  requireInTransaction(doc, "deleteRange");
  if (plan.mode === "same-block") {
    requireBlockText(doc, plan.blockId, "deleteRange");
    deleteUnits(doc, { spans: [{ id: plan.blockId, from: plan.anchorOffset, to: plan.focusOffset }], removedBookmarks: plan.removedBookmarks });
    for (const id of plan.embedContentIds) removeBlockStorage(doc, id);
    return;
  }
  // Cross-block = the range's characters + the crossed ¶s (+ the blocks wholly
  // inside). No character moves: the anchor prefix continues the focus once ¶A is
  // gone, so a peer's concurrent typing in either survives. Right-to-left keeps
  // offsets valid.
  const removed = plan.removedBookmarks;
  if (plan.focusId !== null) {
    requireBlockText(doc, plan.focusId, "deleteRange");
    deleteUnits(doc, { spans: [{ id: plan.focusId, from: 0, to: plan.focusOffset }], removedBookmarks: removed });
  }
  // The anchor is re-derived after the intervening blocks go: removing one can rename
  // a duplicate copy `X@c:k`.
  const anchorId = plan.anchorId === null ? null : entityTracker(doc, plan.anchorId);
  for (const id of [...plan.interveningIds].reverse()) removeBlockStorage(doc, id, removed);
  if (anchorId !== null) {
    const anchorText = requireBlockText(doc, anchorId(), "deleteRange");
    deleteUnits(doc, { spans: [{ id: anchorId(), from: plan.anchorOffset, to: anchorText.length }], removedBookmarks: removed });
    // An object end has no text side: nothing joins the anchor.
    if (plan.focusId !== null) joinWithNext(doc, anchorId());
  }
  for (const id of plan.embedContentIds) removeBlockStorage(doc, id);
}

/**
 * THE span a deletion — and a copy (`extractFragment`) — of `span` acts on (Word):
 * `span` normalized, widened over the markers just outside it of the bookmarks
 * it covers ALL the content of (`bookmarksRemovedBy`, one computation over every block
 * of the span), with that removed set. So the seam (and the caret) is where a removed
 * start marker was, and a cut of exactly a bookmark's text carries the pair. A
 * collapsed span is returned normalized with nothing removed. O(span).
 */
export function bookmarkDeletionSpan(state: State, span: Span): { readonly span: Span; readonly removed: Set<string> } {
  const n = normalizeSpan(state, span);
  if (positionsEqual(n.anchor, n.focus)) return { span: n, removed: new Set() };
  const removed = bookmarksRemovedBy(
    [...iterateSpan(state, n)].map((r) => ({ items: r.block.inlineContent?.items ?? [], from: r.rangeStart, to: r.rangeEnd })),
  );
  if (removed.size === 0) return { span: n, removed };
  const itemsOf = (id: BlockId): readonly InlineItem[] => resolveBlock(state, id)?.block.inlineContent?.items ?? [];
  const from = widenOverBookmarkMarkers(itemsOf(n.anchor.blockId), n.anchor.offset, "backward", removed);
  const to = widenOverBookmarkMarkers(itemsOf(n.focus.blockId), n.focus.offset, "forward", removed);
  return { span: createSpan(createPosition(n.anchor.blockId, from), createPosition(n.focus.blockId, to)), removed };
}

/**
 * Where a direct `deleteRange(state, span)` leaves the caret — the seam, where the
 * surviving text joins: within one block the span start; cross-block (end block,
 * start offset) — the end block survives; an OBJECT endpoint (removed whole) has no
 * text side, so an object start gives (end block, 0), an object end the start
 * position, two object endpoints the first text block after the span. A removed
 * bookmark's start marker just before the span goes with it
 * ({@link bookmarkDeletionSpan}). Null only when two object endpoints have no text
 * block after them. Assumes a span `deleteRange` accepts. O(span).
 */
export function deleteRangeSeam(state: State, span: Span): Position | null {
  const { span: wide } = bookmarkDeletionSpan(state, span);
  const start = wide.anchor;
  if (start.blockId === wide.focus.blockId) return start;
  const isText = (id: BlockId): boolean => (resolveBlock(state, id)?.block.inlineContent ?? null) !== null;
  if (isText(wide.focus.blockId)) return createPosition(wide.focus.blockId, start.offset);
  return isText(start.blockId) ? start : firstTextAfter(state, wide.focus.blockId);
}

/**
 * The block holding the seam after `plan` runs: the anchor, or (cross-block) the
 * surviving focus — the anchor when the end is an object, the first text block after
 * the span when both endpoints are objects.
 */
export function seamBlockOf(plan: DeleteRangePlan): BlockId {
  return plan.mode === "same-block" ? plan.blockId : plan.seamId;
}

/**
 * Pre-normalize existence + leaf guards for delete/replace ops.
 *
 * Runs the anchor/focus block-exists + is-leaf checks BEFORE
 * `normalizeSpan` is called. This preserves the "deleteRange:" prefixed
 * error contract — without these guards, `normalizeSpan` →
 * `compareBlocksInDocOrder`'s generic "block ... not found" message
 * would leak through and shadow the operation's stated errors.
 *
 * Shared by `planDeleteRange` (delete-range.ts) and `replaceRange`
 * (replace-range.ts), which need identical pre-normalize semantics.
 * Both operations report errors with the "deleteRange:" prefix
 * regardless of the public op name — they share the same error
 * contract because replaceRange composes delete + insert.
 *
 * Throws on missing block or a container endpoint that is not an object
 * (`isObjectBlock`); returns void on success.
 */
export function assertDeleteRangeEndpoints(state: State, span: Span): void {
  const sameBlock = span.anchor.blockId === span.focus.blockId;
  // Map-agnostic: resolve across all three trees so a span inside a
  // header/footer body (templateContents) passes these guards rather than
  // reporting a spurious "not found" (getBlock sees only the main tree).
  const rawAnchor = resolveBlock(state, span.anchor.blockId)?.block ?? null;
  if (!rawAnchor) {
    throw new Error(
      sameBlock
        ? `deleteRange: block "${span.anchor.blockId}" not found`
        : `deleteRange: anchor block "${span.anchor.blockId}" not found`,
    );
  }
  if (!isTextOrObject(rawAnchor)) {
    throw new Error(
      sameBlock
        ? `deleteRange: block "${span.anchor.blockId}" is a container, not a leaf`
        : `deleteRange: anchor block "${span.anchor.blockId}" is a container, not a leaf`,
    );
  }
  if (!sameBlock) {
    const rawFocus = resolveBlock(state, span.focus.blockId)?.block ?? null;
    if (!rawFocus) {
      throw new Error(`deleteRange: focus block "${span.focus.blockId}" not found`);
    }
    if (!isTextOrObject(rawFocus)) {
      throw new Error(
        `deleteRange: focus block "${span.focus.blockId}" is a container, not a leaf`,
      );
    }
  }
}

/**
 * Validate `span` against `state` and produce a `DeleteRangePlan`
 * describing the Y.Doc mutations needed. Returns `null` for the
 * post-normalization re-collapsed case (caller treats as no-op).
 *
 * All validation reads happen here, BEFORE the surrounding
 * `applyOperation` is opened — snapshot reads against the pre-mutation
 * Y.Doc state. The plan captures everything `deleteRangeInTx` needs to
 * run the mutations without further reads.
 *
 * Throws on every condition `deleteRange`'s docstring lists.
 *
 * Used by `deleteRange` and by `replaceRange` (which composes a delete
 * plan + an insert plan into a single transaction). See `deleteRangeInTx`
 * for the dual primitive.
 */
export function planDeleteRange(
  state: State,
  span: Span,
): DeleteRangePlan | null {
  // Pre-normalize existence + leaf guards. These run before normalizeSpan
  // so the operation's stated error contract ("anchor/focus block ... not
  // found", "... is a container") wins over compareBlocksInDocOrder's
  // generic "block ... not found" message that would otherwise leak through
  // the normalizeSpan → comparePositions path. Same architectural pattern
  // applyAttrsToRange uses for the same reason.
  assertDeleteRangeEndpoints(state, span);

  // Now normalize. comparePositions can only throw on cross-context (no
  // common ancestor) since both endpoints have been verified to exist.
  const normalized = normalizeSpan(state, span);

  // SAME-BLOCK case
  if (normalized.anchor.blockId === normalized.focus.blockId) {
    // Map-agnostic: resolve across all three trees (a header/footer body lives
    // in templateContents). `kind` is threaded onto the plan so
    // `deleteRangeInTx` writes into the owning Y.Map.
    const resolved = resolveBlock(state, normalized.anchor.blockId);
    if (!resolved) {
      throw new Error(`deleteRange: block "${normalized.anchor.blockId}" not found`);
    }
    const { block, kind } = resolved;
    if (!block.inlineContent || block.firstChildId !== null) {
      throw new Error(
        `deleteRange: block "${normalized.anchor.blockId}" is a container, not a leaf`,
      );
    }

    const totalLen = inlineContentLength(block.inlineContent);
    if (normalized.anchor.offset < 0 || normalized.anchor.offset > totalLen) {
      throw new Error(
        `deleteRange: anchor offset ${normalized.anchor.offset} out of range [0, ${totalLen}] for block "${normalized.anchor.blockId}"`,
      );
    }
    if (normalized.focus.offset < 0 || normalized.focus.offset > totalLen) {
      throw new Error(
        `deleteRange: focus offset ${normalized.focus.offset} out of range [0, ${totalLen}] for block "${normalized.anchor.blockId}"`,
      );
    }

    // After collapsed-span no-op above, normalized may still be collapsed
    // if the input had reverse-order positions in the same block at the
    // same offset. The normalized form would be identical to either input.
    // Re-check here for completeness.
    if (normalized.anchor.offset === normalized.focus.offset) {
      return null;
    }

    // Widen over the removed bookmarks' edge markers, then snap the range OUT
    // to grapheme boundaries ONCE; every later step uses it.
    const { span: wide, removed: removedBookmarks } = bookmarkDeletionSpan(state, normalized);
    const [startOffset, endOffset] = snapRange(
      block.inlineContent.items,
      wide.anchor.offset,
      wide.focus.offset,
    );
    const [, afterPrefix] = splitInlineContentAtOffset(block.inlineContent, startOffset);

    // Collect embed-content ids referenced by the DELETED inline portion
    // (items[anchor.offset .. focus.offset)). Splitting afterPrefix at
    // (focus.offset - anchor.offset) yields the deleted slice as its
    // prefix. Per the "no orphaned blocks" invariant, dropped EmbedItems
    // own their referenced contentBlockId subtrees and must cascade-delete.
    const deletedLength = endOffset - startOffset;
    const [deletedItems] = splitInlineContentAtOffset(
      { items: afterPrefix },
      deletedLength,
    );
    const embedContentIds = new Set<BlockId>();
    collectEmbedContentSubtreeFromInlineContent(
      state,
      { items: deletedItems },
      embedContentIds,
    );

    return {
      mode: "same-block",
      kind,
      blockId: block.id,
      anchorOffset: startOffset,
      focusOffset: endOffset,
      embedContentIds,
      removedBookmarks,
    };
  }

  // CROSS-BLOCK case
  // Map-agnostic: resolve the anchor across all three trees and use its `kind`
  // as the span's owning tree. The cross-parent refusal below guarantees both
  // endpoints share a parent (so a single `kind` covers the whole span);
  // `assertSameTree` re-verifies the focus + neighbors before any write.
  const anchorResolved = resolveBlock(state, normalized.anchor.blockId);
  if (!anchorResolved) {
    throw new Error(`deleteRange: anchor block "${normalized.anchor.blockId}" not found`);
  }
  const { block: anchorBlock, kind } = anchorResolved;
  const focusBlock = resolveBlock(state, normalized.focus.blockId)?.block ?? null;
  if (!focusBlock) {
    throw new Error(`deleteRange: focus block "${normalized.focus.blockId}" not found`);
  }

  if (!isTextOrObject(anchorBlock)) {
    throw new Error(
      `deleteRange: anchor block "${normalized.anchor.blockId}" is a container, not a leaf`,
    );
  }
  if (!isTextOrObject(focusBlock)) {
    throw new Error(
      `deleteRange: focus block "${normalized.focus.blockId}" is a container, not a leaf`,
    );
  }

  if (anchorBlock.parentId !== focusBlock.parentId) {
    throw new Error(
      `deleteRange: cross-parent spans are not supported in this phase ` +
      `(anchor parent="${anchorBlock.parentId}", focus parent="${focusBlock.parentId}"). ` +
      `Action handlers should decompose into per-parent operations.`,
    );
  }

  // Defensive: same-parent + cross-block implies non-null parent (siblings
  // can't span the root since the root has no siblings).
  const parentId = anchorBlock.parentId;
  if (parentId === null) {
    throw new Error(
      `deleteRange: blocks "${normalized.anchor.blockId}" and "${normalized.focus.blockId}" have null parent (state corruption)`,
    );
  }

  const anchorContent = anchorBlock.inlineContent;
  const focusContent = focusBlock.inlineContent;
  const anchorLen = anchorContent === null ? 0 : inlineContentLength(anchorContent);
  if (normalized.anchor.offset < 0 || normalized.anchor.offset > anchorLen) {
    throw new Error(
      `deleteRange: anchor offset ${normalized.anchor.offset} out of range [0, ${anchorLen}] for block "${normalized.anchor.blockId}"`,
    );
  }
  const focusLen = focusContent === null ? 0 : inlineContentLength(focusContent);
  if (normalized.focus.offset < 0 || normalized.focus.offset > focusLen) {
    throw new Error(
      `deleteRange: focus offset ${normalized.focus.offset} out of range [0, ${focusLen}] for block "${normalized.focus.blockId}"`,
    );
  }

  // Walk the parent's child sibling chain from anchor to focus, collecting the
  // blocks removed whole: an object anchor, every intervening sibling (leaf,
  // object or container — `removeBlockStorage` takes a subtree along), an object
  // focus. Throws if focus is not reachable (which would mean anchor doesn't
  // precede focus in the chain — impossible after normalization unless state is
  // corrupt).
  const interveningIds: BlockId[] = anchorContent === null ? [anchorBlock.id] : [];
  let cur: BlockId | null = anchorBlock.nextSiblingId;
  while (cur !== null && cur !== focusBlock.id) {
    const node = resolveBlock(state, cur)?.block ?? null;
    if (!node) {
      throw new Error(`deleteRange: intervening sibling "${cur}" not found`);
    }
    interveningIds.push(cur);
    cur = node.nextSiblingId;
  }
  if (cur !== focusBlock.id) {
    throw new Error(
      `deleteRange: focus block "${focusBlock.id}" is not reachable from anchor "${anchorBlock.id}" in the parent's sibling chain`,
    );
  }
  if (focusContent === null) interveningIds.push(focusBlock.id);

  // The seam: the surviving focus; the anchor when the end is an object; the first
  // text block after the span when both endpoints are objects.
  const seamId =
    focusContent !== null ? focusBlock.id : anchorContent !== null ? anchorBlock.id : firstTextAfter(state, focusBlock.id)?.blockId ?? null;
  if (seamId === null) {
    throw new Error(`deleteRange: no text block follows the objects "${anchorBlock.id}".."${focusBlock.id}" to hold the seam`);
  }

  // Validate the focus's old nextSibling rewire-target now (outside the
  // transaction) so the "focus block's next sibling not found" error
  // contract is preserved. Symmetric: validate the parent for the
  // last-child rewire branch.
  const focusNextId = focusBlock.nextSiblingId;
  if (focusNextId !== null) {
    if (resolveBlock(state, focusNextId) === null) {
      throw new Error(
        `deleteRange: focus block's next sibling "${focusNextId}" not found`,
      );
    }
  } else {
    if (resolveBlock(state, parentId) === null) {
      throw new Error(
        `deleteRange: parent "${parentId}" of anchor block not found`,
      );
    }
  }

  // Dev-only single-tree invariant: every block this op deletes / rewires
  // (focus, intervening blocks, focus's old next, the parent) must live in the
  // same tree as the anchor (`kind`); otherwise the kind-routed writes below
  // would corrupt state. Production no-op.
  assertSameTree(
    state,
    kind,
    [focusBlock.id, focusNextId, parentId, ...interveningIds],
    "deleteRange",
  );

  // The anchor keeps [0, anchorOffset); the focus suffix follows it. Both endpoints
  // are snapped OUT to grapheme boundaries ONCE (anchor backward, focus forward), so
  // the cuts and the seam agree. An object endpoint has no text: offset 0, nothing cut.
  const { span: wide, removed: removedBookmarks } = bookmarkDeletionSpan(state, normalized);
  const anchorOffset = anchorContent === null ? 0 : snapOffset(anchorContent.items, wide.anchor.offset);
  const focusOffset = focusContent === null ? 0 : snapOffset(focusContent.items, wide.focus.offset, 1);

  // Collect embed-content ids referenced by the DELETED inline portion of
  // the cross-block range. The deleted portion is:
  //   - anchor suffix: items[anchor.offset..) of anchorBlock
  //   - every text block of the blocks removed whole (their subtrees)
  //   - focus prefix: items[..focus.offset) of focusBlock
  // Per the "no orphaned blocks" invariant, dropped EmbedItems own their
  // referenced contentBlockId subtrees and must cascade-delete.
  const embedContentIds = new Set<BlockId>();
  if (anchorContent !== null) {
    const [, anchorDeletedSuffix] = splitInlineContentAtOffset(anchorContent, anchorOffset);
    collectEmbedContentSubtreeFromInlineContent(state, { items: anchorDeletedSuffix }, embedContentIds);
  }
  for (const id of interveningIds) {
    const after = nextBlockAfterSubtree(state, id);
    for (let b: BlockId | null = id; b !== null && b !== after; b = nextBlockInDocOrder(state, b)) {
      const content = resolveBlock(state, b)?.block.inlineContent ?? null;
      if (content !== null) collectEmbedContentSubtreeFromInlineContent(state, content, embedContentIds);
    }
  }
  if (focusContent !== null) {
    const [focusDeletedPrefix] = splitInlineContentAtOffset(focusContent, focusOffset);
    collectEmbedContentSubtreeFromInlineContent(state, { items: focusDeletedPrefix }, embedContentIds);
  }

  return {
    mode: "cross-block",
    kind,
    anchorId: anchorContent === null ? null : anchorBlock.id,
    focusId: focusContent === null ? null : focusBlock.id,
    interveningIds,
    seamId,
    anchorOffset,
    focusOffset,
    embedContentIds,
    removedBookmarks,
  };
}

/** A span endpoint `deleteRange` accepts: a text leaf, or an object (`isObjectBlock`) covered whole. */
function isTextOrObject(block: Block): boolean {
  return (block.inlineContent !== null && block.firstChildId === null) || isObjectBlock(block);
}
