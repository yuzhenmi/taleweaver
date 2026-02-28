import type { ComponentDefinition } from "./component-definition";
import { createBlockNode } from "../render/render-node";

const HEADING_SIZES: Record<number, number> = {
  1: 32,
  2: 24,
  3: 20,
  4: 16,
  5: 14,
  6: 12,
};

export const headingComponent: ComponentDefinition = {
  type: "heading",
  render: (node, children) => {
    const level = typeof node.properties.level === "number"
      ? node.properties.level
      : 1;
    const fontSize = HEADING_SIZES[level] ?? 16;
    return createBlockNode(node.id, {
      fontSize,
      fontWeight: "bold",
      marginTop: 0,
      marginBottom: 0,
    }, children);
  },
};
