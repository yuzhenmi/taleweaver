import type { ElementBox } from "../render/render-node-v2";
import type { TableBox, TableRowBox, TableCellBox } from "./layout-box-v2";
import { createTableBox, createTableRowBox, createTableCellBox } from "./layout-box-v2";
import type { TextMeasurer } from "./text-measurer";
import { layoutBlock } from "./bfc";

/**
 * Lay out a `display: table` element with fixed percentage column widths.
 * - Reads metadata.columnWidths (array of fractions summing to ~1.0).
 * - Single-pass: each cell gets the column width derived from the table's content width.
 * - Row height = max(cell content heights, explicit row height from style.height).
 */
export function layoutTable(
  node: ElementBox,
  x: number,
  y: number,
  availableWidth: number,
  measurer: TextMeasurer,
): TableBox {
  if (!node.computedStyle) throw new Error("cascade required");
  const cs = node.computedStyle;

  const meta = node.metadata as { columnWidths?: readonly number[] } | undefined;
  const columnWidths = meta?.columnWidths;
  if (!columnWidths || columnWidths.length === 0) {
    throw new Error("Table requires metadata.columnWidths (array of fractions)");
  }

  const tableContentWidth = availableWidth;
  const columnPxWidths = columnWidths.map((f) => f * tableContentWidth);

  let rowY = 0;
  const rowBoxes: TableRowBox[] = [];

  for (const rowNode of node.children) {
    if (rowNode.type !== "element") continue;
    if (!rowNode.computedStyle) throw new Error("cascade required");
    if (rowNode.computedStyle.display !== "table-row") continue;

    const cells = rowNode.children.filter(
      (c): c is ElementBox =>
        c.type === "element" && c.computedStyle?.display === "table-cell",
    );

    let maxHeight = 0;
    let cellX = 0;
    const cellBoxes: TableCellBox[] = [];

    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      if (!cell.computedStyle) throw new Error("cascade required");
      const cellWidth = ci < columnPxWidths.length ? columnPxWidths[ci] : 0;

      // Lay out cell interior as BFC at cellWidth.
      const interior = layoutBlock(cell, 0, 0, cellWidth, measurer);

      const cellHeight = interior.height;
      maxHeight = Math.max(maxHeight, cellHeight);

      const interiorChildren = Array.from(interior.children);

      const cellBox = createTableCellBox(
        cell.key, cellX, 0, cellWidth, cellHeight,
        cell.computedStyle,
        interiorChildren,
      );
      cellBoxes.push(cellBox);
      cellX += cellWidth;
    }

    // Resolve row height: explicit or auto.
    const explicitH =
      typeof rowNode.computedStyle.height === "number" ? rowNode.computedStyle.height : null;
    const rowHeight = explicitH !== null ? Math.max(maxHeight, explicitH) : maxHeight;

    // Stretch each cell to the row's resolved height.
    const stretchedCells = cellBoxes.map((cb) =>
      cb.height === rowHeight
        ? cb
        : createTableCellBox(
            cb.key,
            cb.x,
            cb.y,
            cb.width,
            rowHeight,
            cb.computedStyle,
            Array.from(cb.children),
          ),
    );

    rowBoxes.push(createTableRowBox(
      rowNode.key, 0, rowY, tableContentWidth, rowHeight,
      rowNode.computedStyle, stretchedCells,
    ));
    rowY += rowHeight;
  }

  return createTableBox(
    node.key, x, y, tableContentWidth, rowY,
    cs, rowBoxes, columnPxWidths,
  );
}
