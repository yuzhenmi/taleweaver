import type { ComponentDefinition } from "./component-definition";
import { createGridNode } from "../render/grid-render-node";

export const tableComponent: ComponentDefinition = {
  type: "table",
  render: (node, children) => {
    const columnWidths = Array.isArray(node.properties.columnWidths)
      ? (node.properties.columnWidths as number[])
      : [];
    const rowHeights = Array.isArray(node.properties.rowHeights)
      ? (node.properties.rowHeights as number[])
      : [];
    return createGridNode(
      node.id,
      { marginTop: 0, marginBottom: 0 },
      children,
      columnWidths,
      rowHeights,
    );
  },
};
