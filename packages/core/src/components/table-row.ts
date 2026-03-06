import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/block-render-node";

export const tableRowComponent: ComponentDefinition = {
  type: "table-row",
  render: (node, children) =>
    createBlockNode(node.id, { lineMarginTop: 0, lineMarginBottom: 0 }, children),
};
