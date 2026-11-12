import type { ComputedStyle, ElementBox, IntrinsicContribution, RenderNode, TextShaper } from "@taleweaver/core";
import { resolveUsedLength } from "./used-style";
import { markerGutterPadding, measureListMarker } from "./list-marker-gutter";

// Percent margins / padding resolve against an indefinite size during an
// intrinsic query, which CSS Sizing 3 §5.2.1 (cyclic percentages) treats as 0;
// `auto` margins are 0 too.
const zeroBasis = (v: ComputedStyle["marginInlineStart"]): number => resolveUsedLength(v, 0, 0);

/**
 * The box's inline-axis padding + borders (border box − content box), as they
 * count in its own intrinsic size: an outside list marker wider than the
 * authored gutter widens the padding, as the BFC lays the item out
 * (`markerGutterPadding`).
 */
export function intrinsicInlineDecoration(node: ElementBox, cs: ComputedStyle, shaper: TextShaper): number {
  const authoredStart = zeroBasis(cs.paddingInlineStart);
  const marker = measureListMarker(node, cs, shaper);
  const start = marker === null ? authoredStart : markerGutterPadding(cs, marker.inlineSize, authoredStart);
  return cs.borderInlineStartWidth + start + zeroBasis(cs.paddingInlineEnd) + cs.borderInlineEndWidth;
}

/** The box's inline-axis margins `[start, end]`, as they count in its contribution. */
export function intrinsicInlineMargins(cs: ComputedStyle): readonly [number, number] {
  return [zeroBasis(cs.marginInlineStart), zeroBasis(cs.marginInlineEnd)];
}

/**
 * A child's intrinsic CONTRIBUTION to its container: its own size plus its
 * inline margins — the margin box (CSS Sizing 3 §5.1). Margins count for the
 * boxes layout places with their margins (block-level boxes, inline-blocks,
 * floats); not for a table cell (margins do not apply), nor for a
 * `display: inline` box (the IFC lays out no inline box decoration yet, so its
 * margins / padding take no space).
 */
export function outerContribution(child: RenderNode, own: IntrinsicContribution): IntrinsicContribution {
  if (child.type !== "element" || child.computedStyle === undefined) return own;
  const cs = child.computedStyle;
  if (cs.display === "inline" || cs.display === "table-cell" || cs.display === "contents") return own;
  const [start, end] = intrinsicInlineMargins(cs);
  const m = start + end;
  if (m === 0) return own;
  return {
    minContent: own.minContent + m,
    maxContent: own.maxContent + m,
    // An inline-block's first unit is the whole box (margins included); a
    // block-level box has none.
    firstCluster: own.firstCluster === 0 ? 0 : own.firstCluster + m,
    restMin: own.restMin + m,
  };
}
