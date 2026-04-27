import type { RenderNode } from "../render/render-node-v2";
import type { LayoutBox } from "./layout-box-v2";
import type { TextMeasurer } from "./text-measurer";
import { layoutBlock } from "./bfc";

/**
 * Top-level layout entry. Dispatches by display value of the root node.
 * For Plan 1, only `display: block` is supported at the root.
 */
export function layoutTree(
  root: RenderNode,
  containerWidth: number,
  measurer: TextMeasurer,
): LayoutBox {
  if (root.type !== "element") {
    throw new Error("Layout root must be an element node");
  }
  const cs = root.computedStyle;
  if (!cs) throw new Error("Cascade must run before layout");

  switch (cs.display) {
    case "block":
      return layoutBlock(root, 0, 0, containerWidth, measurer);
    default:
      throw new Error(`display "${cs.display}" not yet implemented in Plan 1`);
  }
}
