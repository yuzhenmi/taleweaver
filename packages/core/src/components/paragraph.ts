import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/render-node";

export const paragraphComponent: ComponentDefinition = {
  type: "paragraph",
  render: (node, children) =>
    createBlockNode(node.id, { marginTop: 0, marginBottom: 0 }, children),
};
