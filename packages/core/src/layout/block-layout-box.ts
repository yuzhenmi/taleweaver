import type { LayoutBox } from "./layout-node";

/** A block layout box. */
export interface BlockLayoutBox {
  readonly key: string;
  readonly type: "block";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly children: readonly LayoutBox[];
  readonly marker?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Create a block layout box. Throws if any child is a text box. */
export function createBlockLayoutBox(
  key: string,
  x: number,
  y: number,
  width: number,
  height: number,
  children: readonly LayoutBox[],
  marker?: string,
  metadata?: Record<string, unknown>,
): BlockLayoutBox {
  for (const child of children) {
    if (child.type === "text") {
      throw new Error(
        `Block layout box "${key}" cannot directly contain text child "${child.key}"`,
      );
    }
  }
  return Object.freeze({
    key,
    type: "block" as const,
    x,
    y,
    width,
    height,
    children: Object.freeze([...children]),
    ...(marker !== undefined ? { marker } : {}),
    ...(metadata !== undefined ? { metadata: Object.freeze({ ...metadata }) } : {}),
  });
}
