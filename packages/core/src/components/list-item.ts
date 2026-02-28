import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/render-node";

export const listItemComponent: ComponentDefinition = {
  type: "list-item",
  render: (node, children) => {
    return createBlockNode(node.id, {
      marginTop: 0,
      marginBottom: 0,
    }, children);
  },
};
