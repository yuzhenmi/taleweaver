import type * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, getBlock } from "../state";
import type { BlockId, IdAllocator } from "../block-id";
import type { ReadonlyAttrs } from "../attrs";
import type { InlineContent } from "../inline-content";
import { getBlocksMap, getYBlock, requireInTransaction } from "../yjs-doc";
import { buildYBlock } from "../y-block";
import { assertNoIdCollision } from "../id-collision-check";
import type { BlockKindResolver } from "../block-kinds";

export interface InsertBlockArgs {
  type: string;
  attrs?: ReadonlyAttrs;
  inlineContent?: InlineContent | null;
}

/**
 * Pre-computed mutation plan for `insertBlockInTx`. Captures the
 * fully-resolved write inputs:
 *   - `parentId`, `newId` — the parent and the freshly-allocated new block id.
 *   - `prevSiblingId` / `nextSiblingId` — the surrounding linked-list pointers,
 *     resolved at plan time from the pre-mutation snapshot (`parent.lastChildId`
 *     for append, `beforeSibling.prevSiblingId` for insert-before).
 *   - `type` / `attrs` / `inlineContent` — the new block's initial shape, taken
 *     verbatim from `InsertBlockArgs` (defaults applied at plan time).
 *
 * `inTx` infers the boundary-write decisions (whether to update
 * `parent.firstChildId` / `parent.lastChildId`) from the null-ness of
 * `prevSiblingId` / `nextSiblingId`: a `null` prev means the new block
 * becomes the parent's new first child; a `null` next means it becomes the
 * new last child. Mirrors the original `insertBlock` logic — equal-value
 * writes are still avoided on middle inserts so `dirtyIds` doesn't grow
 * spuriously.
 *
 * TREE SCOPE: operates on the MAIN `blocks` tree only (mirrors the public op).
 * The plan does not carry a `kind` field for that reason.
 */
export interface InsertBlockPlan {
  readonly parentId: BlockId;
  readonly newId: BlockId;
  readonly prevSiblingId: BlockId | null;
  readonly nextSiblingId: BlockId | null;
  readonly type: string;
  readonly attrs: ReadonlyAttrs;
  readonly inlineContent: InlineContent | null;
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
 *
 * TREE SCOPE: operates on the MAIN `blocks` tree only (unlike the inline ops,
 * which route to the owning tree via `resolveBlock`). All current callers
 * insert into the main document tree. Inserting a structural block into an
 * embed/template-content body (e.g. a list inside a header) would need a
 * `kind`-routed variant; do not call this for those trees as-is.
 *
 * Composition: see `insertBlockInTx` for the in-transaction primitive that
 * lets callers chain a structural insert with other `*InTx` ops inside a
 * single Y.Doc transaction (one undo entry / one collab event).
 */
export function insertBlock(
  state: State,
  parentId: BlockId,
  beforeSiblingId: BlockId | null,
  args: InsertBlockArgs,
  allocator: IdAllocator,
  resolver?: BlockKindResolver,
): OperationResult {
  const plan = planInsertBlock(state, parentId, beforeSiblingId, args, allocator, resolver);
  return applyOperation(state, (doc) => {
    insertBlockInTx(doc, plan);
  });
}

/**
 * Validate the requested insertion against the pre-mutation `state` snapshot
 * and produce an `InsertBlockPlan`. Throws on every condition `insertBlock`'s
 * docstring lists.
 *
 * Allocates the new block id via `allocator` so the allocator is bumped exactly
 * once even if the transaction body were ever made retryable.
 *
 * When `resolver` is provided, validates the parent is a container kind.
 */
export function planInsertBlock(
  state: State,
  parentId: BlockId,
  beforeSiblingId: BlockId | null,
  args: InsertBlockArgs,
  allocator: IdAllocator,
  resolver?: BlockKindResolver,
): InsertBlockPlan {
  const parent = getBlock(state, parentId);
  if (!parent) {
    throw new Error(`insertBlock: parent "${parentId}" not found`);
  }

  // Pre-condition (outside the transaction): when a resolver is supplied,
  // refuse to insert a child block under a non-container parent.
  if (resolver !== undefined) {
    const parentKind = resolver.getBlockKind(parent.type);
    if (parentKind !== "container") {
      throw new Error(
        `insertBlock: parent "${parentId}" (type "${parent.type}") is not a container (kind "${parentKind}"); cannot insert a child block under a non-container`,
      );
    }
  }

  // Determine prev / next siblings from the pre-mutation snapshot.
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

  return {
    parentId,
    newId,
    prevSiblingId,
    nextSiblingId,
    type: args.type,
    attrs: args.attrs ?? {},
    inlineContent: args.inlineContent ?? null,
  };
}

/**
 * Pure Y.Doc-mutation primitive: applies a pre-computed `InsertBlockPlan`
 * to `doc`. Caller is responsible for all validation and for opening the
 * surrounding `applyOperation` / `runTransaction` (this function MUST run
 * inside an already-open transaction; it does NOT open one itself).
 *
 * Used by:
 *   - `insertBlock` (thin wrapper that validates + plans + wraps in
 *     `applyOperation`).
 *   - Future composers (e.g., inserting a footnote anchor that materializes
 *     an embed-content body atomically with the anchor's containing block)
 *     that need to chain multiple `*InTx` calls inside ONE Y.Doc transaction.
 *
 * Mirrors the original public op's boundary-write discipline: the parent's
 * `firstChildId` / `lastChildId` are written ONLY when actually changing
 * (boundary insert), so middle inserts don't add the parent to `dirtyIds`.
 *
 * TREE SCOPE: writes to the main `blocks` map only. See the docstring on the
 * public `insertBlock` for rationale and the plan's lack of a `kind` field.
 */
export function insertBlockInTx(doc: Y.Doc, plan: InsertBlockPlan): void {
  requireInTransaction(doc, "insertBlock");

  // Dev-mode defense against allocator id collision (test allocators with
  // counter-based ids can collide with seeded state; production
  // crypto.randomUUID effectively cannot). Without this, Y.Map.set below
  // would silently overwrite the existing block of the same id.
  assertNoIdCollision(doc, plan.newId, "insertBlock");

  // Add the new block to the blocks map with full linkage.
  getBlocksMap(doc).set(
    plan.newId,
    buildYBlock({
      type: plan.type,
      attrs: plan.attrs,
      parentId: plan.parentId,
      prevSiblingId: plan.prevSiblingId,
      nextSiblingId: plan.nextSiblingId,
      firstChildId: null,
      lastChildId: null,
      inlineContent: plan.inlineContent,
    }),
  );

  // Update prev sibling's nextSiblingId (if any) to point at the new block.
  if (plan.prevSiblingId !== null) {
    const yPrev = getYBlock(doc, plan.prevSiblingId, "insertBlock");
    yPrev.set("nextSiblingId", plan.newId);
  }

  // Update next sibling's prevSiblingId (if any) to point at the new block.
  if (plan.nextSiblingId !== null) {
    const yNext = getYBlock(doc, plan.nextSiblingId, "insertBlock");
    yNext.set("prevSiblingId", plan.newId);
  }

  // Update parent's firstChildId / lastChildId only when the new block sits at
  // a boundary. Writing same-value to a Y.Map still fires a change event, which
  // would cause the parent to land in dirtyIds and trigger an unnecessary
  // re-paint.
  if (plan.prevSiblingId === null || plan.nextSiblingId === null) {
    const yParent = getYBlock(doc, plan.parentId, "insertBlock");
    if (plan.prevSiblingId === null) {
      yParent.set("firstChildId", plan.newId);
    }
    if (plan.nextSiblingId === null) {
      yParent.set("lastChildId", plan.newId);
    }
  }
}
