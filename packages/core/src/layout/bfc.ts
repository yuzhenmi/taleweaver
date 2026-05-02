import type { ElementBox } from "../render/render-node-v2";
import type { LayoutBox, BlockBox } from "./layout-box-v2";
import { createBlockBox, createMarkerBox } from "./layout-box-v2";
import type { BlockBreakToken, BreakToken, FragmentationContext, LayoutResult } from "./fragmentation";
import { layoutInlineContent } from "./ifc";
import { layoutTable } from "./table-fc";
import type { TextShaper } from "./text-shaper";
import { adaptShaperToMeasurer } from "./text-measurer";
import type { ComputedStyle } from "../styles";
import { formatCounter } from "./list-counter";
import { computeUsedStyle, resolveUsedLength } from "./used-style";
import type { LayoutContext } from "./layout-context";
import { makeChildContext } from "./layout-context";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";
import { groupChildren, anonymousBlockKey } from "./group-children";
import { isLayoutBoxReusable, renderNodesLayoutEquivalent } from "./layout-reuse";
import { markStart, markEnd } from "../perf/perf-trace";

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
  fragmentation?: FragmentationContext,
): LayoutResult<BlockBox> {
  const t = markStart("bfc.layoutBlock");
  try {
  const availableInlineSize = ctx.containingInlineSize;
  const writingMode = ctx.writingMode;
  const direction = ctx.direction;
  if (!node.computedStyle) throw new Error("cascade required");
  const cs = node.computedStyle;

  // Subtree reuse: if a previous layout exists, check whether this block's
  // output is still valid. Conservative — only reuse when all inputs match.
  //
  // The render-node identity gate accepts two equivalence levels:
  //   (a) `node === entry.renderNode` — strictly the same reference.
  //   (b) `renderNodesLayoutEquivalent(node, entry.renderNode)` — the parent
  //       was rebuilt because its children-array changed, but its children
  //       are reference-equal to the cached version (a "structurally inert"
  //       rebuild). This is the common case for the document root after a
  //       single-paragraph edit: 999 of 1000 children flow through unchanged
  //       via renderTreeIncremental + cascadePassIncremental, the parent's
  //       children array is fresh, and only one child actually mutated.
  //       Without this gate, every keystroke would force the document root
  //       to iterate all N children — O(N) reuse-cache hits even when 999
  //       are inert.
  if (ctx.prevLayoutCache !== null) {
    const entry = ctx.prevLayoutCache.get(node.key);
    if (entry !== undefined && entry.box.type === "block") {
      if (renderNodesLayoutEquivalent(node, entry.renderNode)) {
        const dirtyOffset = ctx.prevFloatEnv !== null
          ? ctx.floatEnv.dirtyBlockOffsetSince(ctx.prevFloatEnv)
          : Number.POSITIVE_INFINITY;
        if (isLayoutBoxReusable(entry.box, {
          computedStyle: cs,
          availableInlineSize,
          writingMode,
          direction,
          floatEnvDirtyBlockOffset: dirtyOffset,
        })) {
          return { box: entry.box, breakToken: null };
        }
      }
    }
  }
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

  let childBlockOffset = paddingBlockStart;
  const layoutChildren: LayoutBox[] = [];
  // Use the float environment from the context. If this block establishes a new
  // BFC, makeChildContext (called by our parent) already gave us a fresh env.
  // If it doesn't, we share the parent's env so floats rise up to the BFC.
  const floatEnv = ctx.floatEnv;
  // ctx.isBFCRoot is true when the parent gave this box its OWN fresh float env.
  // Only a BFC root encloses its floats; non-BFC blocks pass floats to the ancestor BFC.
  const isOwnBFC = ctx.isBFCRoot;

  let prevMarginBlockEnd = 0;
  let listCounter = 0;

  const groups = groupChildren(node);

  /**
   * Build a partial LayoutResult<BlockBox> from the children placed so far
   * and a non-null break token. Used when fragmentation stops the loop early.
   */
  function buildPartialResult(
    placedChildren: LayoutBox[],
    breakToken: BlockBreakToken,
  ): LayoutResult<BlockBox> {
    if (placedChildren.length === 0) {
      return { box: null, breakToken };
    }
    const lastMarginBlockEndPartial = noBottomBoundary ? 0 : prevMarginBlockEnd;
    const inFlowBlockSizePartial = childBlockOffset + lastMarginBlockEndPartial + paddingBlockEnd;
    let totalBlockSizePartial: number;
    if (isOwnBFC) {
      const floatBlockEnd = floatEnv.lowestFloatBlockEdge();
      totalBlockSizePartial = Math.max(inFlowBlockSizePartial, floatBlockEnd + paddingBlockEnd);
    } else {
      totalBlockSizePartial = inFlowBlockSizePartial;
    }
    return {
      box: createBlockBox(
        node.key, inlineOffset, blockOffset, finalInlineSize, totalBlockSizePartial,
        writingMode, direction, cs, usedStyle, placedChildren,
        /* containingInlineSize */ availableInlineSize,
        node.metadata,
      ),
      breakToken,
    };
  }

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (group.kind === "inline-run") {
      // Synthesize an anonymous ElementBox for this inline-run group and lay it out via IFC.
      const anonKey = anonymousBlockKey(node.key, group.positionalIndex);
      const anonElement: ElementBox = Object.freeze({
        type: "element" as const,
        key: anonKey,
        style: node.style,
        computedStyle: cs,
        children: Object.freeze([...group.children]),
      });

      // Pass floatEnv explicitly via the context: the anonymous IFC element
      // inherits this block's float env (same BFC), so pass it in ctx.floatEnv.
      // We create a child context that carries the same floatEnv.
      const ifcCtx = makeChildContext(ctx, cs, contentInlineSize, "indefinite");
      const ifcResult = layoutInlineContent(anonElement, paddingInlineStart, childBlockOffset, ifcCtx, shaper);
      if (ifcResult.box === null) {
        throw new Error("layoutInlineContent returned null box; should be unreachable in B.2 (fragmentation not yet wired)");
      }
      const ifcBox = ifcResult.box;

      const anonBlockSize = ifcBox.height;

      // Append lines directly to layoutChildren (anonymous boxes are layout-time-only).
      for (const line of ifcBox.children) layoutChildren.push(line);

      childBlockOffset += anonBlockSize;
      prevMarginBlockEnd = 0; // anonymous box has no margin
      continue;
    }

    // group.kind === "block"
    const child = group.child;
    if (child.type !== "element") continue;
    if (!child.computedStyle) throw new Error("cascade required");
    const childCs = child.computedStyle;
    const childUsedStyle = computeUsedStyle(childCs, contentInlineSize, "indefinite");

    // FLOAT BRANCH: floated children are out of normal flow.
    // Fragmentation is NOT applied to floats in C.1 (deferred to a later task).
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
      // Float establishes its own BFC (cs.float !== "none"); pass childCs so
      // makeChildContext detects this and gives the float a fresh float env.
      const floatCtxChild = makeChildContext(ctx, childCs, floatInlineSizeForCtx, "indefinite");
      const floatResult = layoutBlock(child, 0, 0, floatCtxChild, shaper);
      if (floatResult.box === null) {
        throw new Error("layoutBlock recursive call returned null box; should be unreachable in B.1 (fragmentation not yet wired)");
      }
      const floatLayout = floatResult.box;
      const floatExplicitBlockSize = resolveExplicitBlockSize(childCs.blockSize, contentInlineSize);
      const floatInlineSize = floatLayout.width;
      const floatBlockSize = floatExplicitBlockSize > 0 ? floatExplicitBlockSize : floatLayout.height;
      const result = floatEnv.placeFloat(
        childCs.float === "inline-start" ? "inline-start" : "inline-end",
        childBlockOffset,
        floatInlineSize,
        floatBlockSize,
        contentInlineSize,
      );
      const placedInlineOffset = result.inlineOffset;
      const placedBlockOffset = result.blockOffset;

      const positioned: LayoutBox = Object.freeze({
        ...floatLayout,
        x: paddingInlineStart + placedInlineOffset,
        y: placedBlockOffset,
      } as LayoutBox);
      layoutChildren.push(positioned);
      // Float is out of normal flow — do NOT advance childBlockOffset or update prevMarginBlockEnd.
      continue;
    }

    // CLEAR BRANCH: compute clearance.
    let clearanceApplied = 0;
    if (childCs.clear !== "none") {
      const clearedY = floatEnv.clearance(childCs.clear, childBlockOffset);
      if (clearedY > childBlockOffset) {
        clearanceApplied = clearedY - childBlockOffset;
        childBlockOffset = clearedY;
      }
    }

    const childMarginBlockStart = childUsedStyle.marginBlockStart;
    const childMarginBlockEnd   = childUsedStyle.marginBlockEnd;

    const preAdvanceBlockOffset = childBlockOffset;

    if (clearanceApplied > 0) {
      // CSS 8.3.1: clearance interrupts margin collapse. The box's
      // marginBlockStart adds without collapsing with prev sibling's
      // marginBlockEnd or with parent's marginBlockStart.
      childBlockOffset += childMarginBlockStart;
      // prevMarginBlockEnd is consumed by the clearance — reset so it does not
      // flow through to the next sibling collapse.
      prevMarginBlockEnd = 0;
    } else if (layoutChildren.length > 0) {
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

    // Pass childCs (child's own computed style) so makeChildContext can detect
    // whether the child establishes a new BFC and create a fresh float env.
    const childCtx = makeChildContext(ctx, childCs, contentInlineSize, "indefinite");

    // Derive a FragmentationContext for the child with reduced availableBlockSize.
    // C.7 will plumb resumeFrom tokens; for C.1, resumeFrom is always null on
    // recursive calls.
    const childFragmentation: FragmentationContext | undefined =
      fragmentation === undefined
        ? undefined
        : {
            availableBlockSize: fragmentation.availableBlockSize - childBlockOffset,
            pageIndex: fragmentation.pageIndex,
            resumeFrom: null,
          };

    let childLayout: LayoutBox;
    let childResultBreakToken: BreakToken | null = null;
    if (childCs.display === "table") {
      const tableResult = layoutTable(child, paddingInlineStart, childBlockOffset, childCtx, shaper, childFragmentation);
      if (tableResult.box === null) {
        // Table couldn't fit anything on this fragment. Propagate as a break.
        return buildPartialResult(layoutChildren, {
          type: "block",
          resumeChildIndex: i,
          resumeChildToken: tableResult.breakToken,
        });
      }
      childLayout = tableResult.box;
      childResultBreakToken = tableResult.breakToken;
    } else {
      const childResult = layoutBlock(child, paddingInlineStart, childBlockOffset, childCtx, shaper, childFragmentation);
      if (childResult.box === null) {
        // Child couldn't fit anything on this fragment. Propagate as a break.
        return buildPartialResult(layoutChildren, {
          type: "block",
          resumeChildIndex: i,
          resumeChildToken: childResult.breakToken,
        });
      }
      childLayout = childResult.box;
      childResultBreakToken = childResult.breakToken;
    }

    const explicitBlockSize = resolveExplicitBlockSize(childCs.blockSize, contentInlineSize);
    const finalBlockSize = explicitBlockSize > 0 ? explicitBlockSize : childLayout.height;
    const placedChild = explicitBlockSize > 0
      ? createBlockBox(child.key, paddingInlineStart, childBlockOffset, contentInlineSize, finalBlockSize, cs.writingMode, cs.direction, childCs, childUsedStyle, [],
          /* containingInlineSize */ contentInlineSize,
          child.metadata,
        )
      : childLayout;

    // Whole-block fit check: does the placed child fit in remaining space?
    // This check uses the final placed size (after explicit block-size override).
    if (fragmentation !== undefined) {
      const remaining = fragmentation.availableBlockSize - childBlockOffset;
      if (placedChild.height > remaining) {
        return buildPartialResult(layoutChildren, {
          type: "block",
          resumeChildIndex: i,
          resumeChildToken: null,
        });
      }
    }

    // Propagate child break token if the child itself was mid-fragmenting.
    if (childResultBreakToken !== null) {
      layoutChildren.push(placedChild);
      childBlockOffset += placedChild.height;
      return buildPartialResult(layoutChildren, {
        type: "block",
        resumeChildIndex: i,
        resumeChildToken: childResultBreakToken,
      });
    }

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

  // FLOAT ENCLOSURE: only a BFC root encloses its own floats. A non-BFC block
  // shares the parent BFC's float env — its floats belong to the ancestor BFC,
  // so this block's height is determined solely by in-flow content.
  let totalBlockSize: number;
  if (isOwnBFC) {
    const floatBlockEnd = floatEnv.lowestFloatBlockEdge();
    totalBlockSize = Math.max(inFlowBlockSize, floatBlockEnd + paddingBlockEnd);
  } else {
    totalBlockSize = inFlowBlockSize;
  }

  return { box: createBlockBox(
    node.key, inlineOffset, blockOffset, finalInlineSize, totalBlockSize, writingMode, direction, cs, usedStyle, layoutChildren,
    /* containingInlineSize */ availableInlineSize,
    node.metadata,
  ), breakToken: null };
  } finally {
    markEnd("bfc.layoutBlock", t);
  }
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
      return formatCounter(counter, lst);
    default: {
      // Exhaustiveness check: if a new ListStyleType literal is added, this
      // forces TS to flag the missing case here instead of silently returning
      // null. Closes Plan 1 F7.x preexisting unreachable-code diagnostic.
      const _exhaustive: never = lst;
      return _exhaustive;
    }
  }
}
