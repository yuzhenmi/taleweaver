import type { ComputedStyle, ElementBox, TextShaper } from "@taleweaver/core";
import { adaptShaperToMeasurer, composeComputed } from "@taleweaver/core";

/** The gap between an outside marker and the item's content edge. */
export const MARKER_GAP = 4;

export interface ListMarkerMetrics {
  readonly text: string;
  /** The marker's style: the ¶'s character props over the item's style (Word). */
  readonly cs: ComputedStyle;
  readonly inlineSize: number;
  readonly blockSize: number;
}

/** The item's render-baked marker, measured; `null` when it has none. */
export function measureListMarker(node: ElementBox, cs: ComputedStyle, shaper: TextShaper): ListMarkerMetrics | null {
  const text = cs.markerText;
  if (text === undefined || text === "") return null;
  const measurer = adaptShaperToMeasurer(shaper);
  const markerStyle = node.metadata?.list?.markerStyle;
  const markerCs = markerStyle === undefined ? cs : composeComputed(markerStyle, cs);
  return { text, cs: markerCs, inlineSize: measurer.measureWidth(text, markerCs), blockSize: measurer.measureHeight(markerCs) };
}

/**
 * The item's effective inline-start padding: an `outside` marker wider than the
 * authored gutter (marker + gap > padding) widens it to exactly marker + gap, so
 * the marker sits flush at the item's border edge instead of hanging past it.
 * An `inside` marker never widens.
 */
export function markerGutterPadding(cs: ComputedStyle, markerInlineSize: number, authoredPadding: number): number {
  const needed = markerInlineSize + MARKER_GAP;
  return cs.listStylePosition !== "inside" && needed > authoredPadding ? needed : authoredPadding;
}
