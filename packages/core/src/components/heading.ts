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

const HEADING_LINE_HEIGHTS: Record<number, number> = {
  1: 40,
  2: 30,
  3: 25,
  4: 20,
  5: 18,
  6: 15,
};

export const headingComponent: ComponentDefinition = {
  type: "heading",
  render: (node, children) => {
    const level = typeof node.properties.level === "number"
      ? node.properties.level
      : 1;
    const fontSize = HEADING_SIZES[level] ?? 16;
    const lineHeight = HEADING_LINE_HEIGHTS[level] ?? Math.ceil(fontSize * 1.25);
    return createBlockNode(node.id, {
      fontSize,
      lineHeight,
      fontWeight: "bold",
      marginTop: 0,
      marginBottom: 0,
    }, children);
  },
};
