import type { State, OperationResult } from "./state";
import { applyOperation, getBlock } from "./state";
import type { BlockId, IdAllocator } from "./block-id";
import type { ReadonlyAttrs } from "./attrs";
import type { InlineContent } from "./inline-content";
import { getBlocksMap, getYBlock } from "./yjs-doc";
import { buildYBlock } from "./y-block";
import { assertNoIdCollision } from "./id-collision-check";
import { STATE_INTERNAL } from "./state-internal";

export interface SiblingBlockInit {
  type: string;
  attrs?: ReadonlyAttrs;
  // Childless blocks only in v1 (firstChildId/lastChildId are null). Omitted
  // → defaults to `null` (container-shaped), matching `insertBlock`; callers
  // inserting leaves pass `{ items: [] }` (empty leaf) or actual content.
  inlineContent?: InlineContent | null;
}

/**
 * Insert `inits` as a contiguous run of new sibling blocks immediately
 * AFTER `afterBlockId`, preserving order. All writes happen in the single
 * Y.Doc transaction opened by `applyOperation`, so the run lands as one
 * atomic, single-undo edit (replacing an O(k) chain of `insertBlock`
 * calls — see Smell B).
 *
 * Returns OperationResult plus the ordered ids of the freshly inserted
 * blocks. The dirtyIds set is captured automatically from the
 * transaction's change records and contains:
 *   - every new block id,
 *   - `afterBlockId` (its nextSiblingId is rewired to the run head),
 *   - and the boundary block past the run: the old next sibling (its
 *     prevSiblingId is rewired to the run tail) when one exists,
 *     otherwise the parent (its lastChildId is rewired to the run tail).
 *
 * This mirrors `insertBlock`'s boundary-only parent-dirty rule: the
 * parent only lands in dirtyIds when the run is appended at the end.
 *
 * Throws if `afterBlockId` does not exist, or if it is the root (null
 * parent — the root cannot have siblings).
 */
export function insertBlocksAfter(
  state: State,
  afterBlockId: BlockId,
  inits: readonly SiblingBlockInit[],
  allocator: IdAllocator,
): OperationResult & { readonly newBlockIds: readonly BlockId[] } {
  // Pre-read against the pre-mutation snapshot.
  const afterBlock = getBlock(state, afterBlockId);
  if (!afterBlock) {
    throw new Error(`insertBlocksAfter: afterBlock "${afterBlockId}" not found`);
  }
  if (afterBlock.parentId === null) {
    throw new Error(
      `insertBlocksAfter: afterBlock "${afterBlockId}" has null parent (cannot add siblings to the root)`,
    );
  }
  const parentId = afterBlock.parentId;
  const oldNextId = afterBlock.nextSiblingId;

  // Empty inits → no-op identity: return the SAME state ref WITHOUT
  // opening a transaction (mirrors how other ops no-op).
  if (inits.length === 0) {
    return { state, dirtyIds: new Set<BlockId>(), newBlockIds: [] };
  }

  // Allocate ids outside the transaction so the allocator is bumped
  // exactly once even if the transaction body re-runs.
  const newBlockIds: BlockId[] = inits.map(() => allocator.allocate());
  const lastIndex = newBlockIds.length - 1;

  const result = applyOperation(state, () => {
    const doc = state[STATE_INTERNAL].doc;

    // Dev-mode defense against allocator id collision.
    for (const id of newBlockIds) {
      assertNoIdCollision(doc, id, "insertBlocksAfter");
    }

    const blocksMap = getBlocksMap(doc);
    for (let i = 0; i < newBlockIds.length; i++) {
      const newId = newBlockIds[i];
      const init = inits[i];
      const prevSiblingId = i === 0 ? afterBlockId : newBlockIds[i - 1];
      const nextSiblingId = i === lastIndex ? oldNextId : newBlockIds[i + 1];
      blocksMap.set(
        newId,
        buildYBlock({
          type: init.type,
          attrs: init.attrs ?? {},
          parentId,
          prevSiblingId,
          nextSiblingId,
          firstChildId: null,
          lastChildId: null,
          inlineContent: init.inlineContent ?? null,
        }),
      );
    }

    // Relink the boundary. NOTE: `oldNextId` and `parentId` were captured
    // from the pre-mutation snapshot ABOVE — so overwriting afterBlock's
    // nextSiblingId here does not lose the old next sibling (the run tail
    // below still points at it). Keep the boundary reads out of this
    // transaction body to preserve that.
    getYBlock(doc, afterBlockId, "insertBlocksAfter").set(
      "nextSiblingId",
      newBlockIds[0],
    );

    const runTail = newBlockIds[lastIndex];
    if (oldNextId !== null) {
      // The block past the run gets its prevSiblingId rewired to the tail.
      getYBlock(doc, oldNextId, "insertBlocksAfter").set("prevSiblingId", runTail);
    } else {
      // afterBlock was the parent's last child: the run tail becomes the new
      // last child.
      getYBlock(doc, parentId, "insertBlocksAfter").set("lastChildId", runTail);
    }
  });

  return { ...result, newBlockIds };
}
