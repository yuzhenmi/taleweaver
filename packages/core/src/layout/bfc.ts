import type { ElementBox, RenderNode } from "../render/render-node-v2";
import type { LayoutBox } from "./layout-box-v2";
import { createBlockBox } from "./layout-box-v2";
import type { TextMeasurer } from "./text-measurer";

/**
 * Lay out a block-level element in a Block Formatting Context.
 * Plan 1 D.3 scope: stacked block children, padding, no margin collapse.
 */
export function layoutBlock(
  node: ElementBox,
  x: number,
  y: number,
  availableWidth: number,
  measurer: TextMeasurer,
): LayoutBox {
  if (!node.computedStyle) throw new Error("cascade required");
  const cs = node.computedStyle;

  const paddingTop    = lengthToPx(cs.paddingTop);
  const paddingRight  = lengthToPx(cs.paddingRight);
  const paddingBottom = lengthToPx(cs.paddingBottom);
  const paddingLeft   = lengthToPx(cs.paddingLeft);

  const contentWidth = availableWidth - paddingLeft - paddingRight;

  let childY = paddingTop;
  const layoutChildren: LayoutBox[] = [];

  for (const child of node.children) {
    if (child.type !== "element") continue;     // text/inline skipped in Plan 1 D.3 stub
    if (!child.computedStyle) throw new Error("cascade required");

    const childLayout = layoutBlock(child, paddingLeft, childY, contentWidth, measurer);
    // Resolve child height: explicit or 0 (no auto sizing yet — Task D.5/D.7)
    const explicitHeight = lengthToPx(child.computedStyle.height === "auto" ? 0 : child.computedStyle.height);
    const finalHeight = explicitHeight > 0 ? explicitHeight : childLayout.height;
    const placedChild = explicitHeight > 0
      ? createBlockBox(child.key, paddingLeft, childY, contentWidth, finalHeight, child.computedStyle, [])
      : childLayout;

    layoutChildren.push(placedChild);
    childY += placedChild.height;
  }

  const totalHeight = childY + paddingBottom;

  return createBlockBox(
    node.key, x, y, availableWidth, totalHeight, cs, layoutChildren,
  );
}

function lengthToPx(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return 0;  // "auto", "none"
  if (v && typeof v === "object" && "unit" in v && v.unit === "px") {
    return (v as { value: number }).value;
  }
  // percent left for layout-time resolution (not yet supported in Plan 1)
  return 0;
}
