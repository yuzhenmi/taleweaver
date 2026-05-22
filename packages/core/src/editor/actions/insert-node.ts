import type { EditorState, EditorConfig } from "../editor-state";
import type { NewNode } from "../../state/node";
import type { Position } from "../../state/block-position";
import type { State } from "../../state/state";
import type { BlockId, IdAllocator } from "../../state/block-id";
import { productionAllocator } from "../../state/block-id";
import { getBlock } from "../../state/state";
import { insertBlock } from "../../state/insert-block";
import type { InlineItem, TextItem } from "../../state/inline-content";
import { mergeAdjacentTextItems } from "../../state/inline-content";
import type { ReadonlyAttrs } from "../../state/attrs";
import {
  INLINE_BEARING_LEAF_TYPES,
  ATOMIC_LEAF_TYPES,
} from "../../state/block-kinds";
import { rebuildTrees } from "./helpers";

interface InsertNodeFold {
  readonly state: State;
  readonly dirtyIds: Set<BlockId>;
}

/**
 * Walk a NewNode tree (legacy shape: text/span are children, not inline
 * content) and produce a flat list of InlineItems. Span nodes propagate
 * their `properties` as attrs to inner text items.
 */
function collectInlineItemsFromNewNode(
  newNode: NewNode,
  inheritedAttrs: ReadonlyAttrs,
): InlineItem[] {
  const out: InlineItem[] = [];
  for (const child of newNode.children) {
    if (child.type === "text") {
      const content = child.properties.content;
      if (typeof content !== "string" || content.length === 0) continue;
      const item: TextItem = {
        kind: "text",
        text: content,
        attrs: Object.freeze({ ...inheritedAttrs }),
      };
      out.push(Object.freeze(item));
    } else if (child.type === "span") {
      const spanAttrs = { ...inheritedAttrs, ...child.properties };
      out.push(...collectInlineItemsFromNewNode(child, spanAttrs));
    }
    // Other child types under an inline-bearing leaf are ignored — they
    // shouldn't appear in a well-formed legacy paragraph/heading tree.
  }
  return mergeAdjacentTextItems(out);
}

/**
 * Insert `newNode` (and recursively its descendants) under `parentId` as
 * the last child. Translates legacy NewNode shape to the new block model:
 *
 *   - For inline-bearing leaf types (paragraph, heading, list-item):
 *     collect text/span descendants into `inlineContent.items`. Do NOT
 *     recurse into children as blocks.
 *   - For atomic leaf types (image, horizontal-line): ignore children.
 *   - For container types (document, list, table, table-row, table-cell,
 *     etc.): recurse into children as blocks.
 *
 * Closed-schema `style` from NewNode is dropped — styling routes through
 * AttrRegistry-recognized attrs in the new model.
 */
function insertNewNodeAt(
  state: State,
  newNode: NewNode,
  parentId: BlockId,
  allocator: IdAllocator,
  accumulatedDirtyIds: Set<BlockId>,
): InsertNodeFold {
  const isLeaf = INLINE_BEARING_LEAF_TYPES.has(newNode.type)
    || ATOMIC_LEAF_TYPES.has(newNode.type);
  const inlineContent = isLeaf
    ? {
        items: INLINE_BEARING_LEAF_TYPES.has(newNode.type)
          ? collectInlineItemsFromNewNode(newNode, {})
          : [],
      }
    : null;

  const insertResult = insertBlock(state, parentId, null, {
    type: newNode.type,
    attrs: newNode.properties,
    inlineContent,
  }, allocator);
  for (const id of insertResult.dirtyIds) accumulatedDirtyIds.add(id);
  let cur = insertResult.state;
  // After insert, the new block is the parent's lastChildId.
  const parent = getBlock(cur, parentId);
  if (parent === null) return { state: cur, dirtyIds: accumulatedDirtyIds };
  const newId = parent.lastChildId;
  if (newId === null) return { state: cur, dirtyIds: accumulatedDirtyIds };

  // Only recurse for container types. For leaves, children were already
  // consumed into inlineContent (or ignored for atomic leaves).
  if (!isLeaf) {
    for (const child of newNode.children) {
      const sub = insertNewNodeAt(cur, child, newId, allocator, accumulatedDirtyIds);
      cur = sub.state;
    }
  }
  return { state: cur, dirtyIds: accumulatedDirtyIds };
}

export function handleInsertNode(
  editor: EditorState,
  newNode: NewNode,
  _position: Position | undefined,
  config: EditorConfig,
): EditorState {
  const fold = insertNewNodeAt(
    editor.state,
    newNode,
    editor.state.rootId,
    productionAllocator,
    new Set<BlockId>(),
  );
  if (fold.dirtyIds.size === 0) return editor;

  editor.history.commit(
    { state: fold.state, dirtyIds: fold.dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: fold.state },
    editor,
    config,
  );
}
