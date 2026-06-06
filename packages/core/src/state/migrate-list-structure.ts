import type { State, BlockId } from "./index";
import {
  getBlock,
  reparentChildren,
  mergeBlockAttrs,
  removeBlock,
  productionAllocator,
} from "./index";
import { iterateBlocksInDocumentOrder } from "./document-order";
import { applyOperation } from "./state";
import { writeListDefInTx, type ListDef } from "./list-defs";

/**
 * Default ordered-list numbering: alternating decimal / lower-alpha per nesting
 * level (matching the flat-model list defaults), restart after a section break.
 */
const ORDERED_DEF: ListDef = {
  levels: Array.from({ length: 9 }, (_v, i) => ({
    style: i % 2 === 0 ? "decimal" : "lower-alpha",
    start: 1,
    restart: "after-break",
  })),
};

/** Default unordered-list bullets: disc / circle / square cycling per level. */
const UNORDERED_DEF: ListDef = {
  levels: Array.from({ length: 9 }, (_v, i) => ({
    style: i % 3 === 0 ? "disc" : i % 3 === 1 ? "circle" : "square",
    start: 1,
    restart: "after-break",
  })),
};

/**
 * Load-time migration from the OLD structural list model (a `list` CONTAINER
 * block holding `list-item` children) to the FLAT model (each `list-item`
 * carries `listId` + `listLevel` attrs, no wrapping container).
 *
 * Defensive: live editing code no longer constructs `list` containers, so this
 * only fires for a persisted structural document loaded from disk / a collab
 * peer. A document with no `list` containers is returned UNCHANGED (identity).
 *
 * For each `list` container, its direct `list-item` children are reparented out
 * to the container's own parent (inserted at the container's position), tagged
 * with a per-top-level `listId` and a `listLevel` equal to the container's
 * list-nesting depth, then the now-empty container is removed. A `ListDef` is
 * written once per top-level list so numbering/bullets render.
 *
 * Containers are processed DEEPEST-FIRST so a nested sublist's items are
 * reparented out from under their enclosing `list` before that enclosing
 * container collapses. Each container's `listLevel` is the nesting depth read
 * from the ORIGINAL `state` (step 1), so it stays correct as the tree mutates.
 */
export function migrateListStructure(state: State): State {
  const containers: Array<{ id: BlockId; depth: number }> = [];
  for (const block of iterateBlocksInDocumentOrder(state)) {
    if (block.type === "list") {
      containers.push({ id: block.id, depth: listAncestorDepth(state, block.id) });
    }
  }
  if (containers.length === 0) return state; // identity no-op

  // Deepest-first: a sublist's items must move out before its enclosing
  // container collapses. depth was captured up-front against the original
  // state, so it remains the correct listLevel regardless of mutation order.
  containers.sort((a, b) => b.depth - a.depth);

  const listIdByTop = new Map<BlockId, BlockId>(); // top container id → shared listId
  let s = state;
  for (const { id, depth } of containers) {
    const container = getBlock(s, id);
    if (container === null || container.parentId === null) continue;
    const listId = resolveOrAllocateListId(s, id, listIdByTop);
    const listType = readListType(container.attrs.listType);

    s = applyOperation(s, (doc) => {
      writeListDefInTx(doc, listId, listType === "unordered" ? UNORDERED_DEF : ORDERED_DEF);
      return new Set<BlockId>(); // block-tree dirtying happens via the ops below
    }).state;

    // CURRENT list-item children (in the mutated `s`): for a nested group the
    // inner sublist's items have ALREADY been reparented into this container by
    // a deeper pass, so they appear here too. We must reparent ALL of them out
    // (else `removeBlock` below — which deletes the whole subtree — would drop
    // the inner items), but we must NOT re-tag the inner items' `listLevel`:
    // they already carry their correct deeper level. Tag only the items native
    // to THIS container (those without a `listLevel` yet); they all share the
    // group's single `listId`, so re-setting listId on them is a harmless no-op.
    const childIds = directListItemChildIds(s, id);
    if (childIds.length > 0) {
      // Move the container's list-items out to under the container's parent,
      // positioned right before the container itself.
      s = reparentChildren(s, childIds, container.parentId, id).state;
      for (const childId of childIds) {
        const child = getBlock(s, childId);
        // Skip items already tagged by a deeper (inner-list) pass — preserve
        // their higher listLevel; only level-tag items native to this container.
        if (child !== null && typeof child.attrs.listLevel === "number") continue;
        s = mergeBlockAttrs(s, childId, { listId, listLevel: depth }).state;
      }
    }
    s = removeBlock(s, id).state;
  }
  return s;
}

/**
 * Number of `list` ancestors above `id` — its nesting level among lists, which
 * becomes the migrated `list-item`'s `listLevel` (0 at the top level).
 */
function listAncestorDepth(state: State, id: BlockId): number {
  let depth = 0;
  let cur = getBlock(state, id);
  while (cur !== null && cur.parentId !== null) {
    const parent = getBlock(state, cur.parentId);
    if (parent === null) break;
    if (parent.type === "list") depth++;
    cur = parent;
  }
  return depth;
}

/**
 * All `list` containers in a nested-list group share ONE listId. Walk up
 * through enclosing `list` containers to the top-level one and memoize the
 * allocated id against it.
 */
function resolveOrAllocateListId(
  state: State,
  containerId: BlockId,
  memo: Map<BlockId, BlockId>,
): BlockId {
  let top = containerId;
  let cur = getBlock(state, containerId);
  while (cur !== null && cur.parentId !== null) {
    const parent = getBlock(state, cur.parentId);
    if (parent === null || parent.type !== "list") break;
    top = parent.id;
    cur = parent;
  }
  const existing = memo.get(top);
  if (existing !== undefined) return existing;
  const id = productionAllocator.allocate();
  memo.set(top, id);
  return id;
}

/** Direct `list-item` children of a container, in document order. */
function directListItemChildIds(state: State, containerId: BlockId): BlockId[] {
  const out: BlockId[] = [];
  const container = getBlock(state, containerId);
  let childId = container === null ? null : container.firstChildId;
  while (childId !== null) {
    const child = getBlock(state, childId);
    if (child === null) break;
    if (child.type === "list-item") out.push(child.id);
    childId = child.nextSiblingId;
  }
  return out;
}

/** Read the open-schema `listType` attr type-safely; default "ordered". */
function readListType(raw: unknown): "ordered" | "unordered" {
  return raw === "unordered" ? "unordered" : "ordered";
}
