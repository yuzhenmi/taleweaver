import type { LayoutBox } from "./layout-node";

/** A page layout box. */
export interface PageLayoutBox {
  readonly key: string;
  readonly type: "page";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly children: readonly LayoutBox[];
}

/** Create a page layout box. Throws if any child is a text box. */
export function createPageLayoutBox(
  key: string,
  x: number,
  y: number,
  width: number,
  height: number,
  children: readonly LayoutBox[],
): PageLayoutBox {
  for (const child of children) {
    if (child.type === "text") {
      throw new Error(
        `Page layout box "${key}" cannot directly contain text child "${child.key}"`,
      );
    }
  }
  return Object.freeze({
    key,
    type: "page" as const,
    x,
    y,
    width,
    height,
    children: Object.freeze([...children]),
  });
}
