import type { RenderNode } from "./render-node";
import type { RenderStyles } from "./render-styles";

/** A block render node. */
export interface BlockRenderNode {
  readonly key: string;
  readonly type: "block";
  readonly styles: RenderStyles;
  readonly children: readonly RenderNode[];
}

/** Create a block render node. */
export function createBlockNode(
  key: string,
  styles: RenderStyles,
  children: readonly RenderNode[],
): BlockRenderNode {
  return Object.freeze({
    key,
    type: "block" as const,
    styles: Object.freeze({ ...styles }),
    children: Object.freeze([...children]),
  });
}
