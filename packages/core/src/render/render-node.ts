import type { BlockRenderNode } from "./block-render-node";
import type { TableRenderNode } from "./table-render-node";
import type { InlineRenderNode } from "./inline-render-node";
import type { TextRenderNode } from "./text-render-node";

export { type RenderStyles } from "./render-styles";
export {
  type BlockRenderNode,
  createBlockNode,
} from "./block-render-node";
export {
  type TableRenderNode,
  createTableNode,
} from "./table-render-node";
export {
  type InlineRenderNode,
  createInlineNode,
} from "./inline-render-node";
export {
  type TextRenderNode,
  createTextRenderNode,
} from "./text-render-node";

/** Discriminated union of all render node types. */
export type RenderNode = BlockRenderNode | TableRenderNode | InlineRenderNode | TextRenderNode;

/** The fixed set of render node display types. */
export type RenderNodeType = RenderNode["type"];
