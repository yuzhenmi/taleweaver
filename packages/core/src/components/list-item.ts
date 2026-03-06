import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/render-node";

export const listItemComponent: ComponentDefinition = {
  type: "list-item",
  render: (node, children) => {
    return createBlockNode(node.id, {
      lineMarginTop: 0,
      lineMarginBottom: 0,
    }, children);
  },
};
