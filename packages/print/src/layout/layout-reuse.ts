import type { LayoutBox } from "./layout-box";
import type { RenderNode } from "@taleweaver/core";
import type { ComputedStyle } from "@taleweaver/core";
import { computedStylesEqual } from "@taleweaver/core";
import { flattenContents } from "./group-children";

/** Entry stored per render-node key in the cache. */
export interface LayoutBoxCacheEntry {
  /** The layout box produced from this render node in the previous pass. */
  readonly box: LayoutBox;
  /**
   * The render node that produced the box. Used to guard against re-keyed
   * content: even if two nodes share a key, if the reference changed the
   * subtree content may have changed and reuse is unsafe.
   */
  readonly renderNode: RenderNode;
  /**
   * In-flow block-size consumed by this box's flow (gapless; EXCLUDES
   * out-of-flow floats). Mirrors `LayoutResult.inFlowConsumed`. The cache is
   * rebuilt from a positioned box tree (`buildLayoutBoxCacheFromTree`), which no
   * longer carries the original in-flow scalar AS A RESULT — but the BFC stamps
   * it ON THE BOX (`BlockBox.inFlowConsumed`) at its full / partial-fragment
   * return sites, so the cache reads it back EXACTLY. For a box enclosing a
   * float TALLER than its in-flow content, `box.blockSize`
   * (`Math.max(inFlow, lowestFloatBlockEdge + paddingBlockEnd)`) over-states the
   * in-flow value; the on-box `inFlowConsumed` does not. A BlockBox that never
   * enclosed a float carries no on-box scalar (it equals `blockSize` by
   * construction), and any non-BlockBox box (line/table inner) has no float
   * either — both fall back to `box.blockSize`.
   */
  readonly inFlowConsumed: number;
}

/**
 * Snapshot of the previous layout, keyed by render-node key.
 *
 * For non-fragmented, non-anonymous boxes this is simply the box's `key` field.
 * The cache is populated by `buildLayoutBoxCacheFromTree` and consulted at
 * the top of `layoutBlock` to short-circuit re-layout of unchanged subtrees.
 *
 * Each entry stores both the box AND the render node that produced it. The BFC
 * checks render-node reference equality before accepting a cached entry.
 */
export interface LayoutBoxCache {
  get(renderNodeKey: string): LayoutBoxCacheEntry | undefined;
  set(renderNodeKey: string, entry: LayoutBoxCacheEntry): void;
  clear(): void;
}

export function createLayoutBoxCache(): LayoutBoxCache {
  const map = new Map<string, LayoutBoxCacheEntry>();
  return {
    get(key) { return map.get(key); },
    set(key, entry) { map.set(key, entry); },
    clear() { map.clear(); },
  };
}

/**
 * Build a LayoutBoxCache by walking a previous layout tree and indexing each
 * box by its render-node key (which corresponds to the box's `key` field).
 *
 * @param root the root LayoutBox from the previous layout pass.
 * @param renderRoot the render-node subtree that produced `root`. Used to
 *   populate per-entry render-node references for identity checking.
 * @param cache optional existing cache to populate (creates a new one if omitted).
 *
 * ## Wrapper transparency (L-PERF-A)
 *
 * In paginated layouts, the engine wraps real render-node-keyed boxes in
 * anonymous wrappers: `paginateRoot` produces a root BlockBox whose children
 * are `PageBox`es; each `PageBox` wraps one per-page `BlockBox` (whose key
 * collides with the root's key by construction). None of those wrappers
 * correspond to a render node, so a strict by-key descent stops at the
 * outermost wrapper layer and leaves the per-paragraph paint trees unindexed.
 *
 * The traversal therefore treats any layout-box whose key does NOT match a
 * render-node sibling as transparent: it recurses into the wrapper's
 * children with the same `rnByKey` map, so the per-paragraph layout boxes
 * deeper in the tree still get paired with their render nodes and cached.
 * Without this descent, per-keystroke layout on a paginated document
 * re-lays-out every paragraph on every page (the per-page `layoutBlock`
 * never finds a cache entry to short-circuit on).
 *
 * **Spanning-paragraph limitation.** A paragraph that fragments across
 * multiple pages produces a per-page partial-fragment LayoutBox with the
 * same `key` in each per-page subtree. The walk visits both — `cache.set`
 * fires twice for the same key and the last write wins. This does NOT
 * cause incorrect reuse in practice because L-PERF-A's
 * `isResumeFromDegenerate` gate in `bfc.layoutBlock` rejects reuse for
 * any non-fresh-start request: the second-page call requesting the
 * paragraph's continuation has a non-degenerate `resumeFrom`, so it
 * never consults the cached first-page fragment. For workloads where
 * every paragraph fits on one page (the common interactive editing
 * case), there is no collision. A spanning-paragraph-aware cache that
 * indexes by `(key, resumeFrom)` is future work if non-degenerate
 * partial reuse becomes desirable.
 */
export function buildLayoutBoxCacheFromTree(
  root: LayoutBox,
  renderRoot: RenderNode,
  cache: LayoutBoxCache = createLayoutBoxCache(),
): LayoutBoxCache {
  const walkChildren = (
    boxes: readonly LayoutBox[],
    rnByKey: Map<string, RenderNode>,
  ) => {
    for (const childBox of boxes) {
      const childRn = rnByKey.get(childBox.key);
      if (childRn !== undefined) {
        visitPair(childBox, childRn);
      } else if ("children" in childBox) {
        // Anonymous wrapper (PageBox, per-page BlockBox, etc.) — recurse
        // with the SAME rnByKey so descendants reach their render nodes.
        walkChildren(childBox.children, rnByKey);
      }
    }
  };
  const visitPair = (box: LayoutBox, rn: RenderNode) => {
    // Read the in-flow-consumed scalar from the box EXACTLY when the BFC stamped
    // it (a BlockBox enclosing a taller float carries `inFlowConsumed < blockSize`);
    // every other box has no enclosed float, so its in-flow size equals
    // `box.blockSize` by construction — the `?? box.blockSize` fallback.
    const inFlowConsumed =
      box.type === "block" && box.inFlowConsumed !== undefined
        ? box.inFlowConsumed
        : box.blockSize;
    cache.set(box.key, { box, renderNode: rn, inFlowConsumed });
    if (!("children" in box) || rn.type !== "element") return;
    // Index by the FLATTENED render-node children: `box.children` come from
    // `groupChildren`/`layoutBlock`, which flatten `display: contents` elements,
    // so the layout boxes carry the contents element's grandchildren keys (not
    // the contents element's own key). Building `rnByKey` from raw `rn.children`
    // would orphan those layout boxes from their render nodes and silently break
    // L-PERF-A reuse for them on every keystroke. (Same-ref fast path when no
    // contents element is present.)
    const rnByKey = new Map<string, RenderNode>();
    for (const child of flattenContents(rn.children)) {
      rnByKey.set(child.key, child);
    }
    walkChildren(box.children, rnByKey);
  };
  visitPair(root, renderRoot);
  return cache;
}

/**
 * True when two render nodes would produce identical layout output.
 *
 * This is a STRONGER condition than `===` — used by BFC's reuse gate to
 * recognize the case where the upstream pipeline (renderTreeIncremental +
 * cascadePassIncremental) rebuilt a parent node because its children array
 * changed, but the children themselves are reference-equal to the cached
 * version. In that case the parent's layout output is provably identical
 * to the cached one and we can short-circuit the entire subtree.
 *
 * Without this, every paragraph edit forces the document root to iterate
 * all N children even when only one paragraph actually changed — O(N)
 * per keystroke despite per-child reuse hitting the cache.
 *
 * The check is shallow on children (per-position reference equality only)
 * and relies on cascadePassIncremental having reused subtree references
 * for unchanged subtrees. Combined: O(children-count) ref comparisons,
 * orders of magnitude cheaper than O(children-count) layoutBlock calls.
 */
export function renderNodesLayoutEquivalent(a: RenderNode, b: RenderNode): boolean {
  if (a === b) return true;
  if (a.type !== b.type) return false;
  if (a.key !== b.key) return false;
  // ComputedStyle drives layout — not the raw `style` (which is rebuilt by
  // createElementBox on every call regardless of content). cascade's
  // structural-equality path reuses the old computedStyle reference when
  // the value is unchanged, so reference equality here means "no relevant
  // style change for layout purposes".
  if (a.computedStyle !== b.computedStyle) return false;

  if (a.type === "element" && b.type === "element") {
    // Element-specific: metadata reference, then children per-position refs.
    if (a.metadata !== b.metadata) return false;
    if (a.children.length !== b.children.length) return false;
    for (let i = 0; i < a.children.length; i++) {
      if (a.children[i] !== b.children[i]) return false;
    }
    return true;
  }
  if (a.type === "text" && b.type === "text") {
    // Text-specific: text content.
    return a.text === b.text;
  }
  return false;
}

export interface ReuseInputs {
  readonly computedStyle: ComputedStyle;
  readonly availableInlineSize: number;
  readonly writingMode: ComputedStyle["writingMode"];
  readonly direction: ComputedStyle["direction"];
  /**
   * Float environment dirty-block-offset: if any float was placed at-or-above
   * this box's block-offset, the box may need re-layout.
   * Pass `Number.POSITIVE_INFINITY` when there is no float change (no prev
   * float environment, or environments are identical).
   */
  readonly floatEnvDirtyBlockOffset: number;
}

/**
 * Determine if a previously-laid-out box can be reused for the current layout.
 *
 * Reuse rules (conservative — when in doubt, return false):
 *   - computedStyle identity (or computedStylesEqual deep check)
 *   - availableInlineSize matches prev.inlineSize (auto-width blocks fill the container)
 *   - writingMode + direction match
 *   - float-env dirty-block-offset is strictly below this box's block-end (so
 *     no float change affects the box's layout)
 */
export function isLayoutBoxReusable(
  prev: LayoutBox,
  inputs: ReuseInputs,
): boolean {
  // Computed style.
  if (prev.computedStyle !== inputs.computedStyle) {
    if (!computedStylesEqual(prev.computedStyle, inputs.computedStyle)) {
      return false;
    }
  }

  // Inline-size: for auto-width blocks, prev.inlineSize equals the container's
  // inline-size; for explicit-size boxes it reflects the resolved explicit size.
  // Either way, if prev.inlineSize !== the new container size, the box may
  // need a different size and we must re-layout.
  if (prev.inlineSize !== inputs.availableInlineSize) {
    return false;
  }

  // Writing-mode + direction.
  if (prev.writingMode !== inputs.writingMode) return false;
  if (prev.direction !== inputs.direction) return false;

  // Float-env: if the dirty block-offset is at or above this box's block-end,
  // a float change may have pushed content in this box and we must re-layout.
  // dirtyBlockOffset of +Infinity means "nothing changed" → safe to reuse.
  if (inputs.floatEnvDirtyBlockOffset <= prev.blockOffset + prev.blockSize) {
    return false;
  }

  return true;
}
