import type { RenderNode, ElementBox } from "@taleweaver/core";
import type { ComputedStyle } from "@taleweaver/core";
import type { BlockId } from "@taleweaver/core";
import { asBlockId } from "@taleweaver/core";
import type { TableBox, TableRowBox, TableCellBox, LayoutBox } from "./layout-box";
import { createTableBox, createTableRowBox, createTableCellBox } from "./layout-box";
import { assignTableGrid } from "./table-grid";
import type { GridCellInput, AssignedCell } from "./table-grid";
import { distributeColumnIntrinsics } from "./table-column-sizing";
import type { SpannedCellIntrinsic } from "./table-column-sizing";
import { isDevMode } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { Hyphenator } from "@taleweaver/core";
import { layoutBlock } from "./bfc";
import { computeUsedStyle } from "./used-style";
import type { LayoutContext } from "./layout-context";
import { makeChildContext } from "./layout-context";
import { computeIntrinsicSizes } from "./intrinsic-sizes-pass";
import { anonymousBlockKey } from "./group-children";
import { markStart, markEnd } from "@taleweaver/core";
import type { FragmentationContext, LayoutResult, SpanningCellContinuation, BreakToken } from "./fragmentation";

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
        // A real cell's content is `[cellElement]`; an empty/non-element slot
        // yields no measurable cell (mirrors `materializeCellElement`).
        const el = cg.content[0];
        if (el === undefined || el.type !== "element") {
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
// Per-cell layout result, grouped by starting row (Pass A output). Module-scope
// so the S5 fragmentation logic — and the future S5.T4 resume pass, which also
// consumes `laidByRow` — can reference it.
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
  /** The cell's source element — kept so a rowSpan cell straddling a page break
   *  can re-lay its interior under a FragmentationContext (S5.T3). */
  readonly cellEl: ElementBox;
  /** For a cell synthesized by the S5.T4 resume preamble (a still-spanning cell
   *  whose origin is on an earlier fragment): the break token its interior should
   *  resume from when E.1 re-fragments it. `undefined`/`null` for fresh cells (laid
   *  whole in Pass A) ⇒ E.1 re-lays from the start. */
  readonly resumeInteriorToken?: BreakToken | null;
  /** For a resumed cell: its ORIGINAL grid origin + full span (the synthesized
   *  `placement` is CLAMPED to this fragment for positioning). E.1 emits the
   *  continuation from this — so `gridRow` keeps pointing at the cell's true origin
   *  row (where its element lives, for the next resume's element lookup) and
   *  `gridRow + rowSpan` keeps pointing at the true end. Absent for fresh cells,
   *  whose `placement` already IS the origin. */
  readonly spanOrigin?: { readonly gridRow: number; readonly rowSpan: number };
}

/**
 * Resolve a cell group to the ElementBox `layoutBlock` recurses into: the real
 * cell element for a non-anonymous group, or a synthetic `table-cell` wrapper for
 * an anonymous one. Returns null when a non-anonymous group's content isn't an
 * element (no box; the grid slot stays empty). Shared by Pass A and the S5.T4
 * resume preamble so both build the cell the same way.
 */
function materializeCellElement(cg: CellGroup): ElementBox | null {
  if (!cg.isAnonymous) {
    const el = cg.content[0];
    return el !== undefined && el.type === "element" ? el : null;
  }
  return {
    type: "element",
    key: cg.key,
    style: {},
    computedStyle: { ...cg.cs, display: "table-cell" },
    children: cg.content,
  };
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
  // Auto-hyphenation (slice 2): threaded ALONGSIDE `shaper` to the per-cell
  // `layoutBlock` calls. `undefined` ⇒ none. Carried but UNUSED in this slice.
  // (Cell intrinsic sizing — `collectIntrinsicSizes` — is hyphenation-independent,
  // like intrinsic-sizes-pass.ts, so it is NOT threaded the hyphenator.)
  hyphenator: Hyphenator | undefined,
  fragmentation?: FragmentationContext,
  // Coherent float+pagination: the page-cumulative flow base of this table's
  // page content top, forwarded to per-cell `layoutBlock` so cell paragraphs'
  // `paraFlowStart` is stamped in the same cumulative frame as the rest of the
  // page (matching bfc). Table+float is a documented v1 limitation; for non-float
  // table docs this only keeps the measure↔materialize `paraFlowStart` tokens
  // consistent. Defaults to 0 (unpaginated / single-page callers).
  pageFlowBase = 0,
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

  // #487 header-repetition: the first `headerRowCount` rows repeat at the top of
  // every CONTINUATION fragment (Google-Docs "pin header rows"). On the first
  // fragment (startBodyRow === 0) the header rows are ordinary leading rows — no
  // repetition. On a continuation, `repeatHeader` makes Pass A–D ALSO lay rows
  // `[0, headerRowCount)` at the top, before the resumed body rows. The clean-cut
  // invariant (S1) guarantees no cell straddles the `[0, headerRowCount)`
  // boundary, so the header band is an independent sub-grid. `headerRowCount === 0`
  // (the default) ⇒ `repeatHeader` false ⇒ byte-identical to the pre-header path.
  const rawHeaderRowCount = node.metadata?.headerRowCount ?? 0;
  const headerRowCount = Math.max(0, Math.min(rawHeaderRowCount, rows.length));
  const repeatHeader = startBodyRow > 0 && headerRowCount > 0;

  // The ORDERED list of GLOBAL row indices this fragment emits: the repeated
  // header `[0, headerRowCount)` (continuation only) followed by the resumed body
  // rows `[startBodyRow, rows.length)`. The two bands are non-contiguous in the
  // global grid (rows `[headerRowCount, startBodyRow)` live on earlier fragments);
  // every Pass that iterates emitted rows walks THIS list, and the fragment-local
  // grid maps local row `k → emittedRows[k]`. Without the header it is the plain
  // contiguous `[startBodyRow, rows.length)` — the pre-header behavior.
  const emittedRows: number[] = [];
  if (repeatHeader) {
    for (let r = 0; r < headerRowCount; r++) emittedRows.push(r);
  }
  for (let r = startBodyRow; r < rows.length; r++) emittedRows.push(r);

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
  // Grid info for the rows ACTUALLY emitted on this fragment, given an ordered
  // list of GLOBAL row indices (`emittedRows` — the repeated header band followed
  // by the resumed body band, possibly truncated at the break row). Fragment-local
  // row `k` maps to `grid.occupancy[globalRows[k]]`, so every slot resolves
  // against this fragment's `cellBoxById` (which holds only the cells actually
  // emitted on this fragment — re-laid header cells + placed body cells + clamped
  // rowSpan continuations) — a fragment must never reference a cell box that lives
  // on another page (tables-audit F1). The clean-cut invariant (#487 §3) keeps the
  // header and body bands independent sub-grids, so the re-index never points at an
  // absent gap row. A non-fragmented / first-fragment table (no header repeat,
  // contiguous `[startBodyRow, rows.length)`) keeps the whole-window occupancy
  // unchanged — byte-identical to the pre-header slice.
  const gridInfoFor = (
    globalRows: readonly number[],
  ): { occupancy: readonly (readonly (BlockId | null)[])[]; columnCount: number } => ({
    occupancy: globalRows.map((r) => grid.occupancy[r] ?? []),
    columnCount: grid.columnCount,
  });

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
  const laidByRow: LaidCell[][] = rows.map(() => []);

  // Walk the emitted rows (repeated header band + resumed body band) rather than
  // a single contiguous `[startBodyRow, rows.length)` slice, so a continuation
  // re-lays its header rows `[0, headerRowCount)` fresh at the same column widths.
  for (const rowIdx of emittedRows) {
    // `emittedRows` holds GLOBAL `rows` indices (the header band + body band),
    // so `rows[rowIdx]` is always present; throw is an unreachable guard.
    const row = rows[rowIdx];
    if (row === undefined) throw new Error(`table-fc: rows[${rowIdx}] missing (unreachable)`);
    const cellGroups = groupRowCells(row);
    // `cellGroups` is a dense array; iterate values to drop the index read.
    for (const [ci, cg] of cellGroups.entries()) {
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

      // Build the ElementBox `layoutBlock` recurses into (synthetic for anonymous
      // cells). Null ⇒ no box; the grid slot stays empty.
      const cellEl = materializeCellElement(cg);
      if (cellEl === null) continue;

      // Lay out cell interior as BFC at cellInlineSize.
      const cellCtx = makeChildContext(ctx, cs, cellInlineSize, "indefinite");
      const interiorResult = layoutBlock(cellEl, 0, 0, cellCtx, shaper, hyphenator, undefined, pageFlowBase);
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
        cellEl,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Resume preamble (S5.T4) — a rowSpan>1 cell whose origin is on an EARLIER
  // fragment doesn't appear in Pass A (which starts at startBodyRow), but its
  // merged box reaches into the rows resuming here. Column routing is already
  // correct (assignTableGrid runs over the whole table on every fragment, so the
  // post-break rows are assigned around the still-occupied columns); the only
  // missing piece is laying the cell's REMAINING interior on this fragment.
  // Synthesize a LaidCell clamped to [startBodyRow, gridRow+rowSpan) and feed it
  // into Pass B/C/D (and E.1 re-break) exactly like any spanning cell.
  // ---------------------------------------------------------------------------
  if (
    fragmentation !== undefined &&
    fragmentation.resumeFrom?.type === "table" &&
    fragmentation.resumeFrom.spanningCells !== undefined
  ) {
    for (const cont of fragmentation.resumeFrom.spanningCells) {
      const end = cont.gridRow + cont.rowSpan;
      const remainingSpan = end - startBodyRow;
      if (remainingSpan <= 0) continue; // already fully placed (defensive)

      // Resolve the originating cell's element + style by walking its origin row.
      const originRow = rows[cont.gridRow];
      if (originRow === undefined) continue;
      let originGroup: CellGroup | undefined;
      for (const g of groupRowCells(originRow)) {
        if (g.key === cont.cellId) { originGroup = g; break; }
      }
      if (originGroup === undefined) continue;
      const cellEl = materializeCellElement(originGroup);
      if (cellEl === null) continue;
      const cellCs = originGroup.cs;
      const cellUsedStyle = computeUsedStyle(cellCs, tableInlineSize, "indefinite");
      const inlineOffset = sumCols(0, cont.gridCol);
      const inlineSize = sumCols(cont.gridCol, cont.gridCol + cont.colSpan);

      // Lay the REMAINING interior at NATURAL height — a huge budget so nothing
      // breaks here; E.1 performs the real per-fragment split. An empty-tail
      // continuation (null token) contributes no interior.
      let interiorChildren: LayoutBox[] = [];
      let interiorHeight = 0;
      if (cont.interiorBreakToken !== null) {
        const cellCtx = makeChildContext(ctx, cs, inlineSize, "indefinite");
        const r = layoutBlock(cellEl, 0, 0, cellCtx, shaper, hyphenator, {
          availableBlockSize: Number.MAX_SAFE_INTEGER,
          pageIndex: fragmentation.pageIndex,
          resumeFrom: cont.interiorBreakToken,
        }, pageFlowBase);
        if (r.box !== null && r.box.type === "block") {
          interiorChildren = Array.from(r.box.children);
          interiorHeight = r.box.height;
        }
      }

      laidByRow[startBodyRow]?.push({
        key: cont.cellId,
        cellCs,
        cellUsedStyle,
        interiorChildren,
        interiorHeight,
        inlineOffset,
        inlineSize,
        placement: {
          cellId: cont.cellId,
          gridRow: startBodyRow, // clamped: the cell resumes at the top of this fragment
          gridCol: cont.gridCol,
          rowSpan: remainingSpan,
          colSpan: cont.colSpan,
        },
        cellEl,
        resumeInteriorToken: cont.interiorBreakToken,
        spanOrigin: { gridRow: cont.gridRow, rowSpan: cont.rowSpan },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Pass B — base row heights from cells that span exactly one row (max over
  // those cells, honoring an explicit row block-size).
  // ---------------------------------------------------------------------------
  const rowHeights: number[] = [];
  for (const r of emittedRows) {
    // `emittedRows` holds valid global `rows` indices; throw is unreachable.
    const row = rows[r];
    if (row === undefined) throw new Error(`table-fc: rows[${r}] missing (unreachable)`);
    const rowCs = row.cs;
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
  for (const r of emittedRows) {
    // `emittedRows` holds valid global `rows` indices; throw is unreachable.
    const row = rows[r];
    if (row === undefined) throw new Error(`table-fc: rows[${r}] missing (unreachable)`);
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
  //
  // #487 header-repetition: on a continuation (`repeatHeader`), `rowBoxes` starts
  // with the `headerRowCount` repeated-header rows (forced, always emitted), then
  // the resumed body rows. Those header rows are reserved at the top, so the body
  // rows fit into `availableBlockSize − headerBlockSize` — IDENTICAL to the measure
  // pass's `fitRowsInTable(remaining, …, headerBlockSize, forceProgress)` so the
  // page admits exactly the rows the measure pass reserved (the load-bearing §4
  // contract). PROGRESS (§6): if zero body rows fit, force exactly ONE so the table
  // always advances. When there is no header (`headerCount === 0`) this is
  // byte-identical to the pre-header fit.
  if (fragmentation !== undefined) {
    const headerCount = repeatHeader ? headerRowCount : 0;
    // The header rows are forced; sum their heights (the reservation the body fits
    // around). `rowBoxes[0..headerCount)` are exactly the emitted header rows.
    let headerUsed = 0;
    for (let i = 0; i < headerCount; i++) headerUsed += rowBoxes[i]?.blockSize ?? 0;

    // Greedily pack BODY rows (`rowBoxes[headerCount..]`) into the space remaining
    // after the header reservation.
    const bodyAvailable = fragmentation.availableBlockSize - headerUsed;
    let bodyUsed = 0;
    let placedBodyCount = 0;
    for (let i = headerCount; i < rowBoxes.length; i++) {
      const rb = rowBoxes[i];
      if (rb === undefined) break;
      if (bodyUsed + rb.blockSize > bodyAvailable) break;
      bodyUsed += rb.blockSize;
      placedBodyCount++;
    }

    const bodyRowTotal = rowBoxes.length - headerCount;

    if (placedBodyCount === 0) {
      // No body row fits. On a continuation with a header, PROGRESS forces exactly
      // ONE body row (overflowing) so the table always advances — mirroring the
      // measure pass's `forceProgress` floor. Without a header (first fragment),
      // preserve the pre-header behavior: signal the parent to push the table whole.
      if (repeatHeader && bodyRowTotal > 0) {
        placedBodyCount = 1;
        bodyUsed = rowBoxes[headerCount]?.blockSize ?? 0;
      } else {
        return {
          box: null,
          breakToken: { type: "table", resumeAtRow: startBodyRow },
          inFlowConsumed: 0,
        };
      }
    }

    const placedRowCount = headerCount + placedBodyCount;

    if (placedBodyCount < bodyRowTotal) {
      // Partial fit — emit the forced header rows + placed body rows only.
      const breakRow = startBodyRow + placedBodyCount;
      const partialBlockSize = headerUsed + bodyUsed;
      // The global row indices actually emitted on this fragment: the header band
      // `[0, headerCount)` (continuation only) followed by the placed body rows.
      const emittedGlobalRows = emittedRows.slice(0, placedRowCount);

      // P8.S5.T3 — fragment any rowSpan>1 cell that ORIGINATES in the placed rows
      // but whose merged rectangle reaches past the break. Its interior is re-laid
      // under a FragmentationContext sized to the placed portion, its box trimmed
      // to that height (so it doesn't overflow the trimmed page), and a
      // SpanningCellContinuation emitted so the next fragment knows the cell still
      // occupies its columns (and, when it has remaining content, where to resume).
      const continuations: SpanningCellContinuation[] = [];
      // start-row index → (cell key → trimmed cell box) for the rows we must rebuild.
      const trimmedByRow = new Map<number, Map<string, TableCellBox>>();
      for (let r = startBodyRow; r < breakRow; r++) {
        for (const lc of laidByRow[r] ?? []) {
          const start = lc.placement.gridRow;
          const end = start + lc.placement.rowSpan;
          if (end <= breakRow) continue; // span ends within the placed rows — not crossing

          // Placed portion height = sum of the spanned rows that are ON this page.
          // This is the cell's BORDER-BOX budget (rowHeights already include cell
          // padding/border — Pass A's unfragmented layoutBlock returns a
          // padding-inclusive height that drives them); layoutBlock subtracts its
          // own padding when fragmenting, so placedHeight is the correct budget.
          let placedHeight = 0;
          for (let rr = start; rr < breakRow; rr++) placedHeight += rowHeights[rr] ?? 0;

          // Re-lay the interior with a block-size budget = placedHeight. A non-null
          // breakToken means content spills to the next fragment; null means the
          // content fit but the box still spans past the break (empty tail).
          // resumeFrom: for a cell laid fresh in Pass A this is null (first
          // fragmentation — its content was laid whole). For a cell carried in by
          // the S5.T4 resume preamble, it is the incoming continuation's interior
          // token, so a rowSpan≥3 cell re-breaks from where it left off (the
          // continuation chain across >2 pages).
          const cellCtx = makeChildContext(ctx, cs, lc.inlineSize, "indefinite");
          const frag = layoutBlock(lc.cellEl, 0, 0, cellCtx, shaper, hyphenator, {
            availableBlockSize: placedHeight,
            pageIndex: fragmentation.pageIndex,
            resumeFrom: lc.resumeInteriorToken ?? null,
          }, pageFlowBase);
          const top = frag.box;
          const topChildren =
            top !== null && top.type === "block" ? Array.from(top.children) : [];

          const trimmed = createTableCellBox(
            lc.key, lc.inlineOffset, 0, lc.inlineSize, placedHeight,
            cs.writingMode, cs.direction,
            lc.cellCs, lc.cellUsedStyle,
            topChildren,
            {
              gridRow: lc.placement.gridRow,
              gridCol: lc.placement.gridCol,
              rowSpan: lc.placement.rowSpan,
              colSpan: lc.placement.colSpan,
            },
            /* containingInlineSize */ tableInlineSize,
          );
          let m = trimmedByRow.get(start);
          if (m === undefined) {
            m = new Map();
            trimmedByRow.set(start, m);
          }
          m.set(lc.key, trimmed);

          // Emit the cell's ORIGINAL origin/span (spanOrigin for a resumed cell;
          // the placement itself for a fresh one) so the continuation keeps
          // pointing at the cell's true origin row + end across the whole chain.
          continuations.push({
            cellId: asBlockId(lc.key),
            gridRow: lc.spanOrigin?.gridRow ?? lc.placement.gridRow,
            gridCol: lc.placement.gridCol,
            rowSpan: lc.spanOrigin?.rowSpan ?? lc.placement.rowSpan,
            colSpan: lc.placement.colSpan,
            interiorBreakToken: frag.breakToken,
          });
        }
      }

      // Rebuild the placed row boxes whose cells were trimmed (others pass through
      // unchanged, so 1×1 / non-crossing tables produce byte-identical output).
      let placedRows: readonly TableRowBox[] = rowBoxes.slice(0, placedRowCount);
      if (trimmedByRow.size > 0) {
        placedRows = placedRows.map((rb, i) => {
          // trimmedByRow is keyed by absolute grid row (lc.placement.gridRow);
          // placedRows[i] corresponds to the i-th emitted global row. With a
          // repeated header that is the header band then the body band, so map via
          // `emittedGlobalRows[i]` rather than `startBodyRow + i` (only the body
          // rows can straddle the break — the clean-cut invariant keeps the header
          // band span-free, so no header entry appears in `trimmedByRow`).
          const trims = trimmedByRow.get(emittedGlobalRows[i] ?? -1);
          if (trims === undefined) return rb;
          const newCells = rb.children.map((cellBox) =>
            cellBox.type === "table-cell" ? trims.get(cellBox.key) ?? cellBox : cellBox,
          );
          return createTableRowBox(
            rb.key, rb.inlineOffset, rb.blockOffset, rb.inlineSize, rb.blockSize,
            cs.writingMode, cs.direction,
            rb.computedStyle, rb.usedStyle,
            newCells,
            /* containingInlineSize */ tableInlineSize,
          );
        });
      }

      const breakToken =
        continuations.length > 0
          ? { type: "table" as const, resumeAtRow: breakRow, spanningCells: continuations }
          : { type: "table" as const, resumeAtRow: breakRow };

      return {
        box: createTableBox(
          node.key, inlineOffset, blockOffset, tableInlineSize, partialBlockSize,
          writingMode, direction,
          cs, tableUsedStyle,
          placedRows, columnPxWidths, gridInfoFor(emittedGlobalRows),
          /* containingInlineSize */ availableInlineSize,
        ),
        breakToken,
        inFlowConsumed: partialBlockSize,
      };
    }

    // All rows fit — fall through to the full-table return below.
  }

  const tableBlockSize = rowBlockOffset;

  return { box: createTableBox(
    node.key, inlineOffset, blockOffset, tableInlineSize, tableBlockSize,
    writingMode, direction,
    cs, tableUsedStyle,
    rowBoxes, columnPxWidths, gridInfoFor(emittedRows),
    /* containingInlineSize */ availableInlineSize,
  ), breakToken: null, inFlowConsumed: tableBlockSize };
  } finally {
    markEnd("table.layout", t);
  }
}
