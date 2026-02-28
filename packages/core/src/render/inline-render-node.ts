import type { RenderNode } from "./render-node";
import type { RenderStyles } from "./render-styles";

/** An inline render node. */
export interface InlineRenderNode {
  readonly key: string;
  readonly type: "inline";
  readonly styles: RenderStyles;
  readonly children: readonly RenderNode[];
}

/** Create an inline render node. Throws if any child is a block. */
export function createInlineNode(
  key: string,
  styles: RenderStyles,
  children: readonly RenderNode[],
): InlineRenderNode {
  for (const child of children) {
    if (child.type === "block") {
      throw new Error(
        `Inline node "${key}" cannot contain block child "${child.key}"`,
      );
    }
  }
  return Object.freeze({
    key,
    type: "inline" as const,
    styles: Object.freeze({ ...styles }),
    children: Object.freeze([...children]),
  });
}
