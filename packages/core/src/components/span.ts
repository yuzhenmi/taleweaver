import type { ComponentDefinition } from "./component-definition";
import { createInlineNode } from "../render/render-node";
import { pickInlineStyles } from "./pick-inline-styles";

export const spanComponent: ComponentDefinition = {
  type: "span",
  render: (node, children) =>
    createInlineNode(node.id, pickInlineStyles(node.properties), children),
};
