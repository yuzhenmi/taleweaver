import type { State } from "../../state/state";
import { getBlock } from "../../state/state";
import type { BlockId } from "../../state/block-id";
import type { EditorState, EditorConfig } from "../editor-state";
import { render } from "../../render/render";
import { cascadePass, cascadePassIncremental } from "../../cascade";
import { layoutTreeIncremental } from "../../layout/layout-incremental";
import {
  firstLeafBlock,
  lastLeafBlock,
  nextBlockInDocOrder,
  prevBlockInDocOrder,
} from "../../state/block-traversal";

/**
 * Re-run the render + cascade + layout pipeline for the editor's
 * current state. Used by every state-mutating handler after producing
 * newState + newSelection.
 *
 * **Incremental path (R-D).** When `dirtyIds` is provided AND
 * `oldEditor` carries a prior `renderOutput` / `cascadedRoot`, each
 * pipeline stage runs incrementally:
 *  1. `render` reuses unchanged RenderNode subtrees by reference
 *     (only invalidated blocks rebuild — see `renderIncremental`).
 *  2. `cascadePassIncremental` preserves the ref-equality chain by
 *     reusing cascaded subtrees whose RenderNode + parent computed
 *     style are reference-equal.
 *  3. `layoutTreeIncremental` consumes the pre-cascaded tree (skipping
 *     its internal auto-cascade) and reuses unchanged layout subtrees.
 *
 * **Full-rebuild fallback.** When `dirtyIds` is absent, each stage
 * does a full rebuild (current behavior pre-R-D). Handlers can adopt
 * the incremental path incrementally — passing `dirtyIds` only when
 * they have it.
 */
export function rebuildTrees(
  newEditor: EditorState,
  oldEditor: EditorState,
  config: EditorConfig,
  dirtyIds?: ReadonlySet<BlockId>,
): EditorState {
  const prevRenderOutput = oldEditor.renderOutput;
  const prevState = oldEditor.state;
  const prevCascaded = oldEditor.cascadedRoot;
  const prevLayout = oldEditor.layoutTree;

  const rendered = dirtyIds !== undefined
    ? render(newEditor.state, config.componentRegistry, config.attrRegistry, {
        prev: prevRenderOutput,
        prevState,
        dirtyIds,
      })
    : render(newEditor.state, config.componentRegistry, config.attrRegistry);

  const cascadedRoot = dirtyIds !== undefined
    ? cascadePassIncremental(rendered.root, prevRenderOutput.root, prevCascaded)
    : cascadePass(rendered.root);

  const layout = layoutTreeIncremental(
    cascadedRoot,
    dirtyIds !== undefined ? prevCascaded : null,
    dirtyIds !== undefined ? prevLayout : null,
    newEditor.containerWidth,
    config.measurer,
    config.pageConfig,
  );

  return {
    ...newEditor,
    renderTree: rendered.root,
    renderOutput: rendered,
    cascadedRoot,
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
