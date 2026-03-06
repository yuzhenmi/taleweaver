import type { LayoutBox } from "./layout-node";

/** A table layout box. */
export interface TableLayoutBox {
  readonly key: string;
  readonly type: "table";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly children: readonly LayoutBox[];
  readonly columnWidths: readonly number[];
  readonly rowHeights: readonly number[];
}

/** Create a table layout box. */
export function createTableLayoutBox(
  key: string,
  x: number,
  y: number,
  width: number,
  height: number,
  children: readonly LayoutBox[],
  columnWidths: readonly number[],
  rowHeights: readonly number[],
): TableLayoutBox {
  return Object.freeze({
    key,
    type: "table" as const,
    x,
    y,
    width,
    height,
    children: Object.freeze([...children]),
    columnWidths: Object.freeze([...columnWidths]),
    rowHeights: Object.freeze([...rowHeights]),
  });
}
