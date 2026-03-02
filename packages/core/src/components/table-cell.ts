import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/block-render-node";

export const tableCellComponent: ComponentDefinition = {
  type: "table-cell",
  render: (node, children) =>
    createBlockNode(node.id, {
      paddingTop: 4,
      paddingBottom: 4,
      paddingLeft: 4,
      paddingRight: 4,
    }, children),
};
