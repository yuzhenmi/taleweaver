import type { ElementBox } from "../render/render-node-v2";
import type { LayoutBox, BlockBox } from "./layout-box-v2";
import { createBlockBox, createMarkerBox } from "./layout-box-v2";
import { layoutInlineContent } from "./ifc";
import { layoutTable } from "./table-fc";
import type { TextShaper } from "./text-shaper";
import { adaptShaperToMeasurer } from "./text-measurer";
import type { ComputedStyle } from "../styles";
import { formatCounter, type CounterStyle } from "./list-counter";
import { createFloatContext } from "./float-context";
import type { WritingMode, Direction } from "../styles/writing-mode";
import { computeUsedStyle } from "./used-style";

/**
 * Lay out a block-level element in a Block Formatting Context.
 * Plan 1 D.4 scope: stacked block children, padding, adjacent-sibling margin collapse.
 */
export function layoutBlock(
  node: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  availableInlineSize: number,
  shaper: TextShaper,
  writingMode: WritingMode = "horizontal-tb",
  direction: Direction = "ltr",
): BlockBox {
  if (!node.computedStyle) throw new Error("cascade required");
  const cs = node.computedStyle;
  const usedStyle = computeUsedStyle(cs, availableInlineSize);

  const paddingBlockStart  = usedStyle.paddingBlockStart;
  const paddingInlineEnd   = usedStyle.paddingInlineEnd;
  const paddingBlockEnd    = usedStyle.paddingBlockEnd;
  const paddingInlineStart = usedStyle.paddingInlineStart;

  // CSS parent/first and parent/last collapse rules:
  // if the parent has no top padding/border, the first child's marginBlockStart
  // is suppressed (collapses with parent's outside margin).
  // Symmetric for bottom.
  const noTopBoundary = paddingBlockStart === 0 && usedStyle.borderBlockStartWidth === 0;
  const noBottomBoundary = paddingBlockEnd === 0 && usedStyle.borderBlockEndWidth === 0;

  const explicitInlineSize = cs.inlineSize === "auto" ? null : usedStyle.inlineSize;
  const finalInlineSize = explicitInlineSize !== null && explicitInlineSize > 0 ? explicitInlineSize : availableInlineSize;
  const contentInlineSize = finalInlineSize - paddingInlineStart - paddingInlineEnd;

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
    const lines = layoutInlineContent(node, paddingInlineStart, paddingBlockStart, contentInlineSize, shaper, floatCtx, cs.writingMode, cs.direction);
    let lineMaxBlockEdge = paddingBlockStart;
    for (const line of lines) {
      if (line.y + line.height > lineMaxBlockEdge) lineMaxBlockEdge = line.y + line.height;
    }
    const totalBlockSize = lineMaxBlockEdge + paddingBlockEnd;
    return createBlockBox(node.key, inlineOffset, blockOffset, finalInlineSize, totalBlockSize, writingMode, direction, cs, usedStyle, lines, node.metadata,
      /* containingInlineSize */ availableInlineSize,
    );
  }

  let childBlockOffset = paddingBlockStart;
  const layoutChildren: LayoutBox[] = [];
  const floatCtx = createFloatContext();

  let prevMarginBlockEnd = 0;
  let listCounter = 0;
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (!child.computedStyle) throw new Error("cascade required");
    const childCs = child.computedStyle;
    const childUsedStyle = computeUsedStyle(childCs, contentInlineSize);

    // FLOAT BRANCH: floated children are out of normal flow
    if (childCs.float === "inline-start" || childCs.float === "inline-end") {
      const floatLayout = layoutBlock(child, 0, 0, contentInlineSize, shaper, cs.writingMode, cs.direction);
      const floatExplicitBlockSize = childCs.blockSize === "auto" ? 0 : childUsedStyle.blockSize;
      const floatInlineSize = floatLayout.width;
      const floatBlockSize = floatExplicitBlockSize > 0 ? floatExplicitBlockSize : floatLayout.height;
      const active = floatCtx.activeAt(childBlockOffset);
      const placedInlineOffset = childCs.float === "inline-start"
        ? paddingInlineStart + active.inlineStartSize
        : paddingInlineStart + contentInlineSize - active.inlineEndSize - floatInlineSize;
      const positioned: LayoutBox = Object.freeze({
        ...floatLayout,
        x: placedInlineOffset,
        y: childBlockOffset,
      } as LayoutBox);
      floatCtx.placeFloat({
        side: childCs.float === "inline-start" ? "inline-start" : "inline-end",
        inlineOffset: placedInlineOffset,
        blockOffset: childBlockOffset,
        inlineSize: floatInlineSize,
        blockSize: floatBlockSize,
      });
      layoutChildren.push(positioned);
      // Float is out of normal flow — do NOT advance childBlockOffset or update prevMarginBlockEnd.
      continue;
    }

    // CLEAR BRANCH: advance childBlockOffset past cleared floats before applying margins
    if (childCs.clear !== "none") {
      const clearedY = floatCtx.clearY(childCs.clear, childBlockOffset);
      if (clearedY > childBlockOffset) {
        childBlockOffset = clearedY;
      }
    }

    const childMarginBlockStart = childUsedStyle.marginBlockStart;
    const childMarginBlockEnd   = childUsedStyle.marginBlockEnd;

    // Adjacent-siblings collapse:
    // gap = max(prevMarginBlockEnd, childMarginBlockStart)
    const preAdvanceBlockOffset = childBlockOffset;
    if (layoutChildren.length > 0) {
      childBlockOffset += Math.max(prevMarginBlockEnd, childMarginBlockStart);
    } else {
      childBlockOffset += noTopBoundary ? 0 : childMarginBlockStart;
    }

    // List-item marker generation
    if (childCs.display === "list-item") {
      listCounter++;
      const markerText = resolveMarkerText(childCs, listCounter);
      if (markerText !== null) {
        // Use a measurer adapter for the simple width/height calls needed for marker boxes.
        const measurer = adaptShaperToMeasurer(shaper);
        const markerInlineSize = measurer.measureWidth(markerText, childCs);
        const markerBlockSize = measurer.measureHeight(childCs);
        const markerGap = 4;
        const markerInlineOffset = childCs.listStylePosition === "inside"
          ? paddingInlineStart
          : paddingInlineStart - markerInlineSize - markerGap;
        const markerBox = createMarkerBox(
          `${child.key}-marker`,
          markerInlineOffset, childBlockOffset,
          markerInlineSize, markerBlockSize,
          cs.writingMode, cs.direction,
          childCs, childUsedStyle,
          markerText,
          /* containingInlineSize */ contentInlineSize,
        );
        layoutChildren.push(markerBox);
      }
    }

    let childLayout: LayoutBox;
    if (childCs.display === "table") {
      childLayout = layoutTable(child, paddingInlineStart, childBlockOffset, contentInlineSize, shaper);
    } else {
      childLayout = layoutBlock(child, paddingInlineStart, childBlockOffset, contentInlineSize, shaper, cs.writingMode, cs.direction);
    }
    const explicitBlockSize = childCs.blockSize === "auto" ? 0 : childUsedStyle.blockSize;
    const finalBlockSize = explicitBlockSize > 0 ? explicitBlockSize : childLayout.height;
    const placedChild = explicitBlockSize > 0
      ? createBlockBox(child.key, paddingInlineStart, childBlockOffset, contentInlineSize, finalBlockSize, cs.writingMode, cs.direction, childCs, childUsedStyle, [], child.metadata,
          /* containingInlineSize */ contentInlineSize,
        )
      : childLayout;

    // CSS empty-block rule: a block with no content, padding, border, or explicit height
    // has its top and bottom margins collapsed together. The combined margin is passed to
    // the next sibling collapse, and the empty block does not advance childBlockOffset.
    const childPaddingV = childUsedStyle.paddingBlockStart + childUsedStyle.paddingBlockEnd;
    const childBorderV  = childUsedStyle.borderBlockStartWidth + childUsedStyle.borderBlockEndWidth;
    const childExplicitBlockSize = childCs.blockSize === "auto" ? null : childUsedStyle.blockSize;
    const isEmpty = (childExplicitBlockSize === null || childExplicitBlockSize === 0)
                 && childPaddingV === 0
                 && childBorderV === 0
                 && childLayout.height === 0;

    if (isEmpty) {
      // Undo the marginBlockStart advance; the combined margin is held for the next sibling collapse
      childBlockOffset = preAdvanceBlockOffset;
      prevMarginBlockEnd = Math.max(prevMarginBlockEnd, childMarginBlockStart, childMarginBlockEnd);
      // Place the empty block at preAdvanceBlockOffset (zero height, no y-slot consumed)
      layoutChildren.push(
        createBlockBox(child.key, paddingInlineStart, preAdvanceBlockOffset, contentInlineSize, 0, cs.writingMode, cs.direction, childCs, childUsedStyle, [], child.metadata,
          /* containingInlineSize */ contentInlineSize,
        ),
      );
    } else {
      layoutChildren.push(placedChild);
      childBlockOffset += placedChild.height;
      prevMarginBlockEnd = childMarginBlockEnd;
    }
  }

  const lastMarginBlockEnd = noBottomBoundary ? 0 : prevMarginBlockEnd;
  const inFlowBlockSize = childBlockOffset + lastMarginBlockEnd + paddingBlockEnd;

  // FLOAT ENCLOSURE: BFC's content height includes the lowest float bottom.
  const floatBlockEnd = floatCtx.lowestBottom();
  const totalBlockSize = Math.max(inFlowBlockSize, floatBlockEnd + paddingBlockEnd);

  return createBlockBox(
    node.key, inlineOffset, blockOffset, finalInlineSize, totalBlockSize, writingMode, direction, cs, usedStyle, layoutChildren, node.metadata,
    /* containingInlineSize */ availableInlineSize,
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
