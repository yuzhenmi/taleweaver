import type { LayoutBox } from "./layout-node";

/** A line layout box. */
export interface LineLayoutBox {
  readonly key: string;
  readonly type: "line";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly children: readonly LayoutBox[];
}

/** Create a line layout box. Throws if any child is not a text box. */
export function createLineLayoutBox(
  key: string,
  x: number,
  y: number,
  width: number,
  height: number,
  children: readonly LayoutBox[],
): LineLayoutBox {
  for (const child of children) {
    if (child.type !== "text") {
      throw new Error(
        `Line layout box "${key}" can only contain text children, got "${child.type}" child "${child.key}"`,
      );
    }
  }
  return Object.freeze({
    key,
    type: "line" as const,
    x,
    y,
    width,
    height,
    children: Object.freeze([...children]),
  });
}
