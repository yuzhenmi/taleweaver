import type { BlockId } from "../state";
import type { ElementBox } from "../render/render-node";
import type { RenderOutput } from "../render/render";
import { cascadeBodies } from "./cascade-bodies";

/**
 * Cascade every header/footer template body in `rendered.templateContents`,
 * returning a `Map<BlockId, ElementBox>` keyed by each body's root BlockId.
 * Each value is the body root after cascade (populated `computedStyle`), ready
 * for slot layout.
 *
 * **Cascade ALL bodies** (not just plan-referenced ones) — simplest, and
 * removes any dependency on the section-plan header/footer threading.
 *
 * **Incremental reuse, keyed off render-node identity.** The
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
export function cascadeTemplateContents(
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
