import type { ComponentDefinition } from "./component-definition";
import { createTableNode } from "../render/table-render-node";
import { createNode, createTextNode } from "../state/create-node";

export const tableComponent: ComponentDefinition = {
  type: "table",
  render: (node, children) => {
    const columnWidths = Array.isArray(node.properties.columnWidths)
      ? (node.properties.columnWidths as number[])
      : [];
    const rowHeights = Array.isArray(node.properties.rowHeights)
      ? (node.properties.rowHeights as number[])
      : [];
    return createTableNode(
      node.id,
      { lineMarginTop: 0, lineMarginBottom: 0 },
      children,
      columnWidths,
      rowHeights,
    );
  },
  createInitialState: (id, properties, allocateId) => {
    const rows = (properties.rows as number) ?? 1;
    const columns = (properties.columns as number) ?? 1;
    const columnWidths = properties.columnWidths as number[];

    const tableRows = [];
    for (let r = 0; r < rows; r++) {
      const cells = [];
      for (let c = 0; c < columns; c++) {
        const textNode = createTextNode(allocateId(), "");
        const para = createNode(allocateId(), "paragraph", {}, [textNode]);
        const cell = createNode(allocateId(), "table-cell", {}, [para]);
        cells.push(cell);
      }
      const row = createNode(allocateId(), "table-row", {}, cells);
      tableRows.push(row);
    }

    return createNode(id, "table", {
      columnWidths,
      rowHeights: Array.from({ length: rows }, () => 0),
    }, tableRows);
  },
};
