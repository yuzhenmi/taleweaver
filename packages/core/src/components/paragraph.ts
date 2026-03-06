import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/render-node";

export const paragraphComponent: ComponentDefinition = {
  type: "paragraph",
  render: (node, children) =>
    createBlockNode(node.id, { lineMarginTop: 0, lineMarginBottom: 0.2 }, children),
};
