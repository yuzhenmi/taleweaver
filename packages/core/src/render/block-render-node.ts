import type { RenderNode } from "./render-node";
import type { RenderStyles } from "./render-styles";

/** A block render node. */
export interface BlockRenderNode {
  readonly key: string;
  readonly type: "block";
  readonly styles: RenderStyles;
  readonly children: readonly RenderNode[];
  readonly marker?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Create a block render node. */
export function createBlockNode(
  key: string,
  styles: RenderStyles,
  children: readonly RenderNode[],
  marker?: string,
  metadata?: Record<string, unknown>,
): BlockRenderNode {
  return Object.freeze({
    key,
    type: "block" as const,
    styles: Object.freeze({ ...styles }),
    children: Object.freeze([...children]),
    ...(marker !== undefined ? { marker } : {}),
    ...(metadata !== undefined ? { metadata: Object.freeze({ ...metadata }) } : {}),
  });
}
