import type { RenderNode } from "./render-node";
import type { RenderStyles } from "./render-styles";

/** A grid render node (for tables). */
export interface GridRenderNode {
  readonly key: string;
  readonly type: "grid";
  readonly styles: RenderStyles;
  readonly children: readonly RenderNode[];
  readonly columnWidths: readonly number[];
  readonly rowHeights: readonly number[];
}

/** Create a grid render node. */
export function createGridNode(
  key: string,
  styles: RenderStyles,
  children: readonly RenderNode[],
  columnWidths: readonly number[],
  rowHeights: readonly number[],
): GridRenderNode {
  return Object.freeze({
    key,
    type: "grid" as const,
    styles: Object.freeze({ ...styles }),
    children: Object.freeze([...children]),
    columnWidths: Object.freeze([...columnWidths]),
    rowHeights: Object.freeze([...rowHeights]),
  });
}
