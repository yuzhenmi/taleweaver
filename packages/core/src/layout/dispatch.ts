import type { RenderNode, ElementBox } from "../render/render-node-v2";
import type { LayoutBox } from "./layout-box-v2";
import type { TextMeasurer } from "./text-measurer";
import { layoutBlock } from "./bfc";
import { layoutTable } from "./table-fc";
import { cascadePass } from "../cascade";

/**
 * Top-level layout entry. Dispatches by display value of the root node.
 * For Plan 1, only `display: block` is supported at the root.
 * If the render tree has not had cascade applied, runs it automatically.
 */
export function layoutTree(
  root: RenderNode,
  containerWidth: number,
  measurer: TextMeasurer,
): LayoutBox {
  if (root.type !== "element") {
    throw new Error("Layout root must be an element node");
  }
  // Auto-run cascade if computedStyle is not populated
  const layoutRoot: ElementBox = root.computedStyle
    ? root
    : (cascadePass(root) as ElementBox);

  const cs = layoutRoot.computedStyle;
  if (!cs) throw new Error("Cascade must run before layout");

  switch (cs.display) {
    case "block":
      return layoutBlock(layoutRoot, 0, 0, containerWidth, measurer);
    case "table":
      return layoutTable(layoutRoot, 0, 0, containerWidth, measurer);
    default:
      throw new Error(`display "${cs.display}" not yet implemented in Plan 1`);
  }
}
