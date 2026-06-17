import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import type { InlineContent } from "../inline-content";
import { getBlocksMap, getYBlock, requireInTransaction } from "../yjs-doc";
import { buildYBlock } from "../y-block";
import { assertNoIdCollision } from "../id-collision-check";

export interface SiblingBlockInit {
  type: string;
  attrs?: ReadonlyAttrs;
  // Childless blocks only in v1 (firstChildId/lastChildId are null). Omitted
  // → defaults to `null` (container-shaped), matching `insertBlock`; callers
  // inserting leaves pass `{ items: [] }` (empty leaf) or actual content.
  inlineContent?: InlineContent | null;
}

/**
 * Pre-computed mutation plan for `insertBlocksAfterInTx`. Captures the
 * fully-resolved write inputs, all read from the pre-mutation snapshot:
 *   - `parentId` — the parent the run is spliced under.
 *   - `afterBlockId` — the existing block the run is inserted immediately after
 *     (its `nextSiblingId` is rewired to the run head).
 *   - `oldNextId` — `afterBlock.nextSiblingId` at plan time. When non-null, the
 *     block past the run gets its `prevSiblingId` rewired to the run tail; when
 *     null, `afterBlock` was the parent's last child, so the parent's
 *     `lastChildId` is rewired to the run tail instead.
 *   - `entries` — the run, in order, each carrying its freshly-allocated `id`
 *     plus the block's initial shape (`type` / `attrs` / `inlineContent`, with
 *     defaults applied at plan time). Ids are allocated once each, in
 *     `planInsertBlocksAfter`, outside any transaction.
 *
 * `inTx` infers the boundary-write decision (rewire old-next vs. rewire parent)
 * from the null-ness of `oldNextId`, mirroring the original op so the parent
 * only lands in `dirtyIds` on an append.
 *
 * TREE SCOPE: operates on the MAIN `blocks` tree only (mirrors the public op).
 * The plan does not carry a `kind` field for that reason.
 */
export interface InsertBlocksAfterPlan {
  readonly parentId: BlockId;
  readonly afterBlockId: BlockId;
  readonly oldNextId: BlockId | null;
  readonly entries: readonly {
    readonly id: BlockId;
    readonly type: string;
    readonly attrs: ReadonlyAttrs;
    readonly inlineContent: InlineContent | null;
  }[];
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
 *
 * TREE SCOPE: operates on the MAIN `blocks` tree only (like `insertBlock`,
 * unlike the inline ops). All current callers insert into the main document
 * tree; an embed/template-content variant would need `kind` routing.
 *
 * Composition: see `insertBlocksAfterInTx` for the in-transaction primitive
 * that lets callers chain this structural run-insert with other `*InTx` ops
 * inside a single Y.Doc transaction (one undo entry / one collab event).
 */
export function insertBlocksAfter(
  state: State,
  afterBlockId: BlockId,
  inits: readonly SiblingBlockInit[],
  allocator: IdAllocator,
): OperationResult & { readonly newBlockIds: readonly BlockId[] } {
  const plan = planInsertBlocksAfter(state, afterBlockId, inits, allocator);

  // Empty inits → no-op identity: return the SAME state ref WITHOUT
  // opening a transaction (mirrors how other ops no-op).
  if (plan === null) {
    return { state, dirtyIds: new Set<BlockId>(), newBlockIds: [] };
  }

  const result = applyOperation(state, (doc) => {
    insertBlocksAfterInTx(doc, plan);
  });

  return { ...result, newBlockIds: plan.entries.map((e) => e.id) };
}

/**
 * Validate the requested run-insert against the pre-mutation `state` snapshot
 * and produce an `InsertBlocksAfterPlan`. Throws on every condition
 * `insertBlocksAfter`'s docstring lists.
 *
 * Returns `null` for an empty `inits` (the public op turns that into the
 * no-op identity return without opening a transaction — mirrors
 * `planDeleteRange` returning `null`).
 *
 * Allocates each new block id via `allocator` (once each, outside any tx) so
 * the allocator is bumped exactly once even if the transaction body re-runs.
 */
export function planInsertBlocksAfter(
  state: State,
  afterBlockId: BlockId,
  inits: readonly SiblingBlockInit[],
  allocator: IdAllocator,
): InsertBlocksAfterPlan | null {
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

  if (inits.length === 0) {
    return null;
  }

  // Allocate ids outside the transaction so the allocator is bumped exactly
  // once even if the transaction body re-runs.
  const entries = inits.map((init) => ({
    id: allocator.allocate(),
    type: init.type,
    attrs: init.attrs ?? {},
    inlineContent: init.inlineContent ?? null,
  }));

  return {
    parentId: afterBlock.parentId,
    afterBlockId,
    oldNextId: afterBlock.nextSiblingId,
    entries,
  };
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `InsertBlocksAfterPlan`
 * to `doc`. Caller is responsible for all validation and for opening the
 * surrounding `applyOperation` / `runTransaction` (this function MUST run
 * inside an already-open transaction; it does NOT open one itself).
 *
 * Used by:
 *   - `insertBlocksAfter` (thin wrapper that validates + plans + wraps in
 *     `applyOperation`).
 *   - Future composers (e.g., paste-with-formatting / bulk-import that
 *     materialize a run of sibling blocks atomically with other edits) that
 *     need to chain multiple `*InTx` calls inside ONE Y.Doc transaction.
 *
 * Mirrors the original public op's boundary-write discipline: the boundary
 * past the run is relinked via `oldNextId` (the block past the run's
 * `prevSiblingId`) when one exists, otherwise the parent's `lastChildId`, so
 * middle inserts don't add the parent to `dirtyIds`.
 *
 * TREE SCOPE: writes to the main `blocks` map only. See the docstring on the
 * public `insertBlocksAfter` for rationale and the plan's lack of a `kind`
 * field.
 */
export function insertBlocksAfterInTx(doc: Y.Doc, plan: InsertBlocksAfterPlan): void {
  requireInTransaction(doc, "insertBlocksAfter");

  // Dev-mode defense against allocator id collision.
  for (const e of plan.entries) {
    assertNoIdCollision(doc, e.id, "insertBlocksAfter");
  }

  const blocksMap = getBlocksMap(doc);
  const lastIndex = plan.entries.length - 1;
  for (const [i, entry] of plan.entries.entries()) {
    const prevEntry = plan.entries[i - 1];
    const nextEntry = plan.entries[i + 1];
    const prevSiblingId = i === 0 ? plan.afterBlockId : (prevEntry?.id ?? null);
    const nextSiblingId = i === lastIndex ? plan.oldNextId : (nextEntry?.id ?? null);
    blocksMap.set(
      entry.id,
      buildYBlock({
        type: entry.type,
        attrs: entry.attrs,
        parentId: plan.parentId,
        prevSiblingId,
        nextSiblingId,
        firstChildId: null,
        lastChildId: null,
        inlineContent: entry.inlineContent,
      }),
    );
  }

  // Relink the boundary. NOTE: `plan.oldNextId` and `plan.parentId` were
  // captured from the pre-mutation snapshot in `planInsertBlocksAfter` — so
  // overwriting afterBlock's nextSiblingId here does not lose the old next
  // sibling (the run tail above still points at it).
  const firstEntry = plan.entries[0];
  const lastEntry = plan.entries[lastIndex];
  if (firstEntry === undefined || lastEntry === undefined) {
    throw new Error("insertBlocksAfter: plan has no entries (unreachable)");
  }
  getYBlock(doc, plan.afterBlockId, "insertBlocksAfter").set(
    "nextSiblingId",
    firstEntry.id,
  );

  const runTail = lastEntry.id;
  if (plan.oldNextId !== null) {
    // The block past the run gets its prevSiblingId rewired to the tail.
    getYBlock(doc, plan.oldNextId, "insertBlocksAfter").set("prevSiblingId", runTail);
  } else {
    // afterBlock was the parent's last child: the run tail becomes the new
    // last child.
    getYBlock(doc, plan.parentId, "insertBlocksAfter").set("lastChildId", runTail);
  }
}
