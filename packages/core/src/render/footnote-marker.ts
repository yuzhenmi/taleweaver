/**
 * @module render/footnote-marker
 *
 * FN-2: build the inline RenderNode for a `footnote-anchor` EmbedItem — the
 * superscript call marker (a raised, reduced-size number, e.g. a small "1").
 * The displayed number comes from the FN-3 numbering module
 * (`footnoteNumbers`), keyed by the anchor's `properties.contentBlockId`.
 *
 * Marker geometry (Google Docs parity):
 *  - **Reduced font-size.** `font-size: 0.75em` of the surrounding text — the
 *    established superscript scale (matches Google Docs' raised footnote
 *    reference, close to the browser `<sup>` 0.83em default). Expressed as an
 *    `em` Length so the IFC cascade resolves it against the inherited
 *    surrounding font-size (a 16px paragraph → a 12px marker; a 24px heading →
 *    an 18px marker).
 *  - **Raised baseline.** `verticalAlign: "super"` — true superscript: the
 *    marker's baseline is raised by `SUPERSCRIPT_RAISE_FRACTION` of the
 *    surrounding (parent) used font-size (CSS Inline 3 baseline-shift, see
 *    `ifc.ts` applyVerticalAlign). A pure block-axis shift — the smaller glyphs
 *    come from the `font-size: 0.75em` above, not from the shift. Matches how
 *    Google Docs / the browser `<sup>` raise a footnote reference.
 *
 * Cursor semantics: the marker is ONE inline-block ElementBox = exactly one
 * state-model cursor stop (one offset unit), identical to every other embed
 * (see `expandInlineItems` in `render-core.ts`). Giving it visible text content
 * does NOT change its offset contribution — the IFC emits one atomic token per
 * inline-block regardless of its children.
 */
import type { Length, Style } from "../styles";
import type { LayoutBoxMetadata } from "./layout-metadata";
import { createElementBox, createTextBox, type RenderNode } from "./render-node";

/**
 * Reduced font-size scale for the marker, relative to the surrounding text —
 * the established superscript scale (spec §2: "reduced font-size").
 */
export const FOOTNOTE_MARKER_FONT_SCALE = 0.75;

/** `font-size` Length applied to the marker (a fraction of inherited em). */
const MARKER_FONT_SIZE: Length = {
  unit: "em",
  value: FOOTNOTE_MARKER_FONT_SCALE,
};

/**
 * The text rendered when an anchor's number is missing from the numbering map.
 * This should not happen for a valid anchor — every anchor in the main
 * document is collected by `collectFootnoteAnchors`, so every anchor has a
 * number. Rendering `"?"` instead of crashing keeps a transient inconsistency
 * (e.g. a mid-operation render) visible-but-survivable rather than a hard
 * failure. See status report.
 */
export const FOOTNOTE_MARKER_MISSING_TEXT = "?";

/**
 * Build the superscript call-marker RenderNode for a footnote anchor.
 *
 * @param key the inline RenderNode key (`${blockId}/inline/${i}`, supplied by
 *   `expandInlineItems` so it is stable across re-renders of the block).
 * @param itemStyle the embed item's own attr-derived style (footnote anchors
 *   carry no wrap attrs today, so this is typically empty — but it is spread
 *   LAST so any future per-anchor styling overrides the marker defaults the
 *   same way it does for plain embeds).
 * @param formatted the displayed number string (`FootnoteNumber.formatted`),
 *   or `undefined` when the anchor is absent from the numbering map.
 * @param metadata the embed metadata (`{ embedType, ...properties }`) — the
 *   same shape a plain embed carries — so the marker box stays recognizable as
 *   a footnote-anchor embed for downstream cursor/hit-test/editing (FN-7).
 */
export function buildFootnoteMarker(
  key: string,
  itemStyle: Partial<Style>,
  formatted: string | undefined,
  metadata?: Readonly<LayoutBoxMetadata>,
): RenderNode {
  const text = formatted ?? FOOTNOTE_MARKER_MISSING_TEXT;
  // Marker container: inline-block (one atomic IFC token = one cursor stop),
  // reduced font-size + raised via verticalAlign. Defaults FIRST so a future
  // per-anchor `itemStyle` can override them (same precedence as plain embeds).
  const markerStyle: Partial<Style> = {
    display: "inline-block",
    fontSize: MARKER_FONT_SIZE,
    // Raise the marker above the surrounding baseline (superscript).
    // True superscript: a parent-font-relative baseline raise (see ifc.ts).
    verticalAlign: "super",
    ...itemStyle,
  };
  // The number text is a normal inline child of the marker; it inherits the
  // reduced font-size from the marker container during cascade.
  const numberText = createTextBox(`${key}/marker-text`, {}, text);
  return createElementBox(key, markerStyle, [numberText], metadata);
}
