import * as Y from "yjs";
import type { State, OperationResult } from "../state";
import { applyOperation, resolveBlock } from "../state";
import type { BlockId } from "../block-id";
import { getTreeMap, getYBlock, requireInTransaction, type BlockTreeKind } from "../yjs-doc";
import { cloneInlineItem, mergeAdjacentSameAttrsTextItems } from "../y-utils";
import { assertSameTree } from "../assert-same-tree";
// Type-only import — runtime cycle is broken by `import type` (erased at runtime).
import type { AttrRegistry } from "../../cascade/attr-registry";

/**
 * Pre-computed mutation plan for `mergeAdjacentBlocksInTx`. Captures the
 * fully-resolved write inputs:
 *   - `leftId` / `rightId` — the two blocks being merged. Left wins.
 *   - `kind` — the tree they live in; resolved at plan time from `resolveBlock`
 *     so `inTx` doesn't have to re-resolve. Both blocks share the same tree
 *     (block-tree invariant, dev-asserted via `assertSameTree`).
 *   - `parentId` — the shared parent (guaranteed non-null by the planner;
 *     adjacent siblings can't both be the root).
 *   - `rightNextId` — right's old next sibling. Threaded to `inTx` so the
 *     plan describes the post-mutation linkage (left.nextSiblingId becomes
 *     rightNextId; if non-null, rightNext.prevSiblingId becomes leftId;
 *     if null, parent.lastChildId becomes leftId).
 *
 * The plan is plain data — no Y types, no `State` references, no
 * function-bearing objects. `AttrRegistry` (used by the seam-merge
 * normalizer for custom per-key `equals` semantics) is NOT carried on the
 * plan; it is passed as a separate argument to `mergeAdjacentBlocksInTx`
 * (mirroring how `insertText` threads registry alongside, not inside, its
 * plan).
 */
export interface MergeBlocksPlan {
  readonly leftId: BlockId;
  readonly rightId: BlockId;
  readonly kind: BlockTreeKind;
  readonly parentId: BlockId;
  readonly rightNextId: BlockId | null;
}

/**
 * Merge two adjacent leaf siblings into one block.
 *
 * Left wins: keeps id, type, attrs, parentId, prevSiblingId. Its
 * nextSiblingId is rewired to right.nextSiblingId. Its inlineContent
 * becomes [...left.items, ...right.items] with a run-merging post-pass
 * across the seam.
 *
 * Right is removed from state.blocks. If right had a nextSibling, that
 * sibling's prevSiblingId is rewired to leftId. If right was the parent's
 * lastChildId, the parent's lastChildId is rewired to leftId.
 *
 * Returns OperationResult with dirtyIds containing:
 *   - left's id (content + nextSiblingId changed)
 *   - right's id (removed from state.blocks)
 *   - right's old nextSibling, if non-null (its prevSiblingId was rewired)
 *   - parent's id, if right was the last child (parent's lastChildId rewired)
 *
 * Throws if:
 *   - either block does not exist,
 *   - leftId === rightId,
 *   - either block is a container (firstChildId !== null OR inlineContent === null),
 *   - blocks have different parents,
 *   - blocks are not adjacent siblings (left.nextSiblingId !== rightId
 *     OR right.prevSiblingId !== leftId).
 *
 * Y.Doc identity: right's items are deep-cloned onto left's inlineContent
 * Y.Array (Yjs forbids re-parenting a Y type). Left's existing items retain
 * their Y.Text identity EXCEPT when the seam converges (last-of-left and
 * first-of-right have value-equal attrs): the same-attrs merge pass replaces
 * both seam items with a single fresh Y.Text holding the concatenated
 * content. Items away from the seam are never touched.
 *
 * `registry` (optional): an `AttrRegistry`; threaded to the seam-merge
 * normalizer (`mergeAdjacentSameAttrsTextItems`) so interpreters with a
 * custom per-key `equals` (e.g. a `comment` interpreter that ignores
 * `timestamp`) opt into custom adjacent-item compare semantics across
 * the block seam. Omitted → deep-value compare.
 *
 * Composition: see `mergeAdjacentBlocksInTx` for the in-transaction primitive
 * used to chain a merge with other `*InTx` ops inside a single Y.Doc
 * transaction (one undo entry / one collab event).
 */
export function mergeAdjacentBlocks(
  state: State,
  leftId: BlockId,
  rightId: BlockId,
  registry?: AttrRegistry,
): OperationResult {
  const plan = planMergeAdjacentBlocks(state, leftId, rightId);
  return applyOperation(state, (doc) => {
    mergeAdjacentBlocksInTx(doc, plan, registry);
  });
}

/**
 * Validate the requested merge against the pre-mutation `state` snapshot and
 * produce a `MergeBlocksPlan`. Throws on every condition
 * `mergeAdjacentBlocks`'s docstring lists.
 *
 * All validation reads happen here, BEFORE the surrounding `applyOperation`
 * is opened. The plan captures everything `mergeAdjacentBlocksInTx` needs to
 * run the mutations without further reads from `state`.
 */
export function planMergeAdjacentBlocks(
  state: State,
  leftId: BlockId,
  rightId: BlockId,
): MergeBlocksPlan {
  if (leftId === rightId) {
    throw new Error(`mergeAdjacentBlocks: left and right are the same block "${leftId}"`);
  }

  // Resolve the reference (left) block ONCE to learn its owning tree (`kind`);
  // every kind-routed write in `inTx` targets that tree. `right` and the other
  // neighbors are asserted to live in the same tree below.
  const leftResolved = resolveBlock(state, leftId);
  if (leftResolved === null) {
    throw new Error(`mergeAdjacentBlocks: left block "${leftId}" not found`);
  }
  const { block: left, kind } = leftResolved;
  const right = resolveBlock(state, rightId)?.block ?? null;
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

  // The neighbor ids this op reads + rewires: right (deleted), right's old
  // next sibling (its prevSiblingId flips to left), and the parent (its
  // lastChildId may flip). All must live in the SAME tree as the reference
  // (left) block — a cross-tree pointer would mean the kind-routed writes
  // in `inTx` corrupt state. (Dev-only; production no-op.)
  assertSameTree(
    state,
    kind,
    [rightId, right.nextSiblingId, parentId],
    "mergeAdjacentBlocks",
  );

  return {
    leftId,
    rightId,
    kind,
    parentId,
    rightNextId: right.nextSiblingId,
  };
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
 * Reads from the LIVE Y.Doc (the two blocks' inlineContent Y.Arrays) are
 * unavoidable here — Yjs forbids re-parenting a Y type so right's items
 * must be cloned onto left's array, which requires touching the live
 * arrays. Those reads target the items being mutated, not the snapshot,
 * so they remain composition-safe.
 */
export function mergeAdjacentBlocksInTx(
  doc: Y.Doc,
  plan: MergeBlocksPlan,
  registry?: AttrRegistry,
): void {
  requireInTransaction(doc, "mergeAdjacentBlocks");

  // Route every map access to the reference (left) block's owning tree
  // (`plan.kind`): merging two header/footer-body paragraphs
  // (templateContents) must delete `right` from templateContents, not the
  // main `blocks` map.
  const yTree = getTreeMap(doc, plan.kind);
  const yLeft = getYBlock(doc, plan.leftId, "mergeAdjacentBlocks", plan.kind);
  const yRight = getYBlock(doc, plan.rightId, "mergeAdjacentBlocks", plan.kind);
  const yLeftItems = yLeft.get("inlineContent") as Y.Array<Y.Map<unknown>>;
  const yRightItems = yRight.get("inlineContent") as Y.Array<Y.Map<unknown>>;

  // Append clones of right's items to left. Yjs forbids re-parenting a Y
  // type, so we clone — left keeps its existing items' Y.Text identity;
  // only right's items get freshly materialized on the left side.
  const cloned: Y.Map<unknown>[] = [];
  for (let i = 0; i < yRightItems.length; i++) {
    cloned.push(cloneInlineItem(yRightItems.get(i)));
  }
  if (cloned.length > 0) {
    yLeftItems.push(cloned);
    // Same-attrs merge pass to uphold the normalized inline-content invariant.
    // Only needed when we actually appended items.
    mergeAdjacentSameAttrsTextItems(yLeftItems, registry);
  }

  // Rewire siblings around right (right.next becomes left.next).
  yLeft.set("nextSiblingId", plan.rightNextId);
  if (plan.rightNextId !== null) {
    getYBlock(doc, plan.rightNextId, "mergeAdjacentBlocks", plan.kind).set(
      "prevSiblingId",
      plan.leftId,
    );
  } else {
    // Right was the last child — rewire parent.lastChildId to left.
    // Preconditions guarantee parent.lastChildId is rightId (same-parent
    // + adjacent-sibling + right.nextSibling===null). Unconditional
    // rewire matches the documented contract; an upstream invariant
    // violation would surface as a getYBlock throw.
    const yParent = getYBlock(doc, plan.parentId, "mergeAdjacentBlocks", plan.kind);
    yParent.set("lastChildId", plan.leftId);
  }

  // Delete right last (after reads of yRight are done) from the owning tree.
  yTree.delete(plan.rightId);
}
