import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/render-node";

export const documentComponent: ComponentDefinition = {
  type: "document",
  render: (node, children) => createBlockNode(node.id, {}, children),
};
