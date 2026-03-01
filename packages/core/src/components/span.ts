import type { ComponentDefinition } from "./component-definition";
import { createInlineNode } from "../render/render-node";

export const spanComponent: ComponentDefinition = {
  type: "span",
  render: (node, children) =>
    createInlineNode(node.id, { ...node.styles }, children),
};
