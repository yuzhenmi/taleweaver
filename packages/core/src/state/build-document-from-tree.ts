import type { Block } from "./block";
import type { BlockId, IdAllocator } from "./block-id";
import type { InlineContent } from "./inline-content";
import type { ReadonlyAttrs } from "./attrs";
import type { ListDef } from "./list-defs";
import { buildStateWithListDefs } from "./build-state-from-blocks";
import type { State } from "./state";

/** A declarative container node: children, NO inlineContent. */
export interface ContainerBlockNode {
  /** A registered container block type (e.g. "document", "section"). */
  readonly type: string;
  readonly attrs?: ReadonlyAttrs;
  readonly children: ReadonlyArray<BlockNode>;
}

/** A declarative leaf node: inlineContent, NO children. */
export interface LeafBlockNode {
  /** A registered leaf type ("paragraph", "heading", "list-item", …). */
  readonly type: string;
  /** Open attrs (listId/listLevel/level/src/… as relevant). */
  readonly attrs?: ReadonlyAttrs;
  readonly inlineContent: InlineContent;
}

/**
 * A declarative document node — a NESTED tree (children), NO manual
 * sibling/parent pointers, NO ids. The clean public construction input: link
 * fields + ids are DERIVED by `buildDocumentFromTree`.
 *
 * A `BlockNode` is a discriminated union — a node is EITHER a container
 * (children) OR a leaf (inlineContent), NEVER both, matching the `Block` data
 * model. This makes the container-XOR-leaf invariant a COMPILE-TIME guarantee
 * (no runtime "both set" throw, no type hole).
 */
export type BlockNode = ContainerBlockNode | LeafBlockNode;

/** Discriminate by field presence (the two union members are non-overlapping). */
function isLeaf(node: BlockNode): node is LeafBlockNode {
  return "inlineContent" in node;
}

/**
 * Lower a declarative `BlockNode` tree to a `State`: a depth-first walk minting a
 * fresh `BlockId` per node (via `allocator`), deriving
 * parentId / prevSiblingId / nextSiblingId / firstChildId / lastChildId from
 * tree position, then `buildStateWithListDefs`. The root node's minted id
 * becomes the State's rootId.
 *
 * `listDefs` keys are listIds referenced by `list-item` leaf nodes'
 * `attrs.listId` (the CALLER mints those, e.g. one per source list — block ids
 * are this builder's job, list ids the caller's).
 *
 * Builds the MAIN tree only (embed/template trees are a future extension). The
 * container-XOR-leaf invariant is the union TYPE's job; this builder trusts the
 * node shape (it has no component registry, so it does NOT validate
 * type-vs-shape — e.g. that a `paragraph` is a leaf — which is the caller's
 * responsibility).
 *
 * This is the SAFE public counterpart to the state-module-internal
 * `buildStateFromBlocks`, whose manual sibling/parent pointers are a footgun;
 * `BlockNode` is the safe declarative shape that owns the error-prone link
 * derivation in ONE tested place. It is the format-agnostic construction
 * primitive that importers (e.g. the HTML serializer) target.
 */
export function buildDocumentFromTree(
  root: ContainerBlockNode,
  listDefs: Record<string, ListDef>,
  allocator: IdAllocator,
): State {
  const blocks: Block[] = [];

  // Each recursive call receives a PRE-MINTED id (and pre-minted sibling ids),
  // so siblings can be linked without a second allocator call per node. (API
  // consumers never mint ids — `buildDocumentFromTree` allocates them all.)
  // Builds the Block with all derived links, pushes it, then recurses children.
  const build = (
    node: BlockNode,
    id: BlockId,
    parentId: BlockId | null,
    prevSiblingId: BlockId | null,
    nextSiblingId: BlockId | null,
  ): void => {
    if (isLeaf(node)) {
      blocks.push({
        id,
        type: node.type,
        attrs: node.attrs ?? {},
        parentId,
        prevSiblingId,
        nextSiblingId,
        firstChildId: null,
        lastChildId: null,
        inlineContent: node.inlineContent,
      });
      return;
    }
    // Container: pre-mint child ids so each child knows its prev/next, then recurse.
    const childIds = node.children.map(() => allocator.allocate());
    node.children.forEach((child, i) => {
      const childId = childIds[i];
      if (childId === undefined) {
        // Unreachable: childIds is built 1:1 from node.children via map, so the
        // same-index lookup is always in bounds.
        throw new Error(`buildDocumentFromTree: childIds index ${i} out of range`);
      }
      // childIds[i - 1] / childIds[i + 1] are intentionally undefined at the
      // ends (first child has no prev, last has no next) → `?? null`.
      build(child, childId, id, childIds[i - 1] ?? null, childIds[i + 1] ?? null);
    });
    blocks.push({
      id,
      type: node.type,
      attrs: node.attrs ?? {},
      parentId,
      prevSiblingId,
      nextSiblingId,
      firstChildId: childIds[0] ?? null,
      lastChildId: childIds[childIds.length - 1] ?? null,
      inlineContent: null,
    });
  };

  const rootId = allocator.allocate();
  build(root, rootId, null, null, null);
  return buildStateWithListDefs({ rootId, blocks, listDefs });
}
