import type { RenderStyles } from "./render-styles";

/** A text render node (leaf). */
export interface TextRenderNode {
  readonly key: string;
  readonly type: "text";
  readonly text: string;
  readonly styles: RenderStyles;
  readonly children: readonly [];
}

/** Create a text render node (leaf). */
export function createTextRenderNode(
  key: string,
  text: string,
  styles: RenderStyles,
): TextRenderNode {
  return Object.freeze({
    key,
    type: "text" as const,
    text,
    styles: Object.freeze({ ...styles }),
    children: Object.freeze([] as const),
  });
}
