import type { RenderNode, ElementBox } from "../render/render-node-v2";
import type { ComputedStyle } from "../styles";
import type { TableBox, TableRowBox, TableCellBox } from "./layout-box-v2";
import { createTableBox, createTableRowBox, createTableCellBox } from "./layout-box-v2";
import type { TextShaper } from "./text-shaper";
import { layoutBlock } from "./bfc";
import { computeUsedStyle } from "./used-style";
import type { LayoutContext } from "./layout-context";
import { makeChildContext } from "./layout-context";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";
import { anonymousBlockKey } from "./group-children";
import { markStart, markEnd } from "../perf/perf-trace";
import type { FragmentationContext, LayoutResult } from "./fragmentation";

// ---------------------------------------------------------------------------
// Anonymous-box grouping helpers
// ---------------------------------------------------------------------------

interface TableRowGroup {
  readonly key: string;
  readonly cells: readonly RenderNode[];
  readonly cs: Readonly<ComputedStyle>;
  readonly isAnonymous: boolean;
}

/**
 * Walk the direct children of a `display:table` element and produce a list of
 * row groups.  Bare `display:table-cell` children (and any other non-row
 * content) are collected into anonymous row groups using
 * `anonymousBlockKey(table.key, positionalIndex)`.
 */
function groupTableRows(table: ElementBox): readonly TableRowGroup[] {
  if (!table.computedStyle) throw new Error("cascade required");
  const tableCs = table.computedStyle;
  const out: TableRowGroup[] = [];
  let pendingCells: RenderNode[] | null = null;

  for (const child of table.children) {
    if (
      child.type === "element" &&
      child.computedStyle?.display === "table-row"
    ) {
      // Flush any pending bare cells into an anonymous row first.
      if (pendingCells) {
        out.push({
          key: anonymousBlockKey(table.key, out.length),
          cells: pendingCells,
          cs: tableCs,
          isAnonymous: true,
        });
        pendingCells = null;
      }
      if (!child.computedStyle) throw new Error("cascade required");
      out.push({
        key: child.key,
        cells: child.children,
        cs: child.computedStyle,
        isAnonymous: false,
      });
    } else {
      // Bare cell or other content: accumulate into a pending anonymous row.
      if (!pendingCells) pendingCells = [];
      pendingCells.push(child);
    }
  }

  // Flush trailing pending cells.
  if (pendingCells) {
    out.push({
      key: anonymousBlockKey(table.key, out.length),
      cells: pendingCells,
      cs: tableCs,
      isAnonymous: true,
    });
  }

  return out;
}

interface CellGroup {
  readonly key: string;
  readonly content: readonly RenderNode[];
  readonly cs: Readonly<ComputedStyle>;
  readonly isAnonymous: boolean;
}

/**
 * Walk the children of a row group and produce a list of cell groups.
 * Non-`table-cell` content (blocks, inlines, text) is collected into
 * anonymous cell groups using `anonymousBlockKey(rowKey, positionalIndex)`.
 */
function groupRowCells(row: TableRowGroup): readonly CellGroup[] {
  const out: CellGroup[] = [];
  let pendingContent: RenderNode[] | null = null;

  for (const child of row.cells) {
    if (
      child.type === "element" &&
      child.computedStyle?.display === "table-cell"
    ) {
      // Flush any pending non-cell content into an anonymous cell first.
      if (pendingContent) {
        out.push({
          key: anonymousBlockKey(row.key, out.length),
          content: pendingContent,
          cs: row.cs,
          isAnonymous: true,
        });
        pendingContent = null;
      }
      if (!child.computedStyle) throw new Error("cascade required");
      out.push({
        key: child.key,
        content: [child],
        cs: child.computedStyle,
        isAnonymous: false,
      });
    } else {
      // Non-cell content: accumulate into a pending anonymous cell.
      if (!pendingContent) pendingContent = [];
      pendingContent.push(child);
    }
  }

  // Flush trailing pending content.
  if (pendingContent) {
    out.push({
      key: anonymousBlockKey(row.key, out.length),
      content: pendingContent,
      cs: row.cs,
      isAnonymous: true,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Intrinsic-size pre-pass (auto-layout column widths)
// ---------------------------------------------------------------------------

/**
 * Walk the table tree using the same grouping logic as the layout pass so that
 * intrinsic sizes are computed for the same column structure that layout will
 * produce (including anonymous rows/cells).
 */
function collectIntrinsicSizes(
  table: ElementBox,
  shaper: TextShaper,
  intrinsicCache: LayoutContext["intrinsicCache"],
): { colMins: number[]; colMaxes: number[] } {
  const colMins: number[] = [];
  const colMaxes: number[] = [];

  const rows = groupTableRows(table);
  for (const row of rows) {
    const cellGroups = groupRowCells(row);
    let colIdx = 0;
    for (const cg of cellGroups) {
      // For a real (non-anonymous) cell, cg.content is [cellElement].
      // For an anonymous cell, we need a synthetic ElementBox to measure.
      let cellEl: ElementBox;
      if (!cg.isAnonymous) {
        const el = cg.content[0];
        if (el.type !== "element") { colIdx++; continue; }
        cellEl = el;
      } else {
        // Build a minimal synthetic ElementBox for intrinsic measurement.
        cellEl = {
          type: "element",
          key: cg.key,
          style: {},
          computedStyle: { ...cg.cs, display: "table-cell" },
          children: cg.content,
        };
      }
      const sizes = computeIntrinsicSizes(cellEl, shaper, intrinsicCache);
      colMins[colIdx] = Math.max(colMins[colIdx] ?? 0, sizes.minContent);
      colMaxes[colIdx] = Math.max(colMaxes[colIdx] ?? 0, sizes.maxContent);
      colIdx++;
    }
  }

  return { colMins, colMaxes };
}

// ---------------------------------------------------------------------------
// Main layout entry point
// ---------------------------------------------------------------------------

/**
 * Lay out a `display: table` element with fixed percentage column widths.
 * - Reads metadata.columnWidths (array of fractions summing to ~1.0).
 * - Single-pass: each cell gets the column width derived from the table's content width.
 * - Row height = max(cell content heights, explicit row height from style.height).
 * - Bare `table-cell` direct children of the table are wrapped in anonymous rows.
 * - Non-`table-cell` content inside a row is wrapped in anonymous cells.
 */
export function layoutTable(
  node: ElementBox,
  inlineOffset: number,
  blockOffset: number,
  ctx: LayoutContext,
  shaper: TextShaper,
  fragmentation?: FragmentationContext,
): LayoutResult<TableBox> {
  const t = markStart("table.layout");
  try {
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
    const { colMins, colMaxes } = collectIntrinsicSizes(node, shaper, ctx.intrinsicCache);

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

  // ---------------------------------------------------------------------------
  // Layout pass — walk grouped rows and cells.
  // ---------------------------------------------------------------------------

  let rowBlockOffset = 0;
  const rowBoxes: TableRowBox[] = [];

  const rows = groupTableRows(node);
  for (const row of rows) {
    const rowUsedStyle = computeUsedStyle(row.cs, tableInlineSize, "indefinite");

    const cellGroups = groupRowCells(row);

    let maxBlockSize = 0;
    let cellInlineOffset = 0;
    const cellBoxes: TableCellBox[] = [];

    for (let ci = 0; ci < cellGroups.length; ci++) {
      const cg = cellGroups[ci];
      const cellCs = cg.cs;
      const cellUsedStyle = computeUsedStyle(cellCs, tableInlineSize, "indefinite");
      const cellInlineSize = ci < columnPxWidths.length ? columnPxWidths[ci] : 0;

      // Build a synthetic ElementBox for anonymous cells so `layoutBlock` has
      // something to recurse into.
      let cellEl: ElementBox;
      if (!cg.isAnonymous) {
        const el = cg.content[0];
        if (el.type !== "element") {
          cellInlineOffset += cellInlineSize;
          continue;
        }
        cellEl = el;
      } else {
        cellEl = {
          type: "element",
          key: cg.key,
          style: {},
          computedStyle: { ...cellCs, display: "table-cell" },
          children: cg.content,
        };
      }

      // Lay out cell interior as BFC at cellInlineSize.
      const cellCtx = makeChildContext(ctx, cs, cellInlineSize, "indefinite");
      const interiorResult = layoutBlock(cellEl, 0, 0, cellCtx, shaper);
      if (interiorResult.box === null) {
        throw new Error("layoutBlock recursive call returned null box; should be unreachable in B.1 (fragmentation not yet wired)");
      }
      const interior = interiorResult.box;
      if (interior.type !== "block") {
        throw new Error("layoutBlock returned non-block box for table cell; unexpected");
      }

      const cellBlockSize = interior.height;
      maxBlockSize = Math.max(maxBlockSize, cellBlockSize);

      const interiorChildren = Array.from(interior.children);

      const cellBox = createTableCellBox(
        cg.key, cellInlineOffset, 0, cellInlineSize, cellBlockSize,
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
      typeof row.cs.blockSize === "number" ? row.cs.blockSize : null;
    const rowBlockSize =
      explicitBlockSize !== null ? Math.max(maxBlockSize, explicitBlockSize) : maxBlockSize;

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
      row.key, 0, rowBlockOffset, tableInlineSize, rowBlockSize,
      cs.writingMode, cs.direction,
      row.cs, rowUsedStyle,
      stretchedCells,
      /* containingInlineSize */ tableInlineSize,
    ));
    rowBlockOffset += rowBlockSize;
  }

  const tableBlockSize = rowBlockOffset;

  return { box: createTableBox(
    node.key, inlineOffset, blockOffset, tableInlineSize, tableBlockSize,
    writingMode, direction,
    cs, tableUsedStyle,
    rowBoxes, columnPxWidths,
    /* containingInlineSize */ availableInlineSize,
  ), breakToken: null };
  } finally {
    markEnd("table.layout", t);
  }
}
