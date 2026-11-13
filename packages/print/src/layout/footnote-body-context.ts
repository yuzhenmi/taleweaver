import { createFloatEnvironment } from "./float-context";
import type { LayoutContext } from "./layout-context";

/**
 * The context a footnote body is laid out in, at `inlineSize`: its own BFC
 * (CSS 9.4.1), so the page body's floats never reach it and its own floats
 * never leak into the body or another footnote. Every measure and materialize
 * layout of a body (or a resumed fragment of one) gets a fresh one, so both
 * passes lay it identically.
 */
export function footnoteBodyContext(ctx: LayoutContext, inlineSize: number): LayoutContext {
  return {
    ...ctx,
    containingInlineSize: inlineSize,
    floatEnv: createFloatEnvironment(),
    isBFCRoot: true,
    floatArea: { lineLeft: 0, bfcInlineSize: inlineSize },
  };
}
