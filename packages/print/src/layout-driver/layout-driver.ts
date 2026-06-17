import {
  render,
  cascadePass,
  cascadePassIncremental,
  cascadeTemplateContents,
  cascadeEmbedContents,
  makeBlockParentLookup,
  documentFootnotePolicy,
  footnoteNumbers,
  footnoteRenumberedBlocks,
  type State,
  type BlockId,
  type RenderOutput,
  type RenderNode,
  type ElementBox,
  type FootnoteNumber,
} from "@taleweaver/core";
import { layoutTreeIncremental } from "../layout/layout-incremental";
import type { LayoutBox } from "../layout/layout-node";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import type { LayoutConfig } from "./layout-config";

/**
 * The print backend's layout-driver (Phase 0b). Core's editor reducer is
 * geometry-free: every mutation handler records WHAT changed (`lastDirtyIds`),
 * and this driver owns the render → cascade → layout rebuild after each
 * dispatch. It retains the full prior-cycle pipeline trees as closure state so
 * each rebuild reuses unchanged render / cascade / layout subtrees by reference
 * (the incremental path keys reuse off `lastDirtyIds`).
 *
 * This is a relocation of what `rebuildTrees` / `createEditorStateFromState`
 * used to do inside core — the SAME render→cascade→layout pipeline, now living
 * behind the print-mode seam so `@taleweaver/core` carries no geometry.
 */
export interface LayoutDriver {
  /**
   * Rebuild the layout tree for `state` at `containerWidth`.
   *
   * `lastDirtyIds`:
   *  - a (possibly empty) set → incremental rebuild from the retained prior
   *    trees, reusing unchanged subtrees by reference (gated on the set);
   *  - `null` → a FULL rebuild (the initial build, or a container-width resize)
   *    against the prior cascaded tree when one exists (so a tall-header doc
   *    re-paginates with the grown insets), else a fresh full build.
   */
  rebuild(
    state: State,
    containerWidth: number,
    lastDirtyIds: ReadonlySet<BlockId> | null,
  ): LayoutBox | VirtualLayoutTree;
}

/**
 * The product of one render → cascade → layout cycle: every tree the driver
 * retains across `rebuild` calls. The FN-6.4 second pass reuses this shape as
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
 * Hard cap on the FN-6.4 per-page re-render convergence loop. A marker
 * glyph-width change ("9"→"10") could in principle shift a line / repaginate,
 * moving an anchor to a different page → another renumber. In practice ONE extra
 * pass suffices (the diff is then empty); the loop is correctness insurance.
 */
const MAX_PER_PAGE_CONVERGENCE_PASSES = 4;

export function createLayoutDriver(layoutConfig: LayoutConfig): LayoutDriver {
  const { measurer, hyphenator, pageConfig, componentRegistry, attrRegistry } = layoutConfig;

  // Retained prior-cycle trees (the closure state feeding incremental reuse).
  // Null until the first rebuild populates them.
  let prev: PipelineResult | null = null;
  let prevState: State | null = null;

  /**
   * Run one render → cascade → layout cycle. Incremental when `cycle.dirtyIds`
   * is supplied (each stage reuses unchanged subtrees by reference, gated on the
   * set); full rebuild otherwise. Extracted so the FN-6.4 second pass can re-run
   * the SAME pipeline with a numbering override.
   */
  function renderCascadeLayout(
    state: State,
    containerWidth: number,
    cycle: PipelinePrev | null,
  ): PipelineResult {
    const incremental = cycle !== null && cycle.dirtyIds !== undefined;

    const rendered =
      incremental && cycle !== null
        ? render(state, componentRegistry, attrRegistry, {
            prev: cycle.prevRenderOutput,
            prevState: cycle.prevState,
            dirtyIds: cycle.dirtyIds,
            footnoteNumbersOverride: cycle.footnoteNumbersOverride,
          })
        : render(state, componentRegistry, attrRegistry);

    const cascadedRoot =
      incremental && cycle !== null
        ? cascadePassIncremental(rendered.root, cycle.prevRenderOutput.root, cycle.prevCascaded)
        : cascadePass(rendered.root);

    // Cascade EVERY header/footer template body. Incremental → reuse an unchanged
    // body's prior cascaded tree by reference; full → cascade each body fresh.
    const cascadedTemplate = cascadeTemplateContents(
      rendered,
      incremental && cycle !== null ? cycle.prevRenderOutput : null,
      incremental && cycle !== null ? cycle.prevCascadedTemplate : null,
      incremental && cycle !== null ? cycle.dirtyIds : undefined,
    );

    // Cascade EVERY footnote body (the parallel of the header/footer cascade).
    const cascadedEmbed = cascadeEmbedContents(
      rendered,
      incremental && cycle !== null ? cycle.prevRenderOutput : null,
      incremental && cycle !== null ? cycle.prevCascadedEmbed : null,
      incremental && cycle !== null ? cycle.dirtyIds : undefined,
    );

    // Ordered footnote anchors over the (new) main document — read from the
    // RenderOutput the render pass already computed (and cached), never re-walked.
    const footnoteAnchors = rendered.footnoteAnchors;

    // Layout parent-lookup so a `cross-ref-page` field to a NESTED target resolves
    // via its top-level ancestor's page on every rebuild cycle.
    const parentOf = makeBlockParentLookup(state);

    const layout = layoutTreeIncremental(
      cascadedRoot,
      incremental && cycle !== null ? cycle.prevCascaded : null,
      incremental && cycle !== null ? cycle.prevLayout : null,
      containerWidth,
      measurer,
      pageConfig,
      cascadedTemplate,
      cascadedEmbed,
      footnoteAnchors,
      parentOf,
      hyphenator,
    );

    return {
      rendered,
      cascadedRoot,
      cascadedTemplateContents: cascadedTemplate,
      cascadedEmbedContents: cascadedEmbed,
      layout,
    };
  }

  /**
   * FN-6.4 restart-per-page numbering second pass. When the document policy is
   * restart-per-page AND the doc has footnotes AND the layout is the virtualized
   * tree (the only path that surfaces `footnoteAnchorPages`), recompute the
   * per-page-correct numbers from the layout's anchor→page map and re-render the
   * changed markers. Every OTHER case is a no-op returning `first` unchanged.
   */
  function applyRestartPerPageNumbering(
    state: State,
    containerWidth: number,
    first: PipelineResult,
  ): PipelineResult {
    const policy = documentFootnotePolicy(state);
    if (policy.reset !== "restart-per-page") return first;

    const anchors = first.rendered.footnoteAnchors;
    if (anchors.length === 0) return first;

    let current = first;
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

      const changedHosts = footnoteRenumberedBlocks(
        anchors,
        correctNumbers,
        current.rendered.footnoteNumbers,
      );
      if (changedHosts.size === 0) {
        return current; // numbers already correct everywhere — converged
      }

      const markerDirty = new Set<BlockId>();
      for (const anchor of anchors) {
        if (changedHosts.has(anchor.blockId)) {
          markerDirty.add(anchor.blockId);
          markerDirty.add(anchor.contentBlockId);
        }
      }

      const next = renderCascadeLayout(state, containerWidth, {
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

      const nextAssignment = anchorPagesOf(current.layout);
      if (nextAssignment === null) {
        return current;
      }
      if (pageAssignmentsEqual(pageAssignment, nextAssignment)) {
        return current; // page assignment stable → done
      }
      pageAssignment = nextAssignment;
    }

    // Cap hit. No monotonicity guarantee (marker glyph width couples to
    // pagination → a legitimate period-2 limit cycle). Degrade gracefully and
    // silently: keep the last computed pass.
    return current;
  }

  function rebuild(
    state: State,
    containerWidth: number,
    lastDirtyIds: ReadonlySet<BlockId> | null,
  ): LayoutBox | VirtualLayoutTree {
    // The incremental cycle inputs: present only when we have BOTH prior trees
    // AND a dirty set. `lastDirtyIds === null` ≡ a full rebuild (initial build /
    // resize) — but still reuse the prior CASCADED tree as the layout `prev` when
    // one exists, matching the legacy SET_CONTAINER_WIDTH full-build-from-cascade.
    const cycle: PipelinePrev | null =
      prev !== null && prevState !== null && lastDirtyIds !== null
        ? {
            prevRenderOutput: prev.rendered,
            prevState,
            prevCascaded: prev.cascadedRoot,
            prevCascadedTemplate: prev.cascadedTemplateContents,
            prevCascadedEmbed: prev.cascadedEmbedContents,
            prevLayout: prev.layout,
            dirtyIds: lastDirtyIds,
          }
        : null;

    const first = renderCascadeLayout(state, containerWidth, cycle);
    const converged = applyRestartPerPageNumbering(state, containerWidth, first);

    prev = converged;
    prevState = state;
    return converged.layout;
  }

  return { rebuild };
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
