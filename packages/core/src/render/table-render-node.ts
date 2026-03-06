import type { RenderNode } from "./render-node";
import type { RenderStyles } from "./render-styles";

/** A table render node. */
export interface TableRenderNode {
  readonly key: string;
  readonly type: "table";
  readonly styles: RenderStyles;
  readonly children: readonly RenderNode[];
  readonly columnWidths: readonly number[];
  readonly rowHeights: readonly number[];
}

/** Create a table render node. */
export function createTableNode(
  key: string,
  styles: RenderStyles,
  children: readonly RenderNode[],
  columnWidths: readonly number[],
  rowHeights: readonly number[],
): TableRenderNode {
  return Object.freeze({
    key,
    type: "table" as const,
    styles: Object.freeze({ ...styles }),
    children: Object.freeze([...children]),
    columnWidths: Object.freeze([...columnWidths]),
    rowHeights: Object.freeze([...rowHeights]),
  });
}
