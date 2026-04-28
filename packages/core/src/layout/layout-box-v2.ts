import type { ComputedStyle } from "../styles";

export type LayoutBox = BlockBox | LineBox | TextRunBox | InlineBox | InlineBlockBox | MarkerBox | TableBox | TableRowBox | TableCellBox;

interface LayoutBoxBase {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly computedStyle: Readonly<ComputedStyle>;
}

export interface BlockBox extends LayoutBoxBase {
  readonly type: "block";
  readonly children: readonly LayoutBox[];
}

export interface LineBox extends LayoutBoxBase {
  readonly type: "line";
  readonly children: readonly LayoutBox[];
  readonly baseline: number;
}

export interface TextRunBox extends LayoutBoxBase {
  readonly type: "text-run";
  readonly text: string;
}

/**
 * `fragmentEdge` indicates which side of an inline element this fragment is:
 * - "only"   — the element does not fragment (single line); has all paddings and borders.
 * - "first"  — the leading fragment; has start-side padding/border, no end-side.
 * - "middle" — neither leading nor trailing; no horizontal padding or border.
 * - "last"   — the trailing fragment; has end-side padding/border, no start-side.
 */
export type InlineFragmentEdge = "first" | "middle" | "last" | "only";

export interface InlineBox extends LayoutBoxBase {
  readonly type: "inline";
  readonly children: readonly LayoutBox[];
  readonly fragmentEdge: InlineFragmentEdge;
}

export interface InlineBlockBox extends LayoutBoxBase {
  readonly type: "inline-block";
  readonly children: readonly LayoutBox[];
}

export interface MarkerBox extends LayoutBoxBase {
  readonly type: "marker";
  readonly text: string;
}

export interface TableBox extends LayoutBoxBase {
  readonly type: "table";
  readonly children: readonly LayoutBox[];
  readonly columnPxWidths: readonly number[];
}

export interface TableRowBox extends LayoutBoxBase {
  readonly type: "table-row";
  readonly children: readonly LayoutBox[];
}

export interface TableCellBox extends LayoutBoxBase {
  readonly type: "table-cell";
  readonly children: readonly LayoutBox[];
}

export function createBlockBox(
  key: string,
  x: number, y: number, width: number, height: number,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
): BlockBox {
  return Object.freeze({
    type: "block" as const,
    key, x, y, width, height,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
  });
}

export function createLineBox(
  key: string,
  x: number, y: number, width: number, height: number,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
  baseline: number = height,
): LineBox {
  return Object.freeze({
    type: "line" as const,
    key, x, y, width, height,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
    baseline,
  });
}

export function createTextRunBox(
  key: string,
  x: number, y: number, width: number, height: number,
  computedStyle: ComputedStyle,
  text: string,
): TextRunBox {
  return Object.freeze({
    type: "text-run" as const,
    key, x, y, width, height,
    computedStyle: Object.freeze({ ...computedStyle }),
    text,
  });
}

export function createInlineBox(
  key: string,
  x: number, y: number, width: number, height: number,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
  fragmentEdge: InlineFragmentEdge,
): InlineBox {
  return Object.freeze({
    type: "inline" as const,
    key, x, y, width, height,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
    fragmentEdge,
  });
}

export function createInlineBlockBox(
  key: string,
  x: number, y: number, width: number, height: number,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
): InlineBlockBox {
  return Object.freeze({
    type: "inline-block" as const,
    key, x, y, width, height,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
  });
}

export function createMarkerBox(
  key: string,
  x: number, y: number, width: number, height: number,
  computedStyle: ComputedStyle,
  text: string,
): MarkerBox {
  return Object.freeze({
    type: "marker" as const,
    key, x, y, width, height,
    computedStyle: Object.freeze({ ...computedStyle }),
    text,
  });
}

export function createTableBox(
  key: string,
  x: number, y: number, width: number, height: number,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
  columnPxWidths: readonly number[],
): TableBox {
  return Object.freeze({
    type: "table" as const,
    key, x, y, width, height,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
    columnPxWidths: Object.freeze([...columnPxWidths]),
  });
}

export function createTableRowBox(
  key: string,
  x: number, y: number, width: number, height: number,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
): TableRowBox {
  return Object.freeze({
    type: "table-row" as const,
    key, x, y, width, height,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
  });
}

export function createTableCellBox(
  key: string,
  x: number, y: number, width: number, height: number,
  computedStyle: ComputedStyle,
  children: readonly LayoutBox[],
): TableCellBox {
  return Object.freeze({
    type: "table-cell" as const,
    key, x, y, width, height,
    computedStyle: Object.freeze({ ...computedStyle }),
    children: Object.freeze([...children]),
  });
}
