import type { LayoutBox } from "./layout-box-v2";
import type { RenderNode } from "../render/render-node-v2";
import type { ComputedStyle } from "../styles";
import { computedStylesEqual } from "../cascade/cascade-pass";

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
 */
export function buildLayoutBoxCacheFromTree(
  root: LayoutBox,
  renderRoot: RenderNode,
  cache: LayoutBoxCache = createLayoutBoxCache(),
): LayoutBoxCache {
  const visitPair = (box: LayoutBox, rn: RenderNode) => {
    cache.set(box.key, { box, renderNode: rn });
    if ("children" in box && rn.type === "element") {
      // Walk matching children by key.
      const rnByKey = new Map<string, RenderNode>();
      for (const child of rn.children) {
        rnByKey.set(child.key, child);
      }
      for (const childBox of box.children) {
        const childRn = rnByKey.get(childBox.key);
        if (childRn !== undefined) {
          visitPair(childBox, childRn);
        }
      }
    }
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
