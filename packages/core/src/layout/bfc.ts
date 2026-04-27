import type { ElementBox, RenderNode } from "../render/render-node-v2";
import type { LayoutBox } from "./layout-box-v2";
import { createBlockBox } from "./layout-box-v2";
import { layoutInlineContent } from "./ifc";
import type { TextMeasurer } from "./text-measurer";

/**
 * Lay out a block-level element in a Block Formatting Context.
 * Plan 1 D.4 scope: stacked block children, padding, adjacent-sibling margin collapse.
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

  // CSS parent/first and parent/last collapse rules:
  // if the parent has no top padding/border, the first child's marginTop
  // is suppressed (collapses with parent's outside margin).
  // Symmetric for bottom.
  const noTopBoundary = paddingTop === 0 && lengthOrZero(cs.borderTopWidth) === 0;
  const noBottomBoundary = paddingBottom === 0 && lengthOrZero(cs.borderBottomWidth) === 0;

  const explicitWidth = cs.width === "auto" ? null : lengthToPx(cs.width);
  const finalWidth = explicitWidth !== null && explicitWidth > 0 ? explicitWidth : availableWidth;
  const contentWidth = finalWidth - paddingLeft - paddingRight;

  const hasInlineContent = node.children.some(
    (c) => c.type === "text" || (c.type === "element" && c.computedStyle?.display === "inline"),
  );

  if (hasInlineContent) {
    const lines = layoutInlineContent(node, paddingLeft, paddingTop, contentWidth, measurer);
    let lineMaxY = paddingTop;
    for (const line of lines) {
      if (line.y + line.height > lineMaxY) lineMaxY = line.y + line.height;
    }
    const totalHeight = lineMaxY + paddingBottom;
    return createBlockBox(node.key, x, y, finalWidth, totalHeight, cs, lines);
  }

  let childY = paddingTop;
  const layoutChildren: LayoutBox[] = [];

  let prevMarginBottom = 0;
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (!child.computedStyle) throw new Error("cascade required");
    const childCs = child.computedStyle;

    const childMarginTop    = lengthOrZero(childCs.marginTop);
    const childMarginBottom = lengthOrZero(childCs.marginBottom);

    // Adjacent-siblings collapse:
    // gap = max(prevMarginBottom, childMarginTop)
    const preAdvanceY = childY;
    if (layoutChildren.length > 0) {
      childY += Math.max(prevMarginBottom, childMarginTop);
    } else {
      childY += noTopBoundary ? 0 : childMarginTop;
    }

    const childLayout = layoutBlock(child, paddingLeft, childY, contentWidth, measurer);
    const explicitHeight = lengthToPx(childCs.height === "auto" ? 0 : childCs.height);
    const finalHeight = explicitHeight > 0 ? explicitHeight : childLayout.height;
    const placedChild = explicitHeight > 0
      ? createBlockBox(child.key, paddingLeft, childY, contentWidth, finalHeight, childCs, [])
      : childLayout;

    // CSS empty-block rule: a block with no content, padding, border, or explicit height
    // has its top and bottom margins collapsed together. The combined margin is passed to
    // the next sibling collapse, and the empty block does not advance childY.
    const childPaddingV = lengthOrZero(childCs.paddingTop) + lengthOrZero(childCs.paddingBottom);
    const childBorderV  = lengthOrZero(childCs.borderTopWidth) + lengthOrZero(childCs.borderBottomWidth);
    const childExplicitHeight = childCs.height === "auto" ? null : lengthToPx(childCs.height);
    const isEmpty = (childExplicitHeight === null || childExplicitHeight === 0)
                 && childPaddingV === 0
                 && childBorderV === 0
                 && childLayout.height === 0;

    if (isEmpty) {
      // Undo the marginTop advance; the combined margin is held for the next sibling collapse
      childY = preAdvanceY;
      prevMarginBottom = Math.max(prevMarginBottom, childMarginTop, childMarginBottom);
      // Place the empty block at preAdvanceY (zero height, no y-slot consumed)
      layoutChildren.push(
        createBlockBox(child.key, paddingLeft, preAdvanceY, contentWidth, 0, childCs, []),
      );
    } else {
      layoutChildren.push(placedChild);
      childY += placedChild.height;
      prevMarginBottom = childMarginBottom;
    }
  }

  const lastMarginBottom = noBottomBoundary ? 0 : prevMarginBottom;
  const totalHeight = childY + lastMarginBottom + paddingBottom;

  return createBlockBox(
    node.key, x, y, finalWidth, totalHeight, cs, layoutChildren,
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

function lengthOrZero(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
