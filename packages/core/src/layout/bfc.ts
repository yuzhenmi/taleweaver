import type { ElementBox } from "../render/render-node-v2";
import type { LayoutBox, BlockBox } from "./layout-box-v2";
import { createBlockBox, createMarkerBox } from "./layout-box-v2";
import { layoutInlineContent } from "./ifc";
import { layoutTable } from "./table-fc";
import type { TextShaper } from "./text-shaper";
import { adaptShaperToMeasurer } from "./text-measurer";
import type { ComputedStyle } from "../styles";
import type { IntrinsicSizingKeyword } from "../styles/length";
import { formatCounter, type CounterStyle } from "./list-counter";
import { createFloatContext } from "./float-context";
import { computeUsedStyle, resolveUsedLength } from "./used-style";
import type { LayoutContext } from "./layout-context";
import { makeChildContext } from "./layout-context";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";

/**
 * Lay out a block-level element in a Block Formatting Context.
 * Plan 1 D.4 scope: stacked block children, padding, adjacent-sibling margin collapse.
 */
export function layoutBlock(
  node: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  ctx: LayoutContext,
  shaper: TextShaper,
): BlockBox {
  const availableInlineSize = ctx.containingInlineSize;
  const writingMode = ctx.writingMode;
  const direction = ctx.direction;
  if (!node.computedStyle) throw new Error("cascade required");
  const cs = node.computedStyle;
  const usedStyle = computeUsedStyle(cs, availableInlineSize, "indefinite");

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

  const finalInlineSize = resolveBoxInlineSize(cs, availableInlineSize, false, node, shaper, ctx);
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
    const ifcCtx = makeChildContext(ctx, cs, contentInlineSize, "indefinite");
    const lines = layoutInlineContent(node, paddingInlineStart, paddingBlockStart, ifcCtx, shaper, floatCtx);
    let lineMaxBlockEdge = paddingBlockStart;
    for (const line of lines) {
      if (line.y + line.height > lineMaxBlockEdge) lineMaxBlockEdge = line.y + line.height;
    }
    const totalBlockSize = lineMaxBlockEdge + paddingBlockEnd;
    return createBlockBox(node.key, inlineOffset, blockOffset, finalInlineSize, totalBlockSize, writingMode, direction, cs, usedStyle, lines,
      /* containingInlineSize */ availableInlineSize,
      node.metadata,
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
    const childUsedStyle = computeUsedStyle(childCs, contentInlineSize, "indefinite");

    // FLOAT BRANCH: floated children are out of normal flow
    if (childCs.float === "inline-start" || childCs.float === "inline-end") {
      // Floats shrink-to-fit by default (auto), but also respect intrinsic keywords.
      const available = contentInlineSize - childUsedStyle.marginInlineStart - childUsedStyle.marginInlineEnd;
      let floatInlineSizeForCtx: number;
      if (childCs.inlineSize === "auto") {
        const intrinsic = computeIntrinsicSizes(child, shaper, ctx.intrinsicCache);
        floatInlineSizeForCtx = Math.min(
          intrinsic.maxContent,
          available,
          Math.max(intrinsic.minContent, available),
        );
      } else {
        floatInlineSizeForCtx = resolveBoxInlineSize(childCs, available, true, child, shaper, ctx);
      }
      const floatCtxChild = makeChildContext(ctx, cs, floatInlineSizeForCtx, "indefinite");
      const floatLayout = layoutBlock(child, 0, 0, floatCtxChild, shaper);
      const floatExplicitBlockSize = resolveExplicitBlockSize(childCs.blockSize, contentInlineSize);
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

    const childCtx = makeChildContext(ctx, cs, contentInlineSize, "indefinite");
    let childLayout: LayoutBox;
    if (childCs.display === "table") {
      childLayout = layoutTable(child, paddingInlineStart, childBlockOffset, childCtx, shaper);
    } else {
      childLayout = layoutBlock(child, paddingInlineStart, childBlockOffset, childCtx, shaper);
    }
    const explicitBlockSize = resolveExplicitBlockSize(childCs.blockSize, contentInlineSize);
    const finalBlockSize = explicitBlockSize > 0 ? explicitBlockSize : childLayout.height;
    const placedChild = explicitBlockSize > 0
      ? createBlockBox(child.key, paddingInlineStart, childBlockOffset, contentInlineSize, finalBlockSize, cs.writingMode, cs.direction, childCs, childUsedStyle, [],
          /* containingInlineSize */ contentInlineSize,
          child.metadata,
        )
      : childLayout;

    // CSS empty-block rule: a block with no content, padding, border, or explicit height
    // has its top and bottom margins collapsed together. The combined margin is passed to
    // the next sibling collapse, and the empty block does not advance childBlockOffset.
    const childPaddingV = childUsedStyle.paddingBlockStart + childUsedStyle.paddingBlockEnd;
    const childBorderV  = childUsedStyle.borderBlockStartWidth + childUsedStyle.borderBlockEndWidth;
    const childExplicitBlockSize = resolveExplicitBlockSizeOrNull(childCs.blockSize, contentInlineSize);
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
        createBlockBox(child.key, paddingInlineStart, preAdvanceBlockOffset, contentInlineSize, 0, cs.writingMode, cs.direction, childCs, childUsedStyle, [],
          /* containingInlineSize */ contentInlineSize,
          child.metadata,
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
    node.key, inlineOffset, blockOffset, finalInlineSize, totalBlockSize, writingMode, direction, cs, usedStyle, layoutChildren,
    /* containingInlineSize */ availableInlineSize,
    node.metadata,
  );
}

/**
 * Resolve the inline-size of a box, handling CSS Sizing 3 intrinsic-sizing keywords
 * (min-content, max-content, fit-content) as well as auto, number, and percent lengths.
 *
 * @param isShrinkToFit  true for shrink-to-fit contexts (inline-block, floats, etc.)
 *   — used only when the keyword is "auto" to decide fill vs. shrink.
 */
function resolveBoxInlineSize(
  cs: ComputedStyle,
  containingInlineSize: number,
  isShrinkToFit: boolean,
  node: ElementBox,
  shaper: TextShaper,
  ctx: LayoutContext,
): number {
  const v = cs.inlineSize;
  if (v === "min-content") {
    const intrinsic = computeIntrinsicSizes(node, shaper, ctx.intrinsicCache);
    return intrinsic.minContent;
  }
  if (v === "max-content") {
    const intrinsic = computeIntrinsicSizes(node, shaper, ctx.intrinsicCache);
    return intrinsic.maxContent;
  }
  if (v === "fit-content") {
    const intrinsic = computeIntrinsicSizes(node, shaper, ctx.intrinsicCache);
    return Math.min(
      intrinsic.maxContent,
      Math.max(intrinsic.minContent, containingInlineSize),
    );
  }
  if (v === "auto") {
    if (isShrinkToFit) {
      const intrinsic = computeIntrinsicSizes(node, shaper, ctx.intrinsicCache);
      return Math.min(
        intrinsic.maxContent,
        Math.max(intrinsic.minContent, containingInlineSize),
      );
    }
    return containingInlineSize; // fill
  }
  // ComputedLength (number or percent)
  const resolved = resolveUsedLength(v, containingInlineSize, containingInlineSize);
  return resolved > 0 ? resolved : containingInlineSize;
}

/**
 * Resolve an explicit block-size for layout (returns 0 for "auto" or intrinsic keywords,
 * which means "use content height").
 */
function resolveExplicitBlockSize(
  blockSize: ComputedStyle["blockSize"],
  containingInlineSize: number,
): number {
  if (blockSize === "auto" || blockSize === "min-content" || blockSize === "max-content" || blockSize === "fit-content") {
    return 0;
  }
  return resolveUsedLength(blockSize, containingInlineSize, 0);
}

/**
 * Resolve an explicit block-size, returning null for "auto" or intrinsic keywords.
 * Used to distinguish "no explicit size given" from "explicit size of 0".
 */
function resolveExplicitBlockSizeOrNull(
  blockSize: ComputedStyle["blockSize"],
  containingInlineSize: number,
): number | null {
  if (blockSize === "auto" || blockSize === "min-content" || blockSize === "max-content" || blockSize === "fit-content") {
    return null;
  }
  return resolveUsedLength(blockSize, containingInlineSize, 0);
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
