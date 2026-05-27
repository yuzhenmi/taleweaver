import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId, IdAllocator } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import type { InlineContent } from "./inline-content";
import { getBlocksMap, getYBlock } from "./yjs-doc";
import { buildYBlock } from "./y-block";
import { assertNoIdCollision } from "./id-collision-check";
import { STATE_INTERNAL } from "./state-internal";
import { blockKindOf } from "./block-kinds";
import type { BlockKindResolver } from "./block-kinds";

export interface InsertBlockArgs {
  type: string;
  attrs?: ReadonlyAttrs;
  inlineContent?: InlineContent | null;
}

/**
 * Insert a new block as a child of `parentId`, immediately before
 * `beforeSiblingId`. If `beforeSiblingId` is null, the new block is
 * appended as the new last child.
 *
 * Returns OperationResult with the new state and dirtyIds containing:
 *   - the new block's id
 *   - the parent's id ONLY when its firstChildId or lastChildId actually
 *     changed (i.e. boundary insert: prepend or append). Middle inserts
 *     leave the parent unchanged and out of dirtyIds.
 *   - the previous sibling's id (its nextSiblingId is rewired)
 *   - the next sibling's id (its prevSiblingId is rewired)
 *
 * Throws if `parentId` does not exist, or if `beforeSiblingId` is
 * non-null and is not actually a child of `parentId`.
 *
 * When `resolver` is provided, also validates that the parent is a
 * container block (a block-child may only be inserted under a container).
 * Inserting under a leaf (paragraph / image) would create an invalid tree
 * shape; the guard throws before any mutation. When `resolver` is omitted
 * the check is skipped (backward-compatible with callers that lack the
 * component registry).
 */
export function insertBlock(
  state: State,
  parentId: BlockId,
  beforeSiblingId: BlockId | null,
  args: InsertBlockArgs,
  allocator: IdAllocator,
  resolver?: BlockKindResolver,
): OperationResult {
  const parent = getBlock(state, parentId);
  if (!parent) {
    throw new Error(`insertBlock: parent "${parentId}" not found`);
  }

  // Pre-condition (outside the transaction): when a resolver is supplied,
  // refuse to insert a child block under a non-container parent.
  if (resolver !== undefined) {
    const parentKind = blockKindOf(parent.type, resolver);
    if (parentKind !== "container") {
      throw new Error(
        `insertBlock: parent "${parentId}" (type "${parent.type}") is not a container (kind "${parentKind}"); cannot insert a child block under a non-container`,
      );
    }
  }

  // Determine prev / next siblings.
  let prevSiblingId: BlockId | null;
  let nextSiblingId: BlockId | null;

  if (beforeSiblingId === null) {
    // Append: new block becomes lastChild; prev = current lastChild; next = null.
    prevSiblingId = parent.lastChildId;
    nextSiblingId = null;
  } else {
    const beforeSibling = getBlock(state, beforeSiblingId);
    if (!beforeSibling) {
      throw new Error(`insertBlock: beforeSibling "${beforeSiblingId}" not found`);
    }
    if (beforeSibling.parentId !== parentId) {
      throw new Error(
        `insertBlock: beforeSibling "${beforeSiblingId}" is not a child of parent "${parentId}"`,
      );
    }
    nextSiblingId = beforeSiblingId;
    prevSiblingId = beforeSibling.prevSiblingId;
  }

  // Allocate the new block's id outside the transaction so the allocator
  // is bumped exactly once even if the transaction body re-runs.
  const newId = allocator.allocate();

  return applyOperation(state, () => {
    const doc = state[STATE_INTERNAL].doc;
    // Dev-mode defense against allocator id collision (test allocators with
    // counter-based ids can collide with seeded state; production
    // crypto.randomUUID effectively cannot). Without this, Y.Map.set below
    // would silently overwrite the existing block of the same id.
    assertNoIdCollision(doc, newId, "insertBlock");

    // Add the new block to the blocks map with full linkage.
    getBlocksMap(doc).set(
      newId,
      buildYBlock({
        type: args.type,
        attrs: args.attrs ?? {},
        parentId,
        prevSiblingId,
        nextSiblingId,
        firstChildId: null,
        lastChildId: null,
        inlineContent: args.inlineContent ?? null,
      }),
    );

    // Update prev sibling's nextSiblingId (if any) to point at the new block.
    if (prevSiblingId !== null) {
      const yPrev = getYBlock(doc, prevSiblingId, "insertBlock");
      yPrev.set("nextSiblingId", newId);
    }

    // Update next sibling's prevSiblingId (if any) to point at the new block.
    if (nextSiblingId !== null) {
      const yNext = getYBlock(doc, nextSiblingId, "insertBlock");
      yNext.set("prevSiblingId", newId);
    }

    // Update parent's firstChildId / lastChildId only when the new block sits at a
    // boundary. Writing same-value to a Y.Map still fires a change event, which would
    // cause the parent to land in dirtyIds and trigger an unnecessary re-paint.
    if (prevSiblingId === null || nextSiblingId === null) {
      const yParent = getYBlock(doc, parentId, "insertBlock");
      if (prevSiblingId === null) {
        yParent.set("firstChildId", newId);
      }
      if (nextSiblingId === null) {
        yParent.set("lastChildId", newId);
      }
    }
  });
}
