import type { RenderNode, ElementBox } from "../render/render-node";
import type { ComputedStyle } from "../styles";
import type { BlockId } from "../state";
import { asBlockId } from "../state";
import type { TableBox, TableRowBox, LayoutBox } from "./layout-box";
import { createTableBox, createTableRowBox, createTableCellBox } from "./layout-box";
import { assignTableGrid } from "./table-grid";
import type { GridCellInput, AssignedCell } from "./table-grid";
import { distributeColumnIntrinsics } from "./table-column-sizing";
import type { SpannedCellIntrinsic } from "./table-column-sizing";
import { isDevMode } from "./dev-mode";
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
    // `display: contents` inside a table is NOT supported (P1.C.1a scope is
    // block-level sections). The table FC does not flatten contents children, so
    // one wrapping table-rows would be mis-grouped as bare cells → silent-wrong
    // output. Fail loudly until a future piece handles it.
    if (child.type === "element" && child.computedStyle?.display === "contents") {
      throw new Error(
        "table-fc: display:contents inside a table is not supported yet " +
          "(group-children flatten is not applied in the table formatting context)",
      );
    }
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
  // Build the SAME grid the layout pass builds (assignTableGrid) so the column
  // structure intrinsic sizing assumes matches the one geometry will produce,
  // then feed each cell's intrinsic size — keyed by its grid placement — into
  // the §17.4 span-aware distributor (P8.S2). For a span-1-only table this
  // reduces to the legacy per-column max-over-cells (byte-identical pre-P8).
  const gridRows: GridCellInput[][] = [];
  const measures: { min: number; max: number }[] = []; // document order, 1:1 with grid cells

  for (const row of groupTableRows(table)) {
    const rowInputs: GridCellInput[] = [];
    for (const cg of groupRowCells(row)) {
      // For a real (non-anonymous) cell, cg.content is [cellElement] and carries
      // metadata (rowSpan/colSpan). For an anonymous cell we synthesize one to
      // measure; anonymous cells never span (no metadata).
      let cellEl: ElementBox | null;
      let metadata: ElementBox["metadata"];
      if (!cg.isAnonymous) {
        const el = cg.content[0];
        if (el.type !== "element") {
          cellEl = null;
          metadata = undefined;
        } else {
          cellEl = el;
          metadata = el.metadata;
        }
      } else {
        cellEl = {
          type: "element",
          key: cg.key,
          style: {},
          computedStyle: { ...cg.cs, display: "table-cell" },
          children: cg.content,
        };
        metadata = undefined;
      }
      rowInputs.push({ key: asBlockId(cg.key), metadata });
      if (cellEl === null) {
        measures.push({ min: 0, max: 0 });
      } else {
        const s = computeIntrinsicSizes(cellEl, shaper, intrinsicCache);
        measures.push({ min: s.minContent, max: s.maxContent });
      }
    }
    gridRows.push(rowInputs);
  }

  const grid = assignTableGrid(gridRows);
  const spanned: SpannedCellIntrinsic[] = grid.cells.map((ac, i) => ({
    gridCol: ac.gridCol,
    colSpan: ac.colSpan,
    min: measures[i]?.min ?? 0,
    max: measures[i]?.max ?? 0,
  }));
  return distributeColumnIntrinsics(spanned, grid.columnCount);
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

  const explicitColumnWidths = node.metadata?.columnWidths;

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

  // E.3: Determine which body row to start from when resuming.
  let startBodyRow = 0;
  if (fragmentation !== undefined && fragmentation.resumeFrom !== null) {
    if (fragmentation.resumeFrom.type !== "table") {
      throw new Error(
        `layoutTable: expected TableBreakToken at top-level resumeFrom, got ${fragmentation.resumeFrom.type}`,
      );
    }
    startBodyRow = fragmentation.resumeFrom.resumeAtRow;
  }

  let rowBlockOffset = 0;
  const rowBoxes: TableRowBox[] = [];

  const rows = groupTableRows(node);

  // P8 grid model: assign every cell its (gridRow, gridCol) + span over the WHOLE
  // table (independent of fragmentation trimming), and build the occupancy map.
  // For 1×1 cells each cell's gridCol === its per-row index, so S1 geometry is
  // unchanged — only the grid/occupancy metadata is now carried on the boxes.
  const gridInput: GridCellInput[][] = rows.map((r) =>
    groupRowCells(r).map((cg): GridCellInput => ({
      key: cg.key as BlockId,
      metadata:
        !cg.isAnonymous && cg.content[0]?.type === "element"
          ? cg.content[0].metadata
          : undefined,
    })),
  );
  const grid = assignTableGrid(gridInput);
  const placementByKey = new Map<string, AssignedCell>();
  for (const ac of grid.cells) placementByKey.set(ac.cellId, ac);
  const gridInfo = { occupancy: grid.occupancy, columnCount: grid.columnCount };

  /** Sum of column px-widths over `[from, to)` (P8: a cell's inline-offset is
   *  `sumCols(0, gridCol)`; its inline-size is `sumCols(gridCol, gridCol+colSpan)`). */
  const sumCols = (from: number, to: number): number => {
    let s = 0;
    for (let c = from; c < to; c++) s += columnPxWidths[c] ?? 0;
    return s;
  };
  // ---------------------------------------------------------------------------
  // Pass A — lay out every cell's interior at its summed inline-size; collect
  // the per-cell data grouped by its STARTING row (the HTML model: a rowSpan>1
  // cell belongs to its top row only). gridCol/colSpan come from the §17.5 grid
  // (S2), so inline geometry is already span-aware.
  // ---------------------------------------------------------------------------
  interface LaidCell {
    readonly key: string;
    readonly cellCs: Readonly<ComputedStyle>;
    readonly cellUsedStyle: ReturnType<typeof computeUsedStyle>;
    readonly interiorChildren: LayoutBox[];
    readonly interiorHeight: number;
    readonly inlineOffset: number;
    readonly inlineSize: number;
    readonly placement: AssignedCell;
  }
  const laidByRow: LaidCell[][] = rows.map(() => []);

  for (let rowIdx = startBodyRow; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const cellGroups = groupRowCells(row);
    for (let ci = 0; ci < cellGroups.length; ci++) {
      const cg = cellGroups[ci];
      const cellCs = cg.cs;
      const cellUsedStyle = computeUsedStyle(cellCs, tableInlineSize, "indefinite");

      const placement = placementByKey.get(cg.key) ?? {
        cellId: asBlockId(cg.key),
        gridRow: rowIdx,
        gridCol: ci,
        rowSpan: 1,
        colSpan: 1,
      };
      const cellInlineOffset = sumCols(0, placement.gridCol);
      const cellInlineSize = sumCols(placement.gridCol, placement.gridCol + placement.colSpan);

      // Build a synthetic ElementBox for anonymous cells so `layoutBlock` has
      // something to recurse into.
      let cellEl: ElementBox;
      if (!cg.isAnonymous) {
        const el = cg.content[0];
        if (el.type !== "element") continue; // no box; the grid slot stays empty
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
        throw new Error("layoutBlock without fragmentation returned null box; should be unreachable (no FragmentationContext passed)");
      }
      const interior = interiorResult.box;
      if (interior.type !== "block") {
        throw new Error("layoutBlock returned non-block box for table cell; unexpected");
      }

      laidByRow[rowIdx]?.push({
        key: cg.key,
        cellCs,
        cellUsedStyle,
        interiorChildren: Array.from(interior.children),
        interiorHeight: interior.height,
        inlineOffset: cellInlineOffset,
        inlineSize: cellInlineSize,
        placement,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Pass B — base row heights from cells that span exactly one row (max over
  // those cells, honoring an explicit row block-size).
  // ---------------------------------------------------------------------------
  const rowHeights: number[] = [];
  for (let r = startBodyRow; r < rows.length; r++) {
    const rowCs = rows[r].cs;
    // typeof narrows the stable binding (an indexed `rows[r].cs.blockSize` re-access
    // would NOT narrow); explicit block-size is the row's floor height.
    let h = typeof rowCs.blockSize === "number" ? rowCs.blockSize : 0;
    for (const lc of laidByRow[r] ?? []) {
      if (lc.placement.rowSpan === 1) h = Math.max(h, lc.interiorHeight);
    }
    rowHeights[r] = h;
  }

  // ---------------------------------------------------------------------------
  // Pass C — CSS Tables §17.5.3: for each rowSpan>1 cell whose interior is taller
  // than the rows it spans, distribute the deficit across those rows (proportional
  // to current height; equal when all equal/zero). Heights only ever grow, so this
  // converges monotonically; iterate until stable, bounded by the row count.
  // ---------------------------------------------------------------------------
  const spanningCells = laidByRow.flat().filter((lc) => lc.placement.rowSpan > 1);
  if (spanningCells.length > 0) {
    // Each spanning cell can drive a height increase at most once: heights only
    // grow, so once a cell's spanned rows cover its interior they always do (a
    // later cell sharing a row only grows it further). The fixpoint is therefore
    // reached within `spanningCells.length` passes; one more pass confirms no
    // further change. The cap is a runaway-bug backstop, not the normal exit
    // (the natural exit is `changed === false`), checked BEFORE each pass.
    const maxIterations = spanningCells.length + 1;
    let iterations = 0;
    let changed = true;
    while (changed) {
      if (iterations++ >= maxIterations) {
        if (isDevMode()) {
          throw new Error("layoutTable: rowSpan height distribution did not converge");
        }
        break;
      }
      changed = false; // natural fixpoint exit: a pass that grows nothing ends the loop
      for (const lc of spanningCells) {
        const r0 = lc.placement.gridRow;
        const r1 = r0 + lc.placement.rowSpan;
        let current = 0;
        for (let r = r0; r < r1; r++) current += rowHeights[r] ?? 0;
        const deficit = lc.interiorHeight - current;
        if (deficit <= 1e-9) continue;
        const weightSum = current;
        const span = r1 - r0;
        for (let r = r0; r < r1; r++) {
          const share =
            weightSum > 0 ? deficit * ((rowHeights[r] ?? 0) / weightSum) : deficit / span;
          rowHeights[r] = (rowHeights[r] ?? 0) + share;
        }
        changed = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Pass D — build row + cell boxes at cumulative offsets. Each cell's block-size
  // is the SUM of the rows it spans (rowSpan=1 ⇒ just its own row, byte-identical
  // to the pre-P8 stretch-to-row-height behavior).
  // ---------------------------------------------------------------------------
  for (let r = startBodyRow; r < rows.length; r++) {
    const row = rows[r];
    const rowUsedStyle = computeUsedStyle(row.cs, tableInlineSize, "indefinite");
    const rowBlockSize = rowHeights[r] ?? 0;

    const cellBoxes = (laidByRow[r] ?? []).map((lc) => {
      const start = lc.placement.gridRow;
      const end = start + lc.placement.rowSpan;
      let spannedBlockSize = 0;
      for (let rr = start; rr < end; rr++) spannedBlockSize += rowHeights[rr] ?? 0;
      return createTableCellBox(
        lc.key, lc.inlineOffset, 0, lc.inlineSize, spannedBlockSize,
        cs.writingMode, cs.direction,
        lc.cellCs, lc.cellUsedStyle,
        lc.interiorChildren,
        {
          gridRow: lc.placement.gridRow,
          gridCol: lc.placement.gridCol,
          rowSpan: lc.placement.rowSpan,
          colSpan: lc.placement.colSpan,
        },
        /* containingInlineSize */ tableInlineSize,
      );
    });

    rowBoxes.push(createTableRowBox(
      row.key, 0, rowBlockOffset, tableInlineSize, rowBlockSize,
      cs.writingMode, cs.direction,
      row.cs, rowUsedStyle,
      cellBoxes,
      /* containingInlineSize */ tableInlineSize,
    ));
    rowBlockOffset += rowBlockSize;
  }

  // E.1: Row-level fit-check.  When fragmenting, trim rowBoxes to those that
  // fit within availableBlockSize and return a TableBreakToken pointing to the
  // first row that didn't fit.
  if (fragmentation !== undefined) {
    let used = 0;
    let placedRowCount = 0;
    for (const rb of rowBoxes) {
      if (used + rb.blockSize > fragmentation.availableBlockSize) break;
      used += rb.blockSize;
      placedRowCount++;
    }

    if (placedRowCount === 0) {
      // Even the first row doesn't fit — signal the parent to push to next page.
      return {
        box: null,
        breakToken: { type: "table", resumeAtRow: startBodyRow },
      };
    }

    if (placedRowCount < rowBoxes.length) {
      // Partial fit — emit placed rows only.
      const placedRows = rowBoxes.slice(0, placedRowCount);
      const partialBlockSize = used;
      return {
        box: createTableBox(
          node.key, inlineOffset, blockOffset, tableInlineSize, partialBlockSize,
          writingMode, direction,
          cs, tableUsedStyle,
          placedRows, columnPxWidths, gridInfo,
          /* containingInlineSize */ availableInlineSize,
        ),
        breakToken: { type: "table", resumeAtRow: startBodyRow + placedRowCount },
      };
    }

    // All rows fit — fall through to the full-table return below.
  }

  const tableBlockSize = rowBlockOffset;

  return { box: createTableBox(
    node.key, inlineOffset, blockOffset, tableInlineSize, tableBlockSize,
    writingMode, direction,
    cs, tableUsedStyle,
    rowBoxes, columnPxWidths, gridInfo,
    /* containingInlineSize */ availableInlineSize,
  ), breakToken: null };
  } finally {
    markEnd("table.layout", t);
  }
}
