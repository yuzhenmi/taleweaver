import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { Position } from "../block-position";
import {
  inlineContentLength,
  splitInlineContentAtOffset,
  mergeAdjacentTextItems,
  type EmbedItem,
  type InlineItem,
} from "../inline-content";
import {
  getEmbedContentsMap,
  getYBlock,
  requireInTransaction,
  type BlockTreeKind,
} from "../yjs-doc";
import { buildYBlock, buildYInlineContent } from "../y-block";
import { assertNoIdCollision } from "../id-collision-check";

/** The `embedType` discriminant for a footnote call marker. */
export const FOOTNOTE_ANCHOR_EMBED_TYPE = "footnote-anchor";

/** The block `type` for a footnote body CONTAINER root. */
const FOOTNOTE_BODY_TYPE = "footnote-body";

/**
 * Result of `insertFootnote`. Extends `OperationResult` with the new footnote
 * body's CONTAINER ROOT id (`bodyRootId` — the id the anchor's
 * `properties.contentBlockId` links to, and the one root the slot lays out) and
 * the id of its FIRST (and only) paragraph CHILD (`firstParagraphId` — the
 * editable caret target for the create→type chain).
 */
export interface InsertFootnoteResult extends OperationResult {
  readonly bodyRootId: BlockId;
  readonly firstParagraphId: BlockId;
}

/**
 * Pre-computed plan for the anchor-insertion half of `insertFootnote`: the
 * leaf block's tree provenance plus the new `items[]` after the anchor is
 * spliced in at `position.offset`. A footnote anchor never lands mid-text-run
 * in a way that merges with neighbours (an embed is a barrier), so this is
 * always a full-replace of the leaf's inlineContent.
 */
interface AnchorInsertPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly items: ReadonlyArray<InlineItem>;
}

/**
 * Insert a footnote at `position`, atomically (ONE `applyOperation`
 * transaction → one undo entry, one collab event). Composes two writes:
 *
 *  1. A fresh `footnote-body` CONTAINER root (`parentId: null` — a tree root in
 *     embedContents, NOT a child; `inlineContent: null` — it's a container)
 *     whose `firstChildId`/`lastChildId` point at the paragraph child below,
 *     plus a fresh empty `paragraph` CHILD (`parentId: <container>`) — the
 *     editable line the caret lands in. The CONTAINER model mirrors
 *     header/footer template bodies (#326): a footnote body is multi-paragraph
 *     (pressing Enter splits the child paragraph into siblings UNDER the one
 *     root, instead of orphaning a second `parentId: null` root the slot never
 *     renders). The null `parentId` makes the #313 root-only iterator
 *     (`getEmbedContentIds`) pick up EXACTLY this one root.
 *  2. A `footnote-anchor` `EmbedItem` spliced into the cursor leaf's
 *     `inlineContent` at `position.offset`, with empty `attrs` and
 *     `properties.contentBlockId` = the new body root id. (Per the embed-content
 *     convention, `contentBlockId` lives in the untyped `properties` bag, which
 *     is what `embed-content-cascade` reads.)
 *
 * Both halves run in one transaction so the orphan + shared invariants
 * (`assertNoOrphanedEmbedContent` / `assertNoSharedEmbedContent`, run in dev
 * mode inside `applyOperation`) never observe a mid-state where the anchor
 * exists without its body (or vice versa). The result is a clean 1:1
 * anchor↔body mapping.
 *
 * Delete is NOT implemented here — removing the anchor (via `removeBlock` /
 * `deleteRange`) already cascade-deletes the body through
 * `embed-content-cascade`. Paste (`clonePastedSubtree`) already remaps
 * `contentBlockId` to a fresh body clone. Both are existing behaviour this op
 * slots into.
 *
 * `dirtyIds` covers the new body root, the new paragraph child (both fresh
 * embedContents keys), AND the anchor's leaf block (its inlineContent changed)
 * — `captureDirtyIds` tracks all three top-level maps automatically.
 *
 * Throws if:
 *   - `position.blockId` does not resolve to a block.
 *   - the block is not a leaf (no `inlineContent`).
 *   - `position.offset` is outside `[0, inlineContentLength(content)]`.
 *
 * NOTE: this op is NOT idempotent — it always creates a fresh anchor + body.
 */
export function insertFootnote(
  state: State,
  position: Position,
  allocator: IdAllocator,
): InsertFootnoteResult {
  // Allocate BOTH body ids OUTSIDE applyOperation so a retry (if added later)
  // doesn't burn through multiple ids.
  const bodyRootId = allocator.allocate();
  const firstParagraphId = allocator.allocate();

  // Plan the anchor insertion from the pre-tx snapshot (all validation here,
  // BEFORE the transaction opens — mirroring `planInsertText`).
  const anchorPlan = planAnchorInsert(state, position, bodyRootId);

  const result = applyOperation(state, (doc) => {
    // Dev-mode defense against allocator id collision (counter-based test
    // allocators can collide with seeded state). Checks all three trees.
    assertNoIdCollision(doc, bodyRootId, "insertFootnote");
    assertNoIdCollision(doc, firstParagraphId, "insertFootnote");

    // (1) Materialize the body subtree into embedContents.
    insertFootnoteBodyInTx(doc, bodyRootId, firstParagraphId);

    // (2) Splice the anchor into the leaf's inlineContent.
    insertAnchorInTx(doc, anchorPlan);
  });

  return {
    state: result.state,
    dirtyIds: result.dirtyIds,
    bodyRootId,
    firstParagraphId,
  };
}

/**
 * Validate `position` and produce the anchor-insertion plan (the new leaf
 * `items[]` with a `footnote-anchor` EmbedItem spliced in at `position.offset`,
 * referencing `bodyRootId`). All snapshot reads + validation happen here,
 * BEFORE the surrounding `applyOperation` opens. Throws on every condition the
 * `insertFootnote` docstring lists.
 */
function planAnchorInsert(
  state: State,
  position: Position,
  bodyRootId: BlockId,
): AnchorInsertPlan {
  const resolved = resolveBlock(state, position.blockId);
  if (resolved === null) {
    throw new Error(`insertFootnote: block "${position.blockId}" not found`);
  }
  const { block, kind } = resolved;
  if (block.inlineContent === null) {
    throw new Error(
      `insertFootnote: block "${position.blockId}" is not a leaf (no inlineContent)`,
    );
  }

  const totalLen = inlineContentLength(block.inlineContent);
  if (position.offset < 0 || position.offset > totalLen) {
    throw new Error(
      `insertFootnote: offset ${position.offset} out of range [0, ${totalLen}] for block "${position.blockId}"`,
    );
  }

  const anchor: EmbedItem = Object.freeze({
    kind: "embed",
    embedType: FOOTNOTE_ANCHOR_EMBED_TYPE,
    attrs: Object.freeze({}),
    properties: Object.freeze({ contentBlockId: bodyRootId }),
  });

  const [left, right] = splitInlineContentAtOffset(
    block.inlineContent,
    position.offset,
  );
  // An embed is a merge barrier, so `mergeAdjacentTextItems` only normalizes
  // the split halves around it (e.g. re-joining a text run we never split, or
  // dropping a zero-length item) — it never merges across the anchor.
  const items = mergeAdjacentTextItems([...left, anchor, ...right]);

  return { blockId: position.blockId, kind, items };
}

/**
 * In-transaction primitive: materialize the footnote body CONTAINER root +
 * its empty paragraph child into the embedContents map. Caller owns the
 * surrounding transaction.
 */
function insertFootnoteBodyInTx(
  doc: Y.Doc,
  bodyRootId: BlockId,
  firstParagraphId: BlockId,
): void {
  requireInTransaction(doc, "insertFootnote");
  const embedTree = getEmbedContentsMap(doc);

  embedTree.set(
    bodyRootId,
    buildYBlock({
      type: FOOTNOTE_BODY_TYPE,
      attrs: {},
      parentId: null,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: firstParagraphId,
      lastChildId: firstParagraphId,
      inlineContent: null,
    }),
  );

  embedTree.set(
    firstParagraphId,
    buildYBlock({
      type: "paragraph",
      attrs: {},
      parentId: bodyRootId,
      prevSiblingId: null,
      nextSiblingId: null,
      firstChildId: null,
      lastChildId: null,
      inlineContent: { items: [] },
    }),
  );
}

/**
 * In-transaction primitive: full-replace the anchor leaf's inlineContent with
 * the pre-computed `plan.items` (anchor spliced in). Caller owns the
 * surrounding transaction. Routes the write to the leaf's owning tree
 * (`plan.kind`) so an anchor inside a header/footer or another footnote body
 * mutates the correct Y.Map.
 */
function insertAnchorInTx(doc: Y.Doc, plan: AnchorInsertPlan): void {
  requireInTransaction(doc, "insertFootnote");
  const yBlock = getYBlock(doc, plan.blockId, "insertFootnote", plan.kind);
  yBlock.set("inlineContent", buildYInlineContent({ items: plan.items }));
}
