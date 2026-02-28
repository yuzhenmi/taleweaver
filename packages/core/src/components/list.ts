import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/render-node";

export const listComponent: ComponentDefinition = {
  type: "list",
  render: (node, children) => {
    return createBlockNode(node.id, {
      paddingLeft: 24,
      marginTop: 0,
      marginBottom: 0,
    }, children);
  },
};
