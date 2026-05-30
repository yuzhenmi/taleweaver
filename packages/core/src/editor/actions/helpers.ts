import { getBlock, firstLeafBlock, lastLeafBlock, nextBlockInDocOrder, prevBlockInDocOrder } from "../../state";
import type { State, BlockId } from "../../state";
import type { EditorState, EditorConfig } from "../editor-state";
import { render, type RenderOutput } from "../../render/render";
import { cascadePass, cascadePassIncremental } from "../../cascade";
import { collectFootnoteAnchors } from "../../footnotes";
import { layoutTreeIncremental } from "../../layout/layout-incremental";
import type { ElementBox, RenderNode } from "../../render/render-node";

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

  // C.2c: cascade EVERY header/footer template body, mirroring the main-root
  // cascade above. Incremental → reuse an unchanged body's prior cascaded tree
  // by reference (gated on `dirtyIds`); full → cascade each body fresh. The
  // resulting map is threaded into the layout pass so `materializePage` can
  // lay the bodies into each page's header/footer slot (T4 consumes it).
  const cascadedTemplateContents = cascadeTemplateContents(
    rendered,
    dirtyIds !== undefined ? prevRenderOutput : null,
    dirtyIds !== undefined ? oldEditor.cascadedTemplateContents : null,
    dirtyIds,
  );

  // FN-1: cascade EVERY footnote body, the exact parallel to the header/footer
  // cascade above. Incremental → reuse an unchanged body's prior cascaded tree
  // by reference; full → cascade each fresh.
  const cascadedEmbedContents = cascadeEmbedContents(
    rendered,
    dirtyIds !== undefined ? prevRenderOutput : null,
    dirtyIds !== undefined ? oldEditor.cascadedEmbedContents : null,
    dirtyIds,
  );

  // FN-4.0: ordered footnote anchors over the (new) main document, threaded
  // into the layout pass alongside `cascadedEmbedContents` for the footnote
  // layout pass (FN-4.2 `resolveFootnotes`) to consume. Both are UNUSED for
  // layout output in this plumbing task, so they cannot change pagination.
  const footnoteAnchors = collectFootnoteAnchors(newEditor.state);

  const layout = layoutTreeIncremental(
    cascadedRoot,
    dirtyIds !== undefined ? prevCascaded : null,
    dirtyIds !== undefined ? prevLayout : null,
    newEditor.containerWidth,
    config.measurer,
    config.pageConfig,
    cascadedTemplateContents,
    cascadedEmbedContents,
    footnoteAnchors,
  );

  return {
    ...newEditor,
    renderTree: rendered.root,
    renderOutput: rendered,
    cascadedRoot,
    cascadedTemplateContents,
    cascadedEmbedContents,
    layoutTree: layout,
  };
}

/**
 * Cascade every header/footer template body in `rendered.templateContents`,
 * returning a `Map<BlockId, ElementBox>` keyed by each body's root BlockId.
 * Each value is the body root after cascade (populated `computedStyle`), ready
 * for slot layout.
 *
 * **Cascade ALL bodies** (not just plan-referenced ones) — simplest, and
 * removes any dependency on the section-plan header/footer threading.
 *
 * **Incremental reuse (R-D-style), keyed off render-node identity.** The
 * incremental renderer (`renderIncremental`) already returns the SAME body
 * RenderNode by reference when nothing in that body's subtree changed, and a
 * FRESH node when any descendant changed (its invalidation set covers
 * ancestors + descendants of `dirtyIds`). So the robust "did this body change?"
 * signal is render-node reference equality against the prior render output —
 * NOT a membership check on the body's ROOT id (a dirty leaf deep in the body
 * leaves the root id absent from `dirtyIds`). When the body's RenderNode is
 * ref-equal to prev's AND we have its prior cascaded tree, reuse that cascaded
 * tree by reference (paint-cache + layout warmth, and the ref-stability the
 * next layout pass keys off). Otherwise re-cascade — incrementally
 * (`cascadePassIncremental`, which still reuses unchanged INNER subtrees by
 * ref) when a prior body + prior cascaded body exist, else a full `cascadePass`.
 *
 * The body root is always a block-level container/leaf, so `cascadePass` /
 * `cascadePassIncremental` return an `ElementBox`; we narrow on `type` rather
 * than blind-cast so a non-element body (impossible today) surfaces loudly.
 */
function cascadeTemplateContents(
  rendered: RenderOutput,
  prevRenderOutput: RenderOutput | null,
  prevCascaded: ReadonlyMap<BlockId, ElementBox> | null,
  dirtyIds?: ReadonlySet<BlockId>,
): ReadonlyMap<BlockId, ElementBox> {
  return cascadeBodies(
    "cascadeTemplateContents",
    rendered.templateContents,
    prevRenderOutput?.templateContents ?? null,
    prevCascaded,
    dirtyIds,
  );
}

/**
 * Cascade every footnote body in `rendered.embedContents`, the exact parallel
 * of `cascadeTemplateContents` (which cascades header/footer bodies). Same
 * full + incremental semantics; see `cascadeBodies` for the shared logic. FN-1
 * stores the result on `EditorState.cascadedEmbedContents`; the footnote layout
 * pass (`resolveFootnotes`, FN-4) consumes it.
 */
function cascadeEmbedContents(
  rendered: RenderOutput,
  prevRenderOutput: RenderOutput | null,
  prevCascaded: ReadonlyMap<BlockId, ElementBox> | null,
  dirtyIds?: ReadonlySet<BlockId>,
): ReadonlyMap<BlockId, ElementBox> {
  return cascadeBodies(
    "cascadeEmbedContents",
    rendered.embedContents,
    prevRenderOutput?.embedContents ?? null,
    prevCascaded,
    dirtyIds,
  );
}

/**
 * Shared body-cascade engine behind `cascadeTemplateContents` (headers/footers)
 * and `cascadeEmbedContents` (footnotes). Both side-tree body maps
 * (`templateContents`, `embedContents`) are keyed by a body root BlockId and
 * carry the same full/incremental reuse contract; the only difference is which
 * `RenderOutput` map they read. `bodies` is the current render output's body
 * map; `prevBodies` is the prior render output's matching map (or null for the
 * full path); `prevCascaded` is the prior cascaded result. `opName` names the
 * caller for the non-element guard error.
 */
function cascadeBodies(
  opName: string,
  bodies: ReadonlyMap<BlockId, RenderNode>,
  prevBodies: ReadonlyMap<BlockId, RenderNode> | null,
  prevCascaded: ReadonlyMap<BlockId, ElementBox> | null,
  dirtyIds?: ReadonlySet<BlockId>,
): ReadonlyMap<BlockId, ElementBox> {
  const out = new Map<BlockId, ElementBox>();
  for (const [id, body] of bodies) {
    const prevBody = prevBodies?.get(id) ?? null;
    const prevCascadedBody = prevCascaded?.get(id) ?? null;

    // Incremental reuse: the renderer hands back the SAME body RenderNode when
    // the body's whole subtree is unchanged → reuse its cascaded tree by ref.
    if (
      dirtyIds !== undefined &&
      prevBody !== null &&
      prevCascadedBody !== null &&
      body === prevBody
    ) {
      out.set(id, prevCascadedBody);
      continue;
    }

    // Re-cascade: incremental when a prior body + prior cascaded body exist
    // (reuses unchanged inner subtrees by ref), else a full cascade.
    const cascaded =
      dirtyIds !== undefined && prevBody !== null && prevCascadedBody !== null
        ? cascadePassIncremental(body, prevBody, prevCascadedBody)
        : cascadePass(body);
    if (cascaded.type !== "element") {
      throw new Error(`${opName}: body "${id}" cascaded to a non-element node`);
    }
    out.set(id, cascaded);
  }
  return out;
}

export { cascadeTemplateContents, cascadeEmbedContents };

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
