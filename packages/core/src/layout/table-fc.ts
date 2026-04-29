import type { ElementBox } from "../render/render-node-v2";
import type { TableBox, TableRowBox, TableCellBox } from "./layout-box-v2";
import { createTableBox, createTableRowBox, createTableCellBox } from "./layout-box-v2";
import type { TextShaper } from "./text-shaper";
import { layoutBlock } from "./bfc";
import { computeUsedStyle } from "./used-style";
import type { LayoutContext } from "./layout-context";
import { makeChildContext } from "./layout-context";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";

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
  ctx: LayoutContext,
  shaper: TextShaper,
): TableBox {
  if (!node.computedStyle) throw new Error("cascade required");
  const cs = node.computedStyle;
  const availableInlineSize = ctx.containingInlineSize;
  const writingMode = ctx.writingMode;
  const direction = ctx.direction;

  const meta = node.metadata as { columnWidths?: readonly number[] } | undefined;
  const explicitColumnWidths = meta?.columnWidths;

  const tableUsedStyle = computeUsedStyle(cs, availableInlineSize, "indefinite");

  const tableInlineSize = availableInlineSize;

  let columnPxWidths: number[];

  if (explicitColumnWidths && explicitColumnWidths.length > 0) {
    // Fixed-percentage path: fractions summing to ~1.0.
    columnPxWidths = explicitColumnWidths.map((f) => f * tableInlineSize);
  } else {
    // Auto-layout: compute per-column min/max from per-cell intrinsic sizes,
    // then distribute the available inline space.
    const colMins: number[] = [];
    const colMaxes: number[] = [];
    const intrinsicCache = ctx.intrinsicCache;
    for (const rowNode of node.children) {
      if (rowNode.type !== "element") continue;
      if (rowNode.computedStyle?.display !== "table-row") continue;
      let colIdx = 0;
      for (const cell of rowNode.children) {
        if (cell.type !== "element") continue;
        if (cell.computedStyle?.display !== "table-cell") continue;
        const sizes = computeIntrinsicSizes(cell, shaper, intrinsicCache);
        colMins[colIdx] = Math.max(colMins[colIdx] ?? 0, sizes.minContent);
        colMaxes[colIdx] = Math.max(colMaxes[colIdx] ?? 0, sizes.maxContent);
        colIdx++;
      }
    }

    const sumMin = colMins.reduce((s, v) => s + v, 0);
    const sumMax = colMaxes.reduce((s, v) => s + v, 0);
    const available = tableInlineSize;

    if (sumMax <= available) {
      // Table fits comfortably — each column gets its max-content width.
      columnPxWidths = colMaxes;
    } else if (sumMin >= available) {
      // Table overflows even at minimums — each column gets its min-content width.
      columnPxWidths = colMins;
    } else {
      // Distribute proportionally between colMin and colMax.
      const slack = available - sumMin;
      const totalRange = sumMax - sumMin;
      columnPxWidths = colMins.map((min, i) => {
        const range = (colMaxes[i] ?? 0) - min;
        return min + (totalRange > 0 ? slack * (range / totalRange) : 0);
      });
    }
  }

  let rowBlockOffset = 0;
  const rowBoxes: TableRowBox[] = [];

  for (const rowNode of node.children) {
    if (rowNode.type !== "element") continue;
    if (!rowNode.computedStyle) throw new Error("cascade required");
    if (rowNode.computedStyle.display !== "table-row") continue;
    const rowCs = rowNode.computedStyle;
    const rowUsedStyle = computeUsedStyle(rowCs, tableInlineSize, "indefinite");

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
      const cellUsedStyle = computeUsedStyle(cellCs, tableInlineSize, "indefinite");
      const cellInlineSize = ci < columnPxWidths.length ? columnPxWidths[ci] : 0;

      // Lay out cell interior as BFC at cellInlineSize.
      const cellCtx = makeChildContext(ctx, cs, cellInlineSize, "indefinite");
      const interior = layoutBlock(cell, 0, 0, cellCtx, shaper);

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
