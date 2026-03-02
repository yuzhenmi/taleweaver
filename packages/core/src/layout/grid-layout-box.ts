import type { LayoutBox } from "./layout-node";

/** A grid layout box (for tables). */
export interface GridLayoutBox {
  readonly key: string;
  readonly type: "grid";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly children: readonly LayoutBox[];
  readonly columnWidths: readonly number[];
  readonly rowHeights: readonly number[];
}

/** Create a grid layout box. */
export function createGridLayoutBox(
  key: string,
  x: number,
  y: number,
  width: number,
  height: number,
  children: readonly LayoutBox[],
  columnWidths: readonly number[],
  rowHeights: readonly number[],
): GridLayoutBox {
  return Object.freeze({
    key,
    type: "grid" as const,
    x,
    y,
    width,
    height,
    children: Object.freeze([...children]),
    columnWidths: Object.freeze([...columnWidths]),
    rowHeights: Object.freeze([...rowHeights]),
  });
}
