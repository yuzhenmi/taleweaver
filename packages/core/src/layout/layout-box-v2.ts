import type { ComputedStyle } from "../styles";

export type LayoutBox = BlockBox | LineBox | TextRunBox;

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
