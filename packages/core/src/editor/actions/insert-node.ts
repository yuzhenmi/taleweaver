import type { EditorState, EditorConfig } from "../editor-state";
import { productionAllocator, getBlock, insertBlock } from "../../state";
import type { BlockInit, Position, State, BlockId, IdAllocator, InlineContent, BlockKindResolver } from "../../state";
import { rebuildTrees } from "./helpers";

interface InsertNodeFold {
  readonly state: State;
  readonly dirtyIds: Set<BlockId>;
}

/**
 * Insert a `BlockInit` (and its descendants) under `parentId` as the last
 * child. Dispatches on `resolver.getBlockKind(init.type)`:
 *
 *   - inline-bearing-leaf (paragraph, heading, list-item): use
 *     `init.inlineContent` directly. `init.children` MUST be undefined or
 *     empty; otherwise throws (shape mismatch).
 *   - atomic-leaf (image, horizontal-line): no inlineContent, no children.
 *     Throws if either is populated.
 *   - container (document, list, table, table-row, table-cell, etc.):
 *     no inlineContent. Recurses into `init.children` to build the subtree.
 *     Throws if `init.inlineContent` is populated.
 */
function insertBlockInitAt(
  state: State,
  init: BlockInit,
  parentId: BlockId,
  allocator: IdAllocator,
  resolver: BlockKindResolver,
  accumulatedDirtyIds: Set<BlockId>,
): InsertNodeFold {
  const kind = resolver.getBlockKind(init.type);
  if (kind === null) {
    throw new Error(`INSERT_NODE: type "${init.type}" is not registered`);
  }

  const inlineProvided =
    init.inlineContent !== undefined
    && init.inlineContent !== null
    && init.inlineContent.items.length > 0;
  const childrenProvided =
    init.children !== undefined && init.children.length > 0;

  let inlineContent: InlineContent | null;
  if (kind === "inline-bearing-leaf") {
    if (childrenProvided) {
      throw new Error(
        `INSERT_NODE: inline-bearing-leaf block "${init.type}" must not have children`,
      );
    }
    inlineContent = init.inlineContent ?? { items: [] };
  } else if (kind === "atomic-leaf") {
    if (inlineProvided) {
      throw new Error(
        `INSERT_NODE: atomic-leaf block "${init.type}" must not have inlineContent`,
      );
    }
    if (childrenProvided) {
      throw new Error(
        `INSERT_NODE: atomic-leaf block "${init.type}" must not have children`,
      );
    }
    inlineContent = null;
  } else {
    // container
    if (inlineProvided) {
      throw new Error(
        `INSERT_NODE: container block "${init.type}" must not have inlineContent`,
      );
    }
    inlineContent = null;
  }

  const insertResult = insertBlock(
    state,
    parentId,
    null,
    {
      type: init.type,
      attrs: init.attrs,
      inlineContent,
    },
    allocator,
    resolver,
  );
  for (const id of insertResult.dirtyIds) accumulatedDirtyIds.add(id);
  let cur = insertResult.state;
  // After insert, the new block is the parent's lastChildId.
  const parent = getBlock(cur, parentId);
  if (parent === null) return { state: cur, dirtyIds: accumulatedDirtyIds };
  const newId = parent.lastChildId;
  if (newId === null) return { state: cur, dirtyIds: accumulatedDirtyIds };

  if (kind === "container" && init.children !== undefined) {
    for (const child of init.children) {
      const sub = insertBlockInitAt(
        cur,
        child,
        newId,
        allocator,
        resolver,
        accumulatedDirtyIds,
      );
      cur = sub.state;
    }
  }
  return { state: cur, dirtyIds: accumulatedDirtyIds };
}

export function handleInsertNode(
  editor: EditorState,
  init: BlockInit,
  _position: Position | undefined,
  config: EditorConfig,
): EditorState {
  // insertBlockInitAt always calls insertBlock at least once for the
  // root init (line 82), and insertBlock always mutates the Y.Doc
  // (sets a new blocks-map entry + rewires siblings + updates the
  // parent's first/last-child pointers). So fold.state is guaranteed
  // !== editor.state — no no-op short-circuit is reachable.
  const fold = insertBlockInitAt(
    editor.state,
    init,
    editor.state.rootId,
    productionAllocator,
    config.componentRegistry,
    new Set<BlockId>(),
  );

  editor.history.commit(
    { state: fold.state, dirtyIds: fold.dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: fold.state },
    editor,
    config,
    fold.dirtyIds,
  );
}
