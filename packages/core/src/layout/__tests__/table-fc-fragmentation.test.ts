// packages/core/src/layout/__tests__/table-fc-fragmentation.test.ts
import { describe, it, expect } from "vitest";
import type { FragmentationContext } from "../fragmentation";
import { layoutTable } from "../table-fc";
import { makeRootContext } from "../layout-context";
import { INITIAL_COMPUTED_STYLE } from "../../styles";
import { createMockShaper } from "../mock-shaper";
import { cascadePass } from "../../cascade";
import { createElementBox, createTextBox } from "../../render/render-node";
import type { ElementBox } from "../../render/render-node";
import { asBlockId } from "../../state";

/** Build a simple table with N body rows, fixed row height via blockSize style. */
function buildSimpleTable(numBodyRows: number, rowHeight: number = 30): ElementBox {
  const rows = Array.from({ length: numBodyRows }, (_, i) =>
    createElementBox(`row-${i}`, { display: "table-row", blockSize: rowHeight }, [
      createElementBox(`cell-${i}-0`, { display: "table-cell" }, [
        createTextBox(`t-${i}`, {}, "x"),
      ]),
    ]),
  );
  const table = createElementBox("table", { display: "table" }, rows);
  const cascaded = cascadePass(table);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

describe("Table FC fragmentation — row-level split", () => {
  it("places all rows when table fits", () => {
    const table = buildSimpleTable(3, 30);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 200, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutTable(table, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(breakToken).toBeNull();
    // Verify some rows present:
    expect(box!.children.length).toBeGreaterThan(0);
  });

  it("stops at the row that overflows; returns TableBreakToken", () => {
    const table = buildSimpleTable(5, 30); // 5 rows × 30 = 150
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 90, // fits 3 rows (3 × 30 = 90)
      pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutTable(table, 0, 0, ctx, shaper, fragmentation);
    expect(box).not.toBeNull();
    expect(breakToken).toEqual({ type: "table", resumeAtRow: 3 });
  });

  it("returns box: null + TableBreakToken at row 0 when even the first row doesn't fit", () => {
    const table = buildSimpleTable(5, 100);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const fragmentation: FragmentationContext = {
      availableBlockSize: 50, pageIndex: 0, resumeFrom: null,
    };
    const { box, breakToken } = layoutTable(table, 0, 0, ctx, shaper, fragmentation);
    expect(box).toBeNull();
    expect(breakToken).toEqual({ type: "table", resumeAtRow: 0 });
  });
});

// ---------------------------------------------------------------------------
// E.3 — Resume from TableBreakToken
// ---------------------------------------------------------------------------

describe("Table FC fragmentation — resume from TableBreakToken", () => {
  it("skips body rows 0..resumeAtRow-1 when resuming", () => {
    const table = buildSimpleTable(8, 30);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const r1 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 120, pageIndex: 0, resumeFrom: null,
    });
    expect(r1.breakToken).toEqual({ type: "table", resumeAtRow: 4 });
    const r2 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 200, pageIndex: 1, resumeFrom: r1.breakToken,
    });
    expect(r2.box).not.toBeNull();
    expect(r2.breakToken).toBeNull();
    // Verify body rows 4..7 placed (4 rows × 30 = 120 total).
    expect(r2.box!.children.length).toBe(4);
    expect(r2.box!.blockSize).toBe(120);
    // tables-audit F1: the resumed fragment's `occupancy` describes ONLY the rows
    // on THIS fragment (4, not the whole 8-row grid), and every slot resolves in
    // this fragment's `cellBoxById` — never a cell box that lives on page 1.
    expect(r2.box!.occupancy.length).toBe(4);
    for (const row of r2.box!.occupancy) {
      for (const cellId of row) {
        if (cellId !== null) expect(r2.box!.cellBoxById.has(cellId)).toBe(true);
      }
    }
  });

  it("throws when given a non-Table top-level resumeFrom token", () => {
    const table = buildSimpleTable(3, 30);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    expect(() =>
      layoutTable(table, 0, 0, ctx, shaper, {
        availableBlockSize: 100, pageIndex: 0,
        resumeFrom: { type: "ifc", resumeAtLine: 0 },
      }),
    ).toThrow(/expected.*TableBreakToken/i);
  });
});

// ---------------------------------------------------------------------------
// S5.T3 — rowSpan cell straddling a page break (emit spanningCells)
// ---------------------------------------------------------------------------

/**
 * 2-col table whose col-0 cell A spans both body rows and has a 2-block (2-line)
 * interior; col-1 has a 1-line cell per row.  cols are 50/50 via columnWidths.
 *
 *   ┌─────────────┬──────┐
 *   │ A (rowSpan2 │  B   │ row0
 *   │  2 blocks)  ├──────┤
 *   │             │  C   │ row1
 *   └─────────────┴──────┘
 */
function blockLine(key: string): ElementBox {
  return createElementBox(key, { display: "block" }, [createTextBox(`${key}-t`, {}, "x")]);
}

/** col-0 cell A spans both rows; `aLines` block children give A its interior height. */
function buildRowSpanTable(aLines: readonly string[], cLines: readonly string[]): ElementBox {
  const cellA = createElementBox(
    "cellA",
    { display: "table-cell" },
    aLines.map(blockLine),
    { rowSpan: 2 },
  );
  const cellB = createElementBox("cellB", { display: "table-cell" }, [blockLine("b0")]);
  const cellC = createElementBox("cellC", { display: "table-cell" }, cLines.map(blockLine));
  const row0 = createElementBox("row-0", { display: "table-row" }, [cellA, cellB]);
  const row1 = createElementBox("row-1", { display: "table-row" }, [cellC]);
  // Force 50/50 columns so intrinsic sizing doesn't affect the geometry. Pass the
  // metadata through createElementBox so the result is a properly frozen ElementBox.
  const table = createElementBox(
    "table",
    { display: "table" },
    [row0, row1],
    { columnWidths: [0.5, 0.5] },
  );
  const cascaded = cascadePass(table);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

describe("Table FC fragmentation — rowSpan cell crossing the break (S5)", () => {
  it("fragments the spanning cell's interior and emits a spanningCells continuation", () => {
    // A's interior is 2 blocks (32 tall); B and C are single-line (16). With
    // rowHeights [16,16], A's content SPILLS past the break → non-null interior token.
    const table = buildRowSpanTable(["a0", "a1"], ["c0"]);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    // rowHeights = [16, 16] (B and C are single-line; A's 32-tall interior is
    // covered by the two 16 rows so §17.5.3 adds no deficit). availableBlockSize
    // 20 fits row0 (16) but not row0+row1 (32) → break after row0, INSIDE A's span.
    const { box, breakToken } = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 20, pageIndex: 0, resumeFrom: null,
    });

    expect(box).not.toBeNull();
    expect(breakToken).not.toBeNull();
    if (breakToken === null || breakToken.type !== "table") {
      throw new Error("expected a TableBreakToken");
    }
    expect(breakToken.resumeAtRow).toBe(1);

    // A straddles the break: its origin (row 0) is placed but its span reaches
    // row 1, which resumes next page.
    const spanning = breakToken.spanningCells ?? [];
    expect(spanning.length).toBe(1);
    const cont = spanning[0];
    expect(cont.cellId).toBe("cellA");
    expect(cont.gridRow).toBe(0);
    expect(cont.gridCol).toBe(0);
    expect(cont.rowSpan).toBe(2);
    expect(cont.colSpan).toBe(1);
    // Its interior split: the second block resumes next page.
    expect(cont.interiorBreakToken).not.toBeNull();

    // A's placed box is trimmed to the placed portion (one row tall = 16), NOT
    // the full merged 32 that would overflow the page.
    if (box === null) throw new Error("expected a table box");
    // tables-audit F1: the page-1 partial fragment's occupancy describes ONLY the
    // placed row (1, not the whole 2-row grid); every slot resolves in cellBoxById
    // (row-1's own cell C is trimmed away and must NOT be referenced here).
    expect(box.occupancy.length).toBe(1);
    for (const row of box.occupancy) {
      for (const cellId of row) {
        if (cellId !== null) expect(box.cellBoxById.has(cellId)).toBe(true);
      }
    }
    const placedRow0 = box.children[0];
    if (placedRow0.type !== "table-row") throw new Error("expected a table-row");
    const placedA = placedRow0.children.find((c) => c.key === "cellA");
    if (placedA === undefined || placedA.type !== "table-cell") {
      throw new Error("cell A not found in placed row");
    }
    expect(placedA.blockSize).toBe(16);
    // The placed fragment carries only the first block.
    expect(placedA.children.length).toBe(1);
  });

  it("emits a null-interior continuation when the cell's content fits but its box still spans the break (empty tail)", () => {
    // A's interior is a single line (16) — it fits entirely within row 0. But A
    // spans rows 0–1 and row 1 is 32 tall (cellC has 2 blocks), so A's MERGED box
    // (16 + 32 = 48) still extends past a break taken after row 0. The cell must
    // be trimmed AND a continuation emitted (so resume keeps col 0 occupied),
    // with interiorBreakToken === null because there is no remaining content.
    const table = buildRowSpanTable(["a0"], ["c0", "c1"]);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    // rowHeights = [16, 32]; availableBlockSize 20 fits row0 (16) but not
    // row0+row1 (48) → break after row0, inside A's span.
    const { box, breakToken } = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 20, pageIndex: 0, resumeFrom: null,
    });

    if (breakToken === null || breakToken.type !== "table") {
      throw new Error("expected a TableBreakToken");
    }
    expect(breakToken.resumeAtRow).toBe(1);

    const spanning = breakToken.spanningCells ?? [];
    expect(spanning.length).toBe(1);
    const cont = spanning[0];
    expect(cont.cellId).toBe("cellA");
    expect(cont.rowSpan).toBe(2);
    // Content fit in the placed row → no remaining interior to lay out.
    expect(cont.interiorBreakToken).toBeNull();

    // A's box is still trimmed to the placed portion (16), not the merged 48.
    if (box === null) throw new Error("expected a table box");
    const placedRow0 = box.children[0];
    if (placedRow0.type !== "table-row") throw new Error("expected a table-row");
    const placedA = placedRow0.children.find((c) => c.key === "cellA");
    if (placedA === undefined || placedA.type !== "table-cell") {
      throw new Error("cell A not found in placed row");
    }
    expect(placedA.blockSize).toBe(16);
    // The whole interior fit, so the trimmed cell carries its one block.
    expect(placedA.children.length).toBe(1);
  });
});

/** 2-col, 3-row table: col-0 cell A spans all three rows (3 blocks); B/C/D are the
 *  single-line col-1 cells of rows 0/1/2. cols 50/50. */
function buildRowSpan3Table(): ElementBox {
  const cellA = createElementBox(
    "cellA",
    { display: "table-cell" },
    [blockLine("a0"), blockLine("a1"), blockLine("a2")],
    { rowSpan: 3 },
  );
  const cellB = createElementBox("cellB", { display: "table-cell" }, [blockLine("b0")]);
  const cellC = createElementBox("cellC", { display: "table-cell" }, [blockLine("c0")]);
  const cellD = createElementBox("cellD", { display: "table-cell" }, [blockLine("d0")]);
  const row0 = createElementBox("row-0", { display: "table-row" }, [cellA, cellB]);
  const row1 = createElementBox("row-1", { display: "table-row" }, [cellC]);
  const row2 = createElementBox("row-2", { display: "table-row" }, [cellD]);
  const table = createElementBox(
    "table",
    { display: "table" },
    [row0, row1, row2],
    { columnWidths: [0.5, 0.5] },
  );
  const cascaded = cascadePass(table);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

describe("Table FC fragmentation — resume of a rowSpan cell (S5.T4)", () => {
  it("lays the still-spanning cell's remainder on the resume page, beside the post-break row's own cell", () => {
    const table = buildRowSpanTable(["a0", "a1"], ["c0"]);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);

    const p1 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 20, pageIndex: 0, resumeFrom: null,
    });
    if (p1.breakToken === null || p1.breakToken.type !== "table") {
      throw new Error("expected a TableBreakToken on page 1");
    }
    expect(p1.breakToken.resumeAtRow).toBe(1);

    const p2 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 200, pageIndex: 1, resumeFrom: p1.breakToken,
    });
    expect(p2.breakToken).toBeNull();
    if (p2.box === null) throw new Error("expected a box on page 2");

    // Just row 1 on the resume page.
    expect(p2.box.children.length).toBe(1);
    const row1 = p2.box.children[0];
    if (row1.type !== "table-row") throw new Error("expected a table-row");

    const a = row1.children.find((c) => c.key === "cellA");
    const c = row1.children.find((c) => c.key === "cellC");
    if (a === undefined || a.type !== "table-cell") throw new Error("A missing on resume");
    if (c === undefined || c.type !== "table-cell") throw new Error("C missing on resume");
    // A resumes in col 0, C in col 1 (assignTableGrid routed C around A's column).
    expect(a.inlineOffset).toBe(0);
    expect(c.inlineOffset).toBe(300);
    // A carries ONLY its second block (the resumed remainder), spanning row 1 (16).
    expect(a.children.length).toBe(1);
    expect(a.blockSize).toBe(16);
  });

  it("re-breaks a rowSpan-3 cell across three pages (continuation chains)", () => {
    const table = buildRowSpan3Table();
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);

    // Page 1: fits row 0 only → A (rowSpan 3) straddles.
    const p1 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 20, pageIndex: 0, resumeFrom: null,
    });
    if (p1.breakToken === null || p1.breakToken.type !== "table") throw new Error("p1 token");
    expect(p1.breakToken.resumeAtRow).toBe(1);
    expect((p1.breakToken.spanningCells ?? []).length).toBe(1);

    // Page 2: resume, fits row 1 only → A still straddles (re-break), resumes at row 2.
    const p2 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 20, pageIndex: 1, resumeFrom: p1.breakToken,
    });
    if (p2.breakToken === null || p2.breakToken.type !== "table") throw new Error("p2 token");
    expect(p2.breakToken.resumeAtRow).toBe(2);
    const p2Span = p2.breakToken.spanningCells ?? [];
    expect(p2Span.length).toBe(1);
    expect(p2Span[0].cellId).toBe("cellA");
    // CRITICAL chain invariant: the re-emitted continuation must carry A's ORIGINAL
    // origin (row 0, span 3), NOT the clamped placement (row 1, span 2) — page 3's
    // preamble looks A's element up in rows[gridRow] and computes end = gridRow+rowSpan.
    expect(p2Span[0].gridRow).toBe(0);
    expect(p2Span[0].rowSpan).toBe(3);
    expect(p2Span[0].interiorBreakToken).not.toBeNull();
    // A's middle fragment on page 2 is trimmed to one row (16) carrying its 2nd block.
    if (p2.box === null) throw new Error("p2 box");
    const p2Row = p2.box.children[0];
    if (p2Row.type !== "table-row") throw new Error("p2 row");
    const p2A = p2Row.children.find((c) => c.key === "cellA");
    if (p2A === undefined || p2A.type !== "table-cell") throw new Error("p2 A");
    expect(p2A.blockSize).toBe(16);
    expect(p2A.children.length).toBe(1);

    // Page 3: resume, fits the rest → A's last block lands, no further break.
    const p3 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 200, pageIndex: 2, resumeFrom: p2.breakToken,
    });
    expect(p3.breakToken).toBeNull();
    if (p3.box === null) throw new Error("p3 box");
    const p3Row = p3.box.children[0];
    if (p3Row.type !== "table-row") throw new Error("p3 row");
    const p3A = p3Row.children.find((c) => c.key === "cellA");
    const p3D = p3Row.children.find((c) => c.key === "cellD");
    if (p3A === undefined || p3A.type !== "table-cell") throw new Error("p3 A");
    if (p3D === undefined || p3D.type !== "table-cell") throw new Error("p3 D");
    expect(p3A.children.length).toBe(1); // the final block a2
    expect(p3A.inlineOffset).toBe(0);
    expect(p3D.inlineOffset).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// #487 — repeating header rows across page fragments (S4 materialize side)
// ---------------------------------------------------------------------------

/**
 * Build a single-column table with `numRows` rows of fixed height, each cell
 * carrying distinct text "rN" (so a re-laid header row is identifiable by its
 * content), and stamp `headerRowCount` onto the table box metadata (the path
 * the `table` component uses in production).
 */
function buildHeaderTable(numRows: number, headerRowCount: number, rowHeight = 30): ElementBox {
  const rows = Array.from({ length: numRows }, (_, i) =>
    createElementBox(`row-${i}`, { display: "table-row", blockSize: rowHeight }, [
      createElementBox(`cell-${i}-0`, { display: "table-cell" }, [
        createTextBox(`t-${i}`, {}, `r${i}`),
      ]),
    ]),
  );
  const table = createElementBox("table", { display: "table" }, rows, { headerRowCount });
  const cascaded = cascadePass(table);
  if (cascaded.type !== "element") throw new Error("cascadePass returned non-element");
  return cascaded;
}

describe("Table FC fragmentation — repeating header rows (#487)", () => {
  it("re-lays the header row at the top of a continuation fragment + correct body rows", () => {
    // 6 rows × 30, headerRowCount 1. Page 1 fits header(0)+body 1,2 (90). Page 2
    // resumes at body row 3: it MUST re-emit header row 0 at the top, then body
    // rows 3,4,5.
    const table = buildHeaderTable(6, 1, 30);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);

    const p1 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 90, pageIndex: 0, resumeFrom: null,
    });
    // Page 1 places header(0) + body 1,2 = 3 rows; break at body row 3.
    expect(p1.breakToken).toEqual({ type: "table", resumeAtRow: 3 });
    if (p1.box === null) throw new Error("p1 box");
    expect(p1.box.children.map((r) => r.key)).toEqual(["row-0", "row-1", "row-2"]);

    // Page 2: resume at body row 3 with a header reservation.
    const p2 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 200, pageIndex: 1, resumeFrom: p1.breakToken,
    });
    expect(p2.breakToken).toBeNull(); // all remaining rows fit
    if (p2.box === null) throw new Error("p2 box");
    // The emitted rows on the continuation: re-laid header row-0 FIRST, then the
    // resumed body rows 3,4,5 (rows 1,2 stay on page 1 — NOT re-emitted).
    expect(p2.box.children.map((r) => r.key)).toEqual([
      "row-0", "row-3", "row-4", "row-5",
    ]);

    // The re-laid header sits at block-offset 0; the first body row starts at
    // headerBlockSize (30).
    const headerRow = p2.box.children[0];
    const firstBodyRow = p2.box.children[1];
    if (headerRow.type !== "table-row" || firstBodyRow.type !== "table-row") {
      throw new Error("expected table rows");
    }
    expect(headerRow.blockOffset).toBe(0);
    expect(headerRow.blockSize).toBe(30);
    expect(firstBodyRow.blockOffset).toBe(30);

    // The re-laid header cell carries the HEADER row's content ("r0"), proving it
    // is a fresh copy of row 0 (not a body row) — a distinct box instance at this
    // fragment's offset.
    const headerCell = headerRow.children.find((c) => c.key === "cell-0-0");
    if (headerCell === undefined || headerCell.type !== "table-cell") {
      throw new Error("re-laid header cell not found");
    }

    // GATE B (measure↔materialize): the continuation fragment's TOTAL block-size
    // equals headerBlockSize (30) + Σ placed body rows (3 rows × 30 = 90) = 120 —
    // exactly what the measure pass reserves (headerBlockSize + placed). No drift.
    expect(p2.box.blockSize).toBe(120);

    // Fragment-local occupancy describes exactly the 4 emitted rows; every slot
    // resolves in THIS fragment's cellBoxById (tables-audit F1).
    expect(p2.box.occupancy.length).toBe(4);
    for (const row of p2.box.occupancy) {
      for (const cellId of row) {
        if (cellId !== null) expect(p2.box.cellBoxById.has(cellId)).toBe(true);
      }
    }
    // The re-laid header cell box (a fresh box instance on THIS fragment) is the
    // one registered in the fragment's cellBoxById — so selection/paint/caret over
    // the repeated header resolve to it, not to page 1's header box.
    expect(p2.box.cellBoxById.get(asBlockId("cell-0-0"))).toBe(headerCell);
  });

  it("a continuation that itself fragments re-emits the header on EACH page", () => {
    // 7 rows × 30, headerRowCount 1. Page 2 (resume at row 3) with availableBlockSize
    // 90: header(30) reserved ⇒ body budget 60 ⇒ rows 3,4 fit, break at row 5. The
    // header is re-emitted again; body rows admitted = exactly the measure reservation.
    const table = buildHeaderTable(7, 1, 30);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);

    const p2 = layoutTable(table, 0, 0, ctx, shaper, {
      availableBlockSize: 90, pageIndex: 1,
      resumeFrom: { type: "table", resumeAtRow: 3 },
    });
    expect(p2.breakToken).toEqual({ type: "table", resumeAtRow: 5 });
    if (p2.box === null) throw new Error("p2 box");
    expect(p2.box.children.map((r) => r.key)).toEqual(["row-0", "row-3", "row-4"]);
    // header 30 + body rows 3,4 (60) = 90 — fills the page exactly, matching the
    // measure reservation (headerBlockSize + Σ placed).
    expect(p2.box.blockSize).toBe(90);
  });

  it("PROGRESS: header + next body row overflow still places exactly one body row", () => {
    // 3 rows: header 30 + two 100-tall body rows. Resume at body row 1 with
    // availableBlockSize 110: header(30) reserved ⇒ body budget 80 < 100 ⇒ zero fit
    // ⇒ PROGRESS forces ONE body row (overflowing). resumeAtRow strictly advances
    // to 2 — no hang. The materialize side mirrors the measure-side force-place.
    const rows = [
      createElementBox("row-0", { display: "table-row", blockSize: 30 }, [
        createElementBox("cell-0-0", { display: "table-cell" }, [createTextBox("t0", {}, "h")]),
      ]),
      createElementBox("row-1", { display: "table-row", blockSize: 100 }, [
        createElementBox("cell-1-0", { display: "table-cell" }, [createTextBox("t1", {}, "a")]),
      ]),
      createElementBox("row-2", { display: "table-row", blockSize: 100 }, [
        createElementBox("cell-2-0", { display: "table-cell" }, [createTextBox("t2", {}, "b")]),
      ]),
    ];
    const tableEl = createElementBox("table", { display: "table" }, rows, { headerRowCount: 1 });
    const cascaded = cascadePass(tableEl);
    if (cascaded.type !== "element") throw new Error("cascade");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);

    const p = layoutTable(cascaded, 0, 0, ctx, shaper, {
      availableBlockSize: 110, pageIndex: 1,
      resumeFrom: { type: "table", resumeAtRow: 1 },
    });
    expect(p.breakToken).toEqual({ type: "table", resumeAtRow: 2 });
    if (p.box === null) throw new Error("progress box");
    // header row-0 + forced body row-1.
    expect(p.box.children.map((r) => r.key)).toEqual(["row-0", "row-1"]);
    // header 30 + forced row 100 = 130 (overflows the 110 page — accepted).
    expect(p.box.blockSize).toBe(130);
  });

  it("first fragment (startBodyRow 0) does NOT repeat the header — byte-identical to no-header", () => {
    // On the FIRST fragment, header rows are ordinary leading rows: no reservation,
    // no duplication. A 6-row headerRowCount=1 table on page 1 places rows 0,1,2
    // exactly like a plain table.
    const withHeader = buildHeaderTable(6, 1, 30);
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 600);
    const shaper = createMockShaper(8, 16);
    const p1 = layoutTable(withHeader, 0, 0, ctx, shaper, {
      availableBlockSize: 90, pageIndex: 0, resumeFrom: null,
    });
    if (p1.box === null) throw new Error("p1 box");
    expect(p1.box.children.map((r) => r.key)).toEqual(["row-0", "row-1", "row-2"]);
    expect(p1.box.blockSize).toBe(90);
    expect(p1.breakToken).toEqual({ type: "table", resumeAtRow: 3 });
  });
});
