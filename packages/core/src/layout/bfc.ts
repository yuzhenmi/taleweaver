import type { ElementBox, RenderNode } from "../render/render-node-v2";
import type { LayoutBox, BlockBox } from "./layout-box-v2";
import { createBlockBox, createMarkerBox } from "./layout-box-v2";
import { layoutInlineContent } from "./ifc";
import { layoutTable } from "./table-fc";
import type { TextMeasurer } from "./text-measurer";
import type { ComputedStyle } from "../styles";
import { formatCounter, type CounterStyle } from "./list-counter";
import { createFloatContext } from "./float-context";

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
): BlockBox {
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

  const hasBlockContent = node.children.some(
    (c) =>
      c.type === "element" &&
      (c.computedStyle?.display === "block" ||
       c.computedStyle?.display === "list-item"),
  );
  const hasInlineContent = !hasBlockContent && node.children.some(
    (c) =>
      c.type === "text" ||
      (c.type === "element" &&
        (c.computedStyle?.display === "inline" || c.computedStyle?.display === "inline-block")),
  );

  if (hasInlineContent) {
    const floatCtx = createFloatContext();
    const lines = layoutInlineContent(node, paddingLeft, paddingTop, contentWidth, measurer, floatCtx);
    let lineMaxY = paddingTop;
    for (const line of lines) {
      if (line.y + line.height > lineMaxY) lineMaxY = line.y + line.height;
    }
    const totalHeight = lineMaxY + paddingBottom;
    return createBlockBox(node.key, x, y, finalWidth, totalHeight, cs, lines, node.metadata);
  }

  let childY = paddingTop;
  const layoutChildren: LayoutBox[] = [];
  const floatCtx = createFloatContext();

  let prevMarginBottom = 0;
  let listCounter = 0;
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (!child.computedStyle) throw new Error("cascade required");
    const childCs = child.computedStyle;

    // FLOAT BRANCH: floated children are out of normal flow
    if (childCs.float === "left" || childCs.float === "right") {
      const floatLayout = layoutBlock(child, 0, 0, contentWidth, measurer);
      const floatExplicitHeight = lengthToPx(childCs.height === "auto" ? 0 : childCs.height);
      const floatWidth = floatLayout.width;
      const floatHeight = floatExplicitHeight > 0 ? floatExplicitHeight : floatLayout.height;
      const active = floatCtx.activeAt(childY);
      const placedX = childCs.float === "left"
        ? paddingLeft + active.leftWidth
        : paddingLeft + contentWidth - active.rightWidth - floatWidth;
      const positioned: LayoutBox = Object.freeze({
        ...floatLayout,
        x: placedX,
        y: childY,
      } as LayoutBox);
      floatCtx.placeFloat({
        side: childCs.float,
        x: placedX,
        y: childY,
        width: floatWidth,
        height: floatHeight,
      });
      layoutChildren.push(positioned);
      // Float is out of normal flow — do NOT advance childY or update prevMarginBottom.
      continue;
    }

    // CLEAR BRANCH: advance childY past cleared floats before applying margins
    if (childCs.clear !== "none") {
      const clearedY = floatCtx.clearY(childCs.clear, childY);
      if (clearedY > childY) {
        childY = clearedY;
      }
    }

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

    // List-item marker generation
    if (childCs.display === "list-item") {
      listCounter++;
      const markerText = resolveMarkerText(childCs, listCounter);
      if (markerText !== null) {
        const markerWidth = measurer.measureWidth(markerText, childCs);
        const markerHeight = measurer.measureHeight(childCs);
        const markerGap = 4;
        const markerX = childCs.listStylePosition === "inside"
          ? paddingLeft
          : paddingLeft - markerWidth - markerGap;
        const markerBox = createMarkerBox(
          `${child.key}-marker`,
          markerX, childY,
          markerWidth, markerHeight,
          childCs, markerText,
        );
        layoutChildren.push(markerBox);
      }
    }

    let childLayout: LayoutBox;
    if (childCs.display === "table") {
      childLayout = layoutTable(child, paddingLeft, childY, contentWidth, measurer);
    } else {
      childLayout = layoutBlock(child, paddingLeft, childY, contentWidth, measurer);
    }
    const explicitHeight = lengthToPx(childCs.height === "auto" ? 0 : childCs.height);
    const finalHeight = explicitHeight > 0 ? explicitHeight : childLayout.height;
    const placedChild = explicitHeight > 0
      ? createBlockBox(child.key, paddingLeft, childY, contentWidth, finalHeight, childCs, [], child.metadata)
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
        createBlockBox(child.key, paddingLeft, preAdvanceY, contentWidth, 0, childCs, [], child.metadata),
      );
    } else {
      layoutChildren.push(placedChild);
      childY += placedChild.height;
      prevMarginBottom = childMarginBottom;
    }
  }

  const lastMarginBottom = noBottomBoundary ? 0 : prevMarginBottom;
  const inFlowHeight = childY + lastMarginBottom + paddingBottom;

  // FLOAT ENCLOSURE: BFC's content height includes the lowest float bottom.
  const floatBottom = floatCtx.lowestBottom();
  const totalHeight = Math.max(inFlowHeight, floatBottom + paddingBottom);

  return createBlockBox(
    node.key, x, y, finalWidth, totalHeight, cs, layoutChildren, node.metadata,
  );
}

function resolveMarkerText(cs: ComputedStyle, counter: number): string | null {
  const lst = cs.listStyleType;
  if (lst === "none") return null;
  if (typeof lst === "object") return lst.content;
  switch (lst) {
    case "disc":   return "•";
    case "circle": return "○";
    case "square": return "▪";
    case "decimal":
    case "lower-alpha":
    case "upper-alpha":
    case "lower-roman":
    case "upper-roman":
      return formatCounter(counter, lst as CounterStyle);
  }
  return null;
}

function lengthToPx(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return 0;  // "auto", "none"
  if (v && typeof v === "object" && "unit" in v && v.unit === "px") {
    return (v as unknown as { value: number }).value;
  }
  // percent left for layout-time resolution (not yet supported in Plan 1)
  return 0;
}

function lengthOrZero(v: unknown): number {
  return typeof v === "number" ? v : 0;
}
