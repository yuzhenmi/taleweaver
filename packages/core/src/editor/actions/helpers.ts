import { createPosition, createSpan, iterateLeafBlocksInDocumentOrder } from "../../state";
import type { State, BlockId, Selection } from "../../state";
import type { EditorState, EditorConfig } from "../editor-state";
import { cascadePass, cascadePassIncremental } from "../../cascade";
import type { ElementBox, RenderNode } from "../../render/render-node";
import type { RenderOutput } from "../../render/render";

/**
 * Phase 0b: core is geometry-free. `rebuildTrees` no longer runs the
 * render → cascade → layout pipeline (that lives in the print backend's
 * layout-driver now). It only RECORDS what changed — the set of dirty block
 * ids — onto `EditorState.lastDirtyIds`, the per-dispatch incremental hint the
 * backend consumes to rebuild layout incrementally (reusing unchanged subtrees
 * by reference). `dirtyIds === undefined` records `null` (a full rebuild).
 *
 * `_oldEditor` / `_config` are retained in the signature (every mutating
 * handler calls `rebuildTrees(newEditor, oldEditor, config, dirtyIds)`) but are
 * no longer read — core carries no prior geometry to thread.
 */
export function rebuildTrees(
  newEditor: EditorState,
  _oldEditor: EditorState,
  _config: EditorConfig,
  dirtyIds?: ReadonlySet<BlockId>,
): EditorState {
  return { ...newEditor, lastDirtyIds: dirtyIds ?? null };
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
  // Cycle-safe leaf walk (a block with `inlineContent !== null` is always a
  // leaf, so filtering to leaves first finds the identical first hit). Replaces
  // an unbounded `firstLeafBlock` + `while (cursor = nextBlockInDocOrder(...))`
  // sweep that could spin forever on a malformed two-parents topology — the
  // same #510 footgun fixed in the render-pass doc-order queries.
  for (const block of iterateLeafBlocksInDocumentOrder(state)) {
    if (block.inlineContent !== null) return block.id;
  }
  return null;
}

/**
 * Derive the initial collapsed `Selection` for a freshly-built or freshly-loaded
 * document: a caret at offset 0 of the first content-bearing leaf block
 * (`findFirstContentBlock`). Falls back to the root block id when the document
 * has no content leaf (a degenerate container-only doc) so the caller always
 * gets a well-formed Selection. Shared by `createInitialEditorState` (the empty
 * document) and `loadDocument` (an arbitrary deserialized document) so both
 * derive the caret the same robust way (the empty-document factory seeds a
 * paragraph, so this matches the prior `firstChildId` result there, but it also
 * handles a loaded doc whose first child is a container, e.g. a section).
 */
export function initialSelectionForState(state: State): Selection {
  const firstContent = findFirstContentBlock(state) ?? state.rootId;
  const caret = createPosition(firstContent, 0);
  return createSpan(caret, caret);
}

/**
 * Find the last content-bearing leaf block in the document. Symmetric to
 * `findFirstContentBlock`: the cycle-safe leaf walk yields content leaves in
 * document order, so the LAST one it yields is the answer. (A full forward walk
 * rather than a backward early-exit, but this runs only on Select-All /
 * boundary-expand / document-load, never per-keystroke, and trades a negligible
 * walk for immunity to the #510 malformed-topology hang.)
 */
export function findLastContentBlock(state: State): BlockId | null {
  let last: BlockId | null = null;
  for (const block of iterateLeafBlocksInDocumentOrder(state)) {
    if (block.inlineContent !== null) last = block.id;
  }
  return last;
}
