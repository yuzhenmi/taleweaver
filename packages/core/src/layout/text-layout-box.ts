import type { RenderStyles } from "../render/render-styles";

/** A text layout box (leaf). */
export interface TextLayoutBox {
  readonly key: string;
  readonly type: "text";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text: string;
  readonly styles?: RenderStyles;
  readonly children: readonly [];
}

/** Create a text layout box. */
export function createTextLayoutBox(
  key: string,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  styles?: RenderStyles,
): TextLayoutBox {
  const box: TextLayoutBox = {
    key,
    type: "text" as const,
    x,
    y,
    width,
    height,
    text,
    ...(styles && Object.keys(styles).length > 0 ? { styles } : {}),
    children: Object.freeze([] as const),
  };
  return Object.freeze(box);
}
