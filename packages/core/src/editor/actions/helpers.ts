import { createPosition, createSpan, iterateLeafBlocksInDocumentOrder } from "../../state";
import type { State, BlockId, Selection } from "../../state";
import type { EditorState, EditorConfig } from "../editor-state";
import { render, type RenderOutput } from "../../render/render";
import { cascadePass, cascadePassIncremental } from "../../cascade";
import { layoutTreeIncremental } from "../../layout/layout-incremental";
import { makeBlockParentLookup } from "../block-parent-lookup";
import type { ElementBox, RenderNode } from "../../render/render-node";
import type { LayoutBox } from "../../layout/layout-box";
import type { VirtualLayoutTree } from "../../layout/virtual-layout-tree";
import {
  documentFootnotePolicy,
  footnoteNumbers,
  footnoteRenumberedBlocks,
  type FootnoteNumber,
} from "../../footnotes";

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
  // ── First pass: render → cascade → layout against `oldEditor` as prev. ──
  const first = renderCascadeLayout(
    newEditor.state,
    newEditor.containerWidth,
    config,
    {
      prevRenderOutput: oldEditor.renderOutput,
      prevState: oldEditor.state,
      prevCascaded: oldEditor.cascadedRoot,
      prevCascadedTemplate: oldEditor.cascadedTemplateContents,
      prevCascadedEmbed: oldEditor.cascadedEmbedContents,
      prevLayout: oldEditor.layoutTree,
      dirtyIds,
    },
  );

  // ── FN-6.4 restart-per-page second pass. ──
  // restart-per-page numbers depend on which PAGE each anchor lands on, known
  // only after the layout pass. The first pass rendered the documented
  // continuous fallback (`effectiveRenderPolicy`); now re-derive the correct
  // per-page numbers from the layout's `footnoteAnchorPages` and re-render only
  // the changed markers. Engaged ONLY when the policy is restart-per-page AND
  // the doc has footnotes — every other case skips entirely (zero added cost).
  const converged = applyRestartPerPageNumbering(
    newEditor.state,
    newEditor.containerWidth,
    config,
    first,
  );

  return {
    ...newEditor,
    renderTree: converged.rendered.root,
    renderOutput: converged.rendered,
    cascadedRoot: converged.cascadedRoot,
    cascadedTemplateContents: converged.cascadedTemplateContents,
    cascadedEmbedContents: converged.cascadedEmbedContents,
    layoutTree: converged.layout,
  };
}

/**
 * The product of one render → cascade → layout cycle: every tree `rebuildTrees`
 * threads onto the `EditorState`. The FN-6.4 second pass reuses this shape as
 * BOTH its prev-inputs and its output so the feedback loop is a plain re-run.
 */
interface PipelineResult {
  readonly rendered: RenderOutput;
  readonly cascadedRoot: RenderNode;
  readonly cascadedTemplateContents: ReadonlyMap<BlockId, ElementBox>;
  readonly cascadedEmbedContents: ReadonlyMap<BlockId, ElementBox>;
  readonly layout: LayoutBox | VirtualLayoutTree;
}

/** Prior-cycle inputs that opt one `renderCascadeLayout` call into incremental. */
interface PipelinePrev {
  readonly prevRenderOutput: RenderOutput;
  readonly prevState: State;
  readonly prevCascaded: RenderNode;
  readonly prevCascadedTemplate: ReadonlyMap<BlockId, ElementBox>;
  readonly prevCascadedEmbed: ReadonlyMap<BlockId, ElementBox>;
  readonly prevLayout: LayoutBox | VirtualLayoutTree;
  readonly dirtyIds?: ReadonlySet<BlockId>;
  /**
   * FN-6.4: a layout-derived numbering map that OVERRIDES the policy-derived
   * computation for THIS render (the per-page numbers). Threaded into
   * `render`'s `footnoteNumbersOverride`. Absent on the first pass.
   */
  readonly footnoteNumbersOverride?: ReadonlyMap<BlockId, FootnoteNumber>;
}

/**
 * Run one render → cascade → layout cycle. Incremental when `prev.dirtyIds` is
 * supplied (each stage reuses unchanged subtrees by reference, gated on
 * `dirtyIds`); full rebuild otherwise. Extracted from `rebuildTrees` so the
 * FN-6.4 second pass can re-run the SAME pipeline with a numbering override.
 */
function renderCascadeLayout(
  state: State,
  containerWidth: number,
  config: EditorConfig,
  prev: PipelinePrev,
): PipelineResult {
  const { dirtyIds } = prev;
  const incremental = dirtyIds !== undefined;

  const rendered = incremental
    ? render(state, config.componentRegistry, config.attrRegistry, {
        prev: prev.prevRenderOutput,
        prevState: prev.prevState,
        dirtyIds,
        footnoteNumbersOverride: prev.footnoteNumbersOverride,
      })
    : render(state, config.componentRegistry, config.attrRegistry);

  const cascadedRoot = incremental
    ? cascadePassIncremental(rendered.root, prev.prevRenderOutput.root, prev.prevCascaded)
    : cascadePass(rendered.root);

  // C.2c: cascade EVERY header/footer template body, mirroring the main-root
  // cascade above. Incremental → reuse an unchanged body's prior cascaded tree
  // by reference (gated on `dirtyIds`); full → cascade each body fresh. The
  // resulting map is threaded into the layout pass so `materializePage` can
  // lay the bodies into each page's header/footer slot (T4 consumes it).
  const cascadedTemplateContents = cascadeTemplateContents(
    rendered,
    incremental ? prev.prevRenderOutput : null,
    incremental ? prev.prevCascadedTemplate : null,
    dirtyIds,
  );

  // FN-1: cascade EVERY footnote body, the exact parallel to the header/footer
  // cascade above. Incremental → reuse an unchanged body's prior cascaded tree
  // by reference; full → cascade each fresh.
  const cascadedEmbedContents = cascadeEmbedContents(
    rendered,
    incremental ? prev.prevRenderOutput : null,
    incremental ? prev.prevCascadedEmbed : null,
    dirtyIds,
  );

  // FN-4.0: ordered footnote anchors over the (new) main document, threaded
  // into the layout pass alongside `cascadedEmbedContents` for the footnote
  // layout pass (FN-4.2 `resolveFootnotes`) to consume.
  // FN-8: read the anchors the render pass ALREADY computed (and cached on the
  // RenderOutput) — don't re-walk. `render` returns `footnoteAnchors` for both
  // the full path (collected once) and the incremental path (reused from the
  // prior cycle when no edit could have changed them; recomputed only when an
  // anchor was added / removed / moved or a section changed). This is the same
  // ordered list a fresh `collectFootnoteAnchors(state)` would yield, minus the
  // per-keystroke O(N_blocks) walk for both the footnote-free and the
  // footnote-bearing-but-unchanged cases.
  const footnoteAnchors = rendered.footnoteAnchors;

  // Task 2.5: build the layout parent-lookup so a `cross-ref-page` field to a NESTED
  // target (e.g. a table-cell paragraph the page plan doesn't index directly) resolves
  // via its top-level ancestor's page on every incremental render cycle (`rebuildTrees`).
  const parentOf = makeBlockParentLookup(state);

  const layout = layoutTreeIncremental(
    cascadedRoot,
    incremental ? prev.prevCascaded : null,
    incremental ? prev.prevLayout : null,
    containerWidth,
    config.measurer,
    config.pageConfig,
    cascadedTemplateContents,
    cascadedEmbedContents,
    footnoteAnchors,
    parentOf,
    // Auto-hyphenation (slice 2): thread the injected hyphenator through the
    // incremental rebuild so per-keystroke layout shares the host's inputs.
    config.hyphenator,
  );

  return { rendered, cascadedRoot, cascadedTemplateContents, cascadedEmbedContents, layout };
}

/**
 * Hard cap on the FN-6.4 per-page re-render convergence loop (mirrors
 * `resolveFootnotes`'s `MAX_CONVERGENCE_ITERATIONS`). A marker glyph-width
 * change ("9"→"10") could in principle shift a line / repaginate, moving an
 * anchor to a different page → another renumber. In practice ONE extra pass
 * suffices (the diff is then empty); the loop is correctness insurance. A
 * dev-mode throw catches a genuine non-converging oscillation.
 */
const MAX_PER_PAGE_CONVERGENCE_PASSES = 4;

/**
 * FN-6.4: the restart-per-page numbering second pass. When the document policy
 * is `restart-per-page` AND the doc has footnotes AND the layout is the
 * virtualized tree (the only path that surfaces `footnoteAnchorPages`), recompute
 * the per-page-correct numbers from the layout's anchor→page map and re-render
 * the changed markers (call markers in the main tree ∪ body markers in
 * embedContents) with a `footnoteNumbersOverride`. Loops until the page
 * assignment is stable (a re-render could repaginate), capped to guarantee
 * termination.
 *
 * Every OTHER case is a no-op returning `first` unchanged — the dominant path
 * pays nothing:
 *  - policy not restart-per-page (continuous / restart-per-section are
 *    state-derivable and already correct after the first pass);
 *  - no footnotes;
 *  - a non-virtual `LayoutBox` layout (float/`clear` fallback): no
 *    `footnoteAnchorPages` to read, so the documented continuous fallback stands
 *    (restart-per-page is only supported in the virtualized path for now,
 *    mirroring how floats/`clear` fall back — design §"Out of scope for v1").
 */
function applyRestartPerPageNumbering(
  state: State,
  containerWidth: number,
  config: EditorConfig,
  first: PipelineResult,
): PipelineResult {
  const policy = documentFootnotePolicy(state);
  if (policy.reset !== "restart-per-page") return first;

  const anchors = first.rendered.footnoteAnchors;
  if (anchors.length === 0) return first;

  let current = first;
  // `pageAssignment` used to compute the CURRENT numbers; recomputed each pass.
  let pageAssignment = anchorPagesOf(current.layout);
  if (pageAssignment === null) {
    // Non-virtual layout: no page map available → keep the continuous fallback.
    return first;
  }

  for (let pass = 0; pass < MAX_PER_PAGE_CONVERGENCE_PASSES; pass++) {
    const correctNumbers = footnoteNumbers(
      anchors,
      { reset: "restart-per-page", format: policy.format },
      pageAssignment,
    );

    // Diff the per-page-correct numbers against what the markers CURRENTLY show
    // (the first pass's continuous fallback, or a prior convergence pass).
    const changedHosts = footnoteRenumberedBlocks(
      anchors,
      correctNumbers,
      current.rendered.footnoteNumbers,
    );
    if (changedHosts.size === 0) {
      // Numbers already correct everywhere — converged.
      return current;
    }

    // Re-render the changed markers: each anchor's HOST block (call marker, main
    // tree) ∪ its `contentBlockId` body root (body leading marker, embedContents).
    const markerDirty = new Set<BlockId>();
    for (const anchor of anchors) {
      if (changedHosts.has(anchor.blockId)) {
        markerDirty.add(anchor.blockId);
        markerDirty.add(anchor.contentBlockId);
      }
    }

    const next = renderCascadeLayout(state, containerWidth, config, {
      prevRenderOutput: current.rendered,
      prevState: state,
      prevCascaded: current.cascadedRoot,
      prevCascadedTemplate: current.cascadedTemplateContents,
      prevCascadedEmbed: current.cascadedEmbedContents,
      prevLayout: current.layout,
      dirtyIds: markerDirty,
      footnoteNumbersOverride: correctNumbers,
    });
    current = next;

    // Convergence: the re-render could have repaginated (a wider marker glyph),
    // moving an anchor to a different page → its per-page number changes again.
    const nextAssignment = anchorPagesOf(current.layout);
    if (nextAssignment === null) {
      // Should not happen (we entered via the virtual path), but guard rather
      // than assume — keep the result computed so far.
      return current;
    }
    if (pageAssignmentsEqual(pageAssignment, nextAssignment)) {
      // Page assignment stable: the next diff would be empty → done.
      return current;
    }
    pageAssignment = nextAssignment;
  }

  // Cap hit. Unlike the `resolveFootnotes` slot-height cap (which guards a
  // provable monotone invariant, so a multi-cycle is genuinely unreachable),
  // this loop has NO monotonicity guarantee: marker glyph width couples to
  // pagination (e.g. "9"→"10" shifts a line → moves an anchor across a page
  // boundary → the per-page count flips → the width flips back), a legitimate
  // PERIOD-2 limit cycle on real content. That is a normal document state, not
  // a bug, so we must NOT throw (a throw would crash the dev server / the user's
  // browser-during-development). Degrade gracefully and silently: keep the last
  // computed pass — its numbers are at most one pass stale, the cap bounds the
  // work, and editing continues unbroken.
  return current;
}

/**
 * The anchor→page map from a layout, or `null` for a non-virtual `LayoutBox`
 * (which carries no `footnoteAnchorPages`). FN-6.4's second pass needs the
 * virtualized tree's map; the legacy positioned path falls back to continuous.
 */
function anchorPagesOf(
  layout: LayoutBox | VirtualLayoutTree,
): ReadonlyMap<BlockId, number> | null {
  return layout.type === "virtual-root" ? layout.footnoteAnchorPages : null;
}

/** True when two anchor→page maps assign every footnote the same page. */
function pageAssignmentsEqual(
  a: ReadonlyMap<BlockId, number>,
  b: ReadonlyMap<BlockId, number>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, page] of a) {
    if (b.get(id) !== page) return false;
  }
  return true;
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
