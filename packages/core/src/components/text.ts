import type { ComponentDefinition } from "./component-definition";
import { createTextRenderNode } from "../render/render-node";
import { getTextContent } from "../state/text-utils";

export const textComponent: ComponentDefinition = {
  type: "text",
  render: (node, _children) => {
    const content = getTextContent(node);
    return createTextRenderNode(node.id, content, { ...node.styles });
  },
};
