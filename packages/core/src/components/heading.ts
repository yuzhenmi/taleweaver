import type { LeafComponentDefinition } from "./component-definition";
import type { Style } from "../styles";
import { createElementBox } from "../render/render-node";
import {
  textAlignFromAttrs,
  lineHeightFromAttrs,
  marginInlineStartFromAttrs,
  marginBlockStartFromAttrs,
  marginBlockEndFromAttrs,
  writingModeFromAttrs,
  langFromAttrs,
  tabStopsFromAttrs,
} from "./leaf-style-attrs";

/**
 * Heading font sizes by level (h1 — h6), in px. Matches legacy
 * `heading-legacy.ts` for byte-equivalent visual output.
 */
export const HEADING_FONT_SIZES: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, number>> = Object.freeze({
  1: 32, 2: 28, 3: 24, 4: 20, 5: 18, 6: 16,
});

function levelFromAttrs(level: unknown): 1 | 2 | 3 | 4 | 5 | 6 {
  if (level === 1 || level === 2 || level === 3 || level === 4 || level === 5 || level === 6) {
    return level;
  }
  return 1;
}

/**
 * Heading: a leaf block carrying inline content + a `level` attr (1–6).
 * Per-level fontSize is set; bold + level-relative margin defaults match
 * legacy behavior. An authored `textAlign` attr is forwarded onto the
 * ElementBox `style` so it reaches the layout cascade (see
 * `leaf-style-attrs.ts`).
 */
export const headingComponent: LeafComponentDefinition = {
  type: "heading",
  kind: "leaf",
  leafShape: "inline-bearing",
  // "Style for the following paragraph": Enter at the END of a heading creates
  // a Normal paragraph below, not another heading (Word / Google Docs).
  splitFollowOnType: "paragraph",
  render: (view, _ctx, inlineRenderNodes) => {
    const level = levelFromAttrs(view.attrs.level);
    const writingMode = writingModeFromAttrs(view.attrs.writingMode);
    const language = langFromAttrs(view.attrs.lang);
    const textAlign = textAlignFromAttrs(view.attrs.textAlign);
    const lineHeight = lineHeightFromAttrs(view.attrs.lineHeight);
    const marginInlineStart = marginInlineStartFromAttrs(view.attrs.marginInlineStart);
    const marginBlockStart = marginBlockStartFromAttrs(view.attrs.marginBlockStart);
    const marginBlockEnd = marginBlockEndFromAttrs(view.attrs.marginBlockEnd);
    const tabStops = tabStopsFromAttrs(view.attrs.tabStops);
    const style: Style = {
      display: "block",
      fontWeight: "bold",
      fontSize: HEADING_FONT_SIZES[level],
      marginBlockStart: { unit: "em", value: 0.67 },
      marginBlockEnd: { unit: "em", value: 0.67 },
      ...(writingMode !== undefined ? { writingMode } : {}),
      ...(language !== undefined ? { language } : {}),
      ...(textAlign !== undefined ? { textAlign } : {}),
      ...(lineHeight !== undefined ? { lineHeight } : {}),
      ...(tabStops !== undefined ? { tabStops } : {}),
      ...(marginInlineStart !== undefined ? { marginInlineStart } : {}),
      // Paragraph-spacing attrs WIN over the heading's default 0.67em block
      // margins above (spread last). Absent attr → default unchanged.
      ...(marginBlockStart !== undefined ? { marginBlockStart } : {}),
      ...(marginBlockEnd !== undefined ? { marginBlockEnd } : {}),
    };
    return createElementBox(view.id, style, inlineRenderNodes, { headingLevel: level });
  },
};
