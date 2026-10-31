import type * as Y from "yjs";
import type { Document, OperationResult } from "../document";
import { applyOperation, resolveBlock } from "../document";
import type { BlockId } from "../block-id";
import { requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { markDeletionOf, markDeletableInFinal, deleteParagraphMarkInTx, writeBreakTagInTx } from "../break-suggestions";
import { DELETION_TAG_KEY } from "../break-tags";
import { blockAfter } from "../paragraph-neighbour";
import { inlineContentLength } from "../inline-content";
import { assertSameTree } from "../assert-same-tree";
import { joinWithNext } from "../flow-ops";
import {
  writeSuggestionRecordInTx,
  type SuggestionMintInput,
} from "../suggestions";

// Shared empty dirty-set for identity no-op returns (mirror suggestion-ops.ts's
// NO_DIRTY): a degenerate `markParagraphMarkDeletion` returns the input `document`
// reference + this shared empty set so callers can short-circuit on
// `result.document === state`.
const NO_DIRTY: ReadonlySet<BlockId> = new Set<BlockId>();

/** Pre-computed mutation plan for `mergeAdjacentBlocksInTx` (plain data): the two blocks + their tree. */
export interface MergeBlocksPlan {
  readonly leftId: BlockId;
  readonly rightId: BlockId;
  readonly kind: BlockTreeKind;
}

/** `mergeAdjacentBlocks`' result: the surviving block R (the caret's home). */
export interface MergeBlocksResult extends OperationResult {
  readonly survivorId: BlockId;
}

/**
 * Merge two adjacent leaf siblings (Word): delete ¶L. The survivor
 * is R — the paragraph whose ¶ now ends the joined content [...L, ...R]; L leaves the
 * read model. L's type + attrs + ¶ character props (`markAttrs`) are written onto R as a
 * key-wise diff (Google Docs / Quill: the first paragraph's formatting wins — which also
 * covers an empty R), except when L is an EMPTY DEFAULT paragraph: it is removed and R
 * keeps its formatting (Google Docs / Quill). No character moves, so a peer's concurrent typing in either
 * block survives; equal-attrs runs either side of the seam read as one.
 *
 * Throws if either block does not exist, `leftId === rightId`, either is a container,
 * they have different parents, or they are not adjacent siblings.
 *
 * Composition: `mergeAdjacentBlocksInTx` runs inside a caller's transaction.
 */
export function mergeAdjacentBlocks(
  document: Document,
  leftId: BlockId,
  rightId: BlockId,
): MergeBlocksResult {
  const plan = planMergeAdjacentBlocks(document, leftId, rightId);
  const r = applyOperation(document, (doc) => {
    mergeAdjacentBlocksInTx(doc, plan);
  });
  return { ...r, survivorId: plan.rightId };
}

/**
 * Validate the requested merge against the pre-mutation `document` snapshot and
 * produce a `MergeBlocksPlan`. Throws on every condition
 * `mergeAdjacentBlocks`'s docstring lists.
 *
 * All validation reads happen here, BEFORE the surrounding `applyOperation`
 * is opened. The plan captures everything `mergeAdjacentBlocksInTx` needs to
 * run the mutations without further reads from `document`.
 */
export function planMergeAdjacentBlocks(
  document: Document,
  leftId: BlockId,
  rightId: BlockId,
): MergeBlocksPlan {
  if (leftId === rightId) {
    throw new Error(`mergeAdjacentBlocks: left and right are the same block "${leftId}"`);
  }

  // Resolve the reference (left) block ONCE to learn its owning tree (`kind`);
  // every kind-routed write in `inTx` targets that tree. `right` and the other
  // neighbors are asserted to live in the same tree below.
  const leftResolved = resolveBlock(document, leftId);
  if (leftResolved === null) {
    throw new Error(`mergeAdjacentBlocks: left block "${leftId}" not found`);
  }
  const { block: left, kind } = leftResolved;
  const right = resolveBlock(document, rightId)?.block ?? null;
  if (right === null) {
    throw new Error(`mergeAdjacentBlocks: right block "${rightId}" not found`);
  }

  if (!left.inlineContent || left.firstChildId !== null) {
    throw new Error(
      `mergeAdjacentBlocks: left block "${leftId}" is a container, not a leaf`,
    );
  }
  if (!right.inlineContent || right.firstChildId !== null) {
    throw new Error(
      `mergeAdjacentBlocks: right block "${rightId}" is a container, not a leaf`,
    );
  }

  if (left.parentId !== right.parentId) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" have different parents ` +
      `("${left.parentId}" vs "${right.parentId}")`,
    );
  }

  if (left.nextSiblingId !== rightId || right.prevSiblingId !== leftId) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" are not adjacent siblings ` +
      `(left.nextSiblingId="${left.nextSiblingId}", right.prevSiblingId="${right.prevSiblingId}")`,
    );
  }

  // Defensive — same-parent + adjacency implies non-null parent (siblings can't
  // both be the root, since the root is unique and has no siblings).
  const parentId = left.parentId;
  if (parentId === null) {
    throw new Error(
      `mergeAdjacentBlocks: blocks "${leftId}" and "${rightId}" have null parent (state corruption)`,
    );
  }

  // The neighbours the merge touches (right — the survivor —, its next sibling, the
  // parent) must live in the SAME tree as the left block. (Dev-only; production no-op.)
  assertSameTree(
    document,
    kind,
    [rightId, right.nextSiblingId, parentId],
    "mergeAdjacentBlocks",
  );

  return { leftId, rightId, kind };
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `MergeBlocksPlan`
 * to `doc`. Caller is responsible for all validation and for opening the
 * surrounding `applyOperation` / `runTransaction` (this function MUST run
 * inside an already-open transaction; it does NOT open one itself).
 *
 * Used by:
 *   - `mergeAdjacentBlocks` (thin wrapper that validates + plans + wraps
 *     in `applyOperation`).
 *   - Future composers needing to chain a block merge with another `*InTx`
 *     op inside ONE Y.Doc transaction.
 *
 * Reads right's LIVE inline items (to append them to left), so it composes
 * after prior in-tx ops on either block.
 */
export function mergeAdjacentBlocksInTx(
  doc: Y.Doc,
  plan: MergeBlocksPlan,
): void {
  requireInTransaction(doc, "mergeAdjacentBlocks");
  // Delete the left paragraph's ¶: its content now continues the right block (no
  // character moves, so a peer's concurrent typing in either block survives).
  joinWithNext(doc, plan.leftId);
}

/** `markParagraphMarkDeletion`'s result: when the author's OWN pending ¶ was removed instead. */
export interface JoinSuggestionResult extends OperationResult {
  /**
   * Set when ¶L was the author's own pending insertion, removed for real (= its reject)
   * instead of being keyed: the block after it (the survivor of the merge) + the caret
   * offset where the two paragraphs now meet.
   */
  readonly removedBoundary: { readonly survivorId: BlockId; readonly offset: number } | null;
}

/**
 * Suggested deletion of ¶`leftBlockId` (Backspace at the start of the block after it,
 * Delete at its end, a section-end item included; Word's tracked ¶ deletion), in
 * ONE tracked transaction, WITHOUT merging (both paragraphs show while it is pending):
 *   - the author's own pending insertion → ¶L is removed for real (`removedBoundary`);
 *   - a live deletion already there (any author) → identity no-op (the editor moves the
 *     caret across the ¶);
 *   - a ¶ that accepting would not delete (invariant I on the "final" projection:
 *     `markDeletableInFinal`) → identity no-op;
 *   - else `deletionSuggestionId` on ¶L's entry + a `deletion` record.
 */
export function markParagraphMarkDeletion(
  document: Document,
  leftBlockId: BlockId,
  input: SuggestionMintInput,
): JoinSuggestionResult {
  const none: JoinSuggestionResult = { document, dirtyIds: NO_DIRTY, removedBoundary: null };
  const left = resolveBlock(document, leftBlockId)?.block ?? null;
  if (left === null || left.inlineContent === null) return none;
  const rule = markDeletionOf(document, left, input.author);
  if (rule === "keep") return none;
  if (rule === "remove") {
    const after = blockAfter(document, left)?.block ?? null;
    let removed = false;
    const r = applyOperation(document, (d) => {
      removed = deleteParagraphMarkInTx(d, left.id);
    });
    if (!removed) return none;
    const survivorId = after === null ? left.id : after.id;
    return { ...r, removedBoundary: { survivorId, offset: after?.inlineContent === null ? 0 : inlineContentLength(left.inlineContent) } };
  }
  if (!markDeletableInFinal(document, left)) return none;
  const r = applyOperation(document, (d) => {
    writeBreakTagInTx(d, left.id, DELETION_TAG_KEY, input.id);
    writeSuggestionRecordInTx(d, {
      id: input.id,
      kind: "deletion",
      author: input.author,
      createdAt: input.createdAt,
      order: input.order,
    });
  });
  return { ...r, removedBoundary: null };
}
