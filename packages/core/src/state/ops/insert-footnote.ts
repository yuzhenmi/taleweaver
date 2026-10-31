import type * as Y from "yjs";
import { requireBlockText } from "../block-text";
import type { Document, OperationResult } from "../document";
import { applyOperation, resolveBlock } from "../document";
import type { BlockId, IdAllocator } from "../block-id";
import type { Position } from "../block-position";
import {
  inlineContentLength,
  type EmbedItem,
} from "../inline-content";
import {
  requireInTransaction,
  type BlockTreeKind,
} from "../yjs-doc";
import { writeRoot } from "../flow-ops";
import { insertInlineItems } from "../y-inline";
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
 * Pre-computed plan for the anchor-insertion half of `insertFootnote`: the host leaf's
 * tree provenance, the insertion offset and the embed — one offset
 * `insertEmbed` into the leaf's inline `Y.Text` (no other character moves).
 */
interface AnchorInsertPlan {
  readonly blockId: BlockId;
  readonly kind: BlockTreeKind;
  readonly offset: number;
  readonly embed: EmbedItem;
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
 *     header/footer template bodies: a footnote body is multi-paragraph
 *     (pressing Enter splits the child paragraph into siblings UNDER the one
 *     root, instead of orphaning a second `parentId: null` root the slot never
 *     renders). The null `parentId` makes the root-only iterator
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
  document: Document,
  position: Position,
  allocator: IdAllocator,
): InsertFootnoteResult {
  // Allocate BOTH body ids OUTSIDE applyOperation so a retry (if added later)
  // doesn't burn through multiple ids.
  const bodyRootId = allocator.allocate();
  const firstParagraphId = allocator.allocate();

  // Plan the anchor insertion from the pre-tx snapshot (all validation here,
  // BEFORE the transaction opens — mirroring `planInsertText`).
  const anchorPlan = planAnchorInsert(document, position, bodyRootId);

  const result = applyOperation(document, (doc) => {
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
    document: result.document,
    dirtyIds: result.dirtyIds,
    bodyRootId,
    firstParagraphId,
  };
}

/**
 * Validate `position` and produce the anchor-insertion plan (a
 * `footnote-anchor` EmbedItem to insert at `position.offset`,
 * referencing `bodyRootId`). All snapshot reads + validation happen here,
 * BEFORE the surrounding `applyOperation` opens. Throws on every condition the
 * `insertFootnote` docstring lists.
 */
function planAnchorInsert(
  document: Document,
  position: Position,
  bodyRootId: BlockId,
): AnchorInsertPlan {
  const resolved = resolveBlock(document, position.blockId);
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

  return { blockId: position.blockId, kind, offset: position.offset, embed: anchor };
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
  writeRoot(
    doc,
    {
      id: bodyRootId,
      type: FOOTNOTE_BODY_TYPE,
      attrs: {},
      inlineContent: null,
      children: [{ id: firstParagraphId, type: "paragraph", attrs: {}, inlineContent: { items: [] }, children: [] }],
    },
    "embedContent",
  );
}

/**
 * In-transaction primitive: insert the anchor embed into the leaf's inline
 * `Y.Text` at `plan.offset`. Caller owns the
 * surrounding transaction. Routes the write to the leaf's owning tree
 * (`plan.kind`) so an anchor inside a header/footer or another footnote body
 * mutates the correct Y.Map.
 */
function insertAnchorInTx(doc: Y.Doc, plan: AnchorInsertPlan): void {
  requireInTransaction(doc, "insertFootnote");
  insertInlineItems(requireBlockText(doc, plan.blockId, "insertFootnote"), plan.offset, [plan.embed]);
}
