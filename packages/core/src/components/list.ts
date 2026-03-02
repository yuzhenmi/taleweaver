import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/render-node";

export const listComponent: ComponentDefinition = {
  type: "list",
  render: (node, children) => {
    const listType = node.properties.listType as string;
    const markedChildren = children.map((child, index) => {
      if (child.type !== "block") return child;
      const marker = listType === "ordered" ? `${index + 1}.` : "\u2022";
      return createBlockNode(
        child.key,
        { ...child.styles, paddingLeft: 24 },
        child.children,
        marker,
      );
    });
    return createBlockNode(node.id, {
      marginTop: 0,
      marginBottom: 0,
    }, markedChildren);
  },
};
