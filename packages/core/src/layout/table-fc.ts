import type { ElementBox } from "../render/render-node-v2";
import type { TableBox, TableRowBox, TableCellBox } from "./layout-box-v2";
import { createTableBox, createTableRowBox, createTableCellBox } from "./layout-box-v2";
import type { TextShaper } from "./text-shaper";
import { layoutBlock } from "./bfc";
import type { WritingMode, Direction } from "../styles/writing-mode";
import { computeUsedStyle } from "./used-style";

/**
 * Lay out a `display: table` element with fixed percentage column widths.
 * - Reads metadata.columnWidths (array of fractions summing to ~1.0).
 * - Single-pass: each cell gets the column width derived from the table's content width.
 * - Row height = max(cell content heights, explicit row height from style.height).
 */
export function layoutTable(
  node: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  availableInlineSize: number,
  shaper: TextShaper,
  writingMode: WritingMode = "horizontal-tb",
  direction: Direction = "ltr",
): TableBox {
  if (!node.computedStyle) throw new Error("cascade required");
  const cs = node.computedStyle;

  const meta = node.metadata as { columnWidths?: readonly number[] } | undefined;
  const columnWidths = meta?.columnWidths;
  if (!columnWidths || columnWidths.length === 0) {
    throw new Error("Table requires metadata.columnWidths (array of fractions)");
  }

  const tableUsedStyle = computeUsedStyle(cs, availableInlineSize);

  const tableInlineSize = availableInlineSize;
  const columnPxWidths = columnWidths.map((f) => f * tableInlineSize);

  let rowBlockOffset = 0;
  const rowBoxes: TableRowBox[] = [];

  for (const rowNode of node.children) {
    if (rowNode.type !== "element") continue;
    if (!rowNode.computedStyle) throw new Error("cascade required");
    if (rowNode.computedStyle.display !== "table-row") continue;
    const rowCs = rowNode.computedStyle;
    const rowUsedStyle = computeUsedStyle(rowCs, tableInlineSize);

    const cells = rowNode.children.filter(
      (c): c is ElementBox =>
        c.type === "element" && c.computedStyle?.display === "table-cell",
    );

    let maxBlockSize = 0;
    let cellInlineOffset = 0;
    const cellBoxes: TableCellBox[] = [];

    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci];
      if (!cell.computedStyle) throw new Error("cascade required");
      const cellCs = cell.computedStyle;
      const cellUsedStyle = computeUsedStyle(cellCs, tableInlineSize);
      const cellInlineSize = ci < columnPxWidths.length ? columnPxWidths[ci] : 0;

      // Lay out cell interior as BFC at cellInlineSize.
      const interior = layoutBlock(cell, 0, 0, cellInlineSize, shaper, cs.writingMode, cs.direction);

      const cellBlockSize = interior.height;
      maxBlockSize = Math.max(maxBlockSize, cellBlockSize);

      const interiorChildren = Array.from(interior.children);

      const cellBox = createTableCellBox(
        cell.key, cellInlineOffset, 0, cellInlineSize, cellBlockSize,
        cs.writingMode, cs.direction,
        cellCs, cellUsedStyle,
        interiorChildren,
        /* containingInlineSize */ tableInlineSize,
      );
      cellBoxes.push(cellBox);
      cellInlineOffset += cellInlineSize;
    }

    // Resolve row block-size: explicit or auto.
    const explicitBlockSize =
      typeof rowNode.computedStyle.blockSize === "number" ? rowNode.computedStyle.blockSize : null;
    const rowBlockSize = explicitBlockSize !== null ? Math.max(maxBlockSize, explicitBlockSize) : maxBlockSize;

    // Stretch each cell to the row's resolved block-size.
    const stretchedCells = cellBoxes.map((cb) =>
      cb.height === rowBlockSize
        ? cb
        : createTableCellBox(
            cb.key,
            cb.inlineOffset,
            cb.blockOffset,
            cb.inlineSize,
            rowBlockSize,
            cs.writingMode, cs.direction,
            cb.computedStyle,
            cb.usedStyle,
            Array.from(cb.children),
            /* containingInlineSize */ tableInlineSize,
          ),
    );

    rowBoxes.push(createTableRowBox(
      rowNode.key, 0, rowBlockOffset, tableInlineSize, rowBlockSize,
      cs.writingMode, cs.direction,
      rowCs, rowUsedStyle,
      stretchedCells,
      /* containingInlineSize */ tableInlineSize,
    ));
    rowBlockOffset += rowBlockSize;
  }

  const tableBlockSize = rowBlockOffset;

  return createTableBox(
    node.key, inlineOffset, blockOffset, tableInlineSize, tableBlockSize,
    writingMode, direction,
    cs, tableUsedStyle,
    rowBoxes, columnPxWidths,
    /* containingInlineSize */ availableInlineSize,
  );
}
