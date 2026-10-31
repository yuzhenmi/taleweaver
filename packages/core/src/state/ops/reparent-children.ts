import type * as Y from "yjs";
import type { Document, OperationResult } from "../document";
import { applyOperation, getBlock } from "../document";
import type { BlockId } from "../block-id";
import { requireInTransaction } from "../yjs-doc";
import { ancestorChain } from "../block-traversal";
import { moveEntities, type TreeNode } from "../flow-ops";
import { readCtx, deriveBlock } from "../flow-read";

/**
 * A resolved MOVE of a contiguous sibling run under `newParentId`, right after
 * `prevSiblingId` (null = first). `nodes` are the moved subtrees as read
 * pre-move (their content is re-minted at the target; their ids and registry
 * entries are kept).
 */
export interface ReparentPlan {
  readonly blockIds: readonly BlockId[];
  readonly newParentId: BlockId;
  readonly prevSiblingId: BlockId | null;
  readonly nodes: readonly TreeNode[];
}

/**
 * Move a contiguous run of sibling blocks under `newParentId`, before
 * `beforeSiblingId` (null = append). A MOVE (one transaction): the source marks +
 * characters are deleted and new marks with the SAME ids + re-minted content are
 * inserted at the target; registry entries are kept, so undo is exact. A peer's
 * concurrent edit inside a moved block stays visible at the source (misplaced,
 * never lost).
 */
export function reparentChildren(
  document: Document,
  blockIds: readonly BlockId[],
  newParentId: BlockId,
  beforeSiblingId: BlockId | null = null,
): OperationResult {
  const plan = planReparentChildren(document, blockIds, newParentId, beforeSiblingId);
  if (plan.blockIds.length === 0) return { document, dirtyIds: new Set<BlockId>() };
  return applyOperation(document, (doc) => {
    reparentChildrenInTx(doc, plan);
  });
}

export function planReparentChildren(
  document: Document,
  blockIds: readonly BlockId[],
  newParentId: BlockId,
  beforeSiblingId: BlockId | null = null,
): ReparentPlan {
  // Empty list → no-op plan (no validation of newParent needed; the public
  // op short-circuits to the identity no-op).
  if (blockIds.length === 0) {
    return { blockIds: [], newParentId, prevSiblingId: null, nodes: [] };
  }

  // Every moved block must exist.
  for (const id of blockIds) {
    if (getBlock(document, id) === null) {
      throw new Error(`reparentChildren: block "${id}" not found`);
    }
  }

  // New parent must exist and be a container (no inlineContent).
  const newParent = getBlock(document, newParentId);
  if (newParent === null) {
    throw new Error(`reparentChildren: newParent "${newParentId}" not found`);
  }
  if (newParent.inlineContent !== null) {
    throw new Error(
      `reparentChildren: newParent "${newParentId}" is a leaf block, not a container`,
    );
  }

  // The moved ids must be a contiguous sibling run under one source parent.
  const first = blockIds[0];
  if (first === undefined) {
    // Unreachable given the length check, but narrows for the type system.
    return { blockIds: [], newParentId, prevSiblingId: null, nodes: [] };
  }
  const firstBlock = getBlock(document, first);
  if (firstBlock === null) {
    throw new Error(`reparentChildren: block "${first}" not found`);
  }
  const sourceParentId = firstBlock.parentId;
  if (sourceParentId === null) {
    throw new Error(
      `reparentChildren: block "${first}" has no parent (cannot reparent the document root)`,
    );
  }
  // Walk the requested ids, verifying each is the nextSibling of the prior.
  for (let i = 0; i + 1 < blockIds.length; i++) {
    const cur = blockIds[i];
    const nxt = blockIds[i + 1];
    if (cur === undefined || nxt === undefined) {
      throw new Error("reparentChildren: blockIds must be a contiguous sibling run");
    }
    const curBlock = getBlock(document, cur);
    if (curBlock === null) {
      throw new Error(`reparentChildren: block "${cur}" not found`);
    }
    if (curBlock.nextSiblingId !== nxt) {
      throw new Error(
        "reparentChildren: blockIds must be a contiguous sibling run " +
          `(block "${nxt}" is not the next sibling of "${cur}")`,
      );
    }
  }

  // Cycle check: no moved block may be an ancestor of the new parent.
  const newParentChain = ancestorChain(document, newParentId);
  const movedSet = new Set(blockIds);
  for (const ancestorId of newParentChain) {
    if (movedSet.has(ancestorId)) {
      throw new Error(
        "reparentChildren: cannot reparent a block under its own descendant",
      );
    }
  }

  // beforeSiblingId, if non-null, must be a current child of newParent and must
  // not be one of the moved blocks (which would produce a cyclic/undefined
  // sibling chain on a same-parent move). Checked after the structural
  // (existence / contiguity / cycle) validations so their more-specific errors
  // surface first.
  if (beforeSiblingId !== null) {
    if (blockIds.includes(beforeSiblingId)) {
      throw new Error(
        "reparentChildren: beforeSiblingId cannot be one of the moved blocks",
      );
    }
    const beforeSibling = getBlock(document, beforeSiblingId);
    if (beforeSibling === null) {
      throw new Error(
        `reparentChildren: beforeSiblingId "${beforeSiblingId}" not found`,
      );
    }
    if (beforeSibling.parentId !== newParentId) {
      throw new Error(
        `reparentChildren: beforeSiblingId "${beforeSiblingId}" is not a child of newParent "${newParentId}"`,
      );
    }
  }

  // Gather the remaining pointer inputs from the pre-mutation snapshot.
  const lastId = blockIds[blockIds.length - 1];
  if (lastId === undefined) {
    return { blockIds: [], newParentId, prevSiblingId: null, nodes: [] };
  }
  const lastBlock = getBlock(document, lastId);
  if (lastBlock === null) {
    throw new Error(`reparentChildren: block "${lastId}" not found`);
  }
  const sourceParent = getBlock(document, sourceParentId);
  if (sourceParent === null) {
    throw new Error(`reparentChildren: source parent "${sourceParentId}" not found`);
  }
  // The target's previous sibling, skipping the moved run itself.
  let prevSiblingId =
    beforeSiblingId === null ? newParent.lastChildId : (getBlock(document, beforeSiblingId)?.prevSiblingId ?? null);
  while (prevSiblingId !== null && movedSet.has(prevSiblingId)) prevSiblingId = getBlock(document, prevSiblingId)?.prevSiblingId ?? null;
  // The run already sits at the target: identity no-op (no MOVE, no re-minting).
  if (newParentId === sourceParentId && prevSiblingId === firstBlock.prevSiblingId) {
    return { blockIds: [], newParentId, prevSiblingId: null, nodes: [] };
  }
  return { blockIds, newParentId, prevSiblingId, nodes: blockIds.map((id) => subtreeNode(document, id)) };
}

/** Apply a {@link ReparentPlan} inside an open transaction. */
export function reparentChildrenInTx(doc: Y.Doc, plan: ReparentPlan): void {
  requireInTransaction(doc, "reparentChildren");
  if (plan.blockIds.length === 0) return;
  const tree = deriveBlock(readCtx(doc), plan.newParentId)?.tree ?? "block";
  moveEntities(doc, plan.nodes, plan.prevSiblingId, plan.newParentId, tree);
}

function subtreeNode(document: Document, id: BlockId): TreeNode {
  const b = getBlock(document, id);
  if (b === null) throw new Error(`reparentChildren: block "${id}" not found`);
  const children: TreeNode[] = [];
  for (let c = b.firstChildId; c !== null; c = getBlock(document, c)?.nextSiblingId ?? null) children.push(subtreeNode(document, c));
  return { id: b.id, type: b.type, attrs: b.attrs, inlineContent: b.inlineContent, children };
}
