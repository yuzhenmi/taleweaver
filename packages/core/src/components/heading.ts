import type { LeafComponentDefinition } from "./component-definition";
import { createElementBox } from "../render/render-node";

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
 * legacy behavior.
 */
export const headingComponent: LeafComponentDefinition = {
  type: "heading",
  kind: "leaf",
  leafShape: "inline-bearing",
  render: (view, _ctx, inlineRenderNodes) => {
    const level = levelFromAttrs(view.attrs.level);
    return createElementBox(view.id, {
      display: "block",
      fontWeight: "bold",
      fontSize: HEADING_FONT_SIZES[level],
      marginBlockStart: { unit: "em", value: 0.67 },
      marginBlockEnd: { unit: "em", value: 0.67 },
    }, inlineRenderNodes);
  },
};
