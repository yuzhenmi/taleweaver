import type { RenderNode } from "../render/render-node-v2";
import type { LayoutBox } from "./layout-box-v2";
import type { TextShaper } from "./text-shaper";
import type { TextMeasurer } from "./text-measurer";
import { layoutTree } from "./dispatch";

/**
 * Incremental layout entry point.
 * Plan 2 keeps it simple: short-circuit when the entire tree is reference-equal
 * AND the container width is unchanged. Otherwise, fall back to full layout.
 *
 * (More aggressive subtree-by-subtree incremental layout can be added later
 * if performance demands it. The major win in Plan 2 is the cascade incremental
 * combined with the editor pipeline's structural sharing — many subtrees stay
 * reference-equal across keystrokes.)
 */
export function layoutTreeIncremental(
  newRoot: RenderNode,
  _oldRoot: RenderNode | null,
  oldLayout: LayoutBox | null,
  containerWidth: number,
  shaperOrMeasurer: TextShaper | TextMeasurer,
): LayoutBox {
  if (newRoot === _oldRoot && oldLayout && oldLayout.width === containerWidth) {
    return oldLayout;
  }
  return layoutTree(newRoot, containerWidth, shaperOrMeasurer);
}
