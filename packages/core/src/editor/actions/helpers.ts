import type { State } from "../../state/state";
import { getBlock } from "../../state/state";
import type { BlockId } from "../../state/block-id";
import type { EditorState, EditorConfig } from "../editor-state";
import { render } from "../../render/render";
import { layoutTree } from "../../layout/dispatch";
import {
  firstLeafBlock,
  lastLeafBlock,
  nextBlockInDocOrder,
  prevBlockInDocOrder,
} from "../../state/block-traversal";

/**
 * Re-run the render + layout pipeline for the editor's current state.
 * Used by every state-mutating handler after producing newState +
 * newSelection. Returns a new EditorState with refreshed renderTree
 * + layoutTree (other fields untouched on the input newEditor).
 *
 * The `oldEditor` parameter is currently unused — kept for signature
 * stability since the legacy incremental pipeline used it, and so that
 * a future optimization layer can re-introduce reference-equality
 * memoization without touching every handler.
 */
export function rebuildTrees(
  newEditor: EditorState,
  _oldEditor: EditorState,
  config: EditorConfig,
): EditorState {
  const rendered = render(
    newEditor.state,
    config.componentRegistry,
    config.attrRegistry,
  );
  const layout = layoutTree(
    rendered.root,
    newEditor.containerWidth,
    config.measurer,
    config.pageConfig,
  );
  return {
    ...newEditor,
    renderTree: rendered.root,
    layoutTree: layout,
  };
}

/**
 * Find the first content-bearing leaf block in the document (the first
 * block in document order whose `inlineContent !== null`). Returns null
 * if no such block exists (e.g., a fully-empty document with only
 * containers — shouldn't happen with the standard empty-document
 * factory, which always seeds one paragraph).
 */
export function findFirstContentBlock(state: State): BlockId | null {
  const firstLeaf = firstLeafBlock(state, state.rootId);
  if (firstLeaf === null) return null;
  let cursor: BlockId | null = firstLeaf;
  while (cursor !== null) {
    const block = getBlock(state, cursor);
    if (block === null) return null;
    if (block.inlineContent !== null) return cursor;
    cursor = nextBlockInDocOrder(state, cursor);
  }
  return null;
}

/**
 * Find the last content-bearing leaf block in the document. Symmetric to
 * `findFirstContentBlock` — walks backward via `prevBlockInDocOrder`.
 */
export function findLastContentBlock(state: State): BlockId | null {
  const lastLeaf = lastLeafBlock(state, state.rootId);
  if (lastLeaf === null) return null;
  let cursor: BlockId | null = lastLeaf;
  while (cursor !== null) {
    const block = getBlock(state, cursor);
    if (block === null) return null;
    if (block.inlineContent !== null) return cursor;
    cursor = prevBlockInDocOrder(state, cursor);
  }
  return null;
}
