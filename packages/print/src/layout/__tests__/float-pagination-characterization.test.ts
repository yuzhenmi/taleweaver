// Characterization of LEGACY float + pagination behavior (the `paginateRoot`
// path, which `paginatedHarness` routes float docs through).
//
// ✅ PINS THE CORRECT COHERENT BEHAVIOR (coherent-float-pagination design R3,
// 2026-06-14): a float's text-exclusion (line narrowing) applies to the lines
// beside/below it on the page where it ACTUALLY SITS — across page boundaries —
// instead of being displaced ~1 page. The fix expresses every float-env offset
// in the document-cumulative flow frame at both placement and query, so a float
// whose flow position is page N narrows page N (not page N+1).
//
// These assertions are the regression guard for that coherence: a float on a
// late page narrows that page's beside-it lines; a float straddling a boundary
// narrows the lines around it on BOTH pages; a float never narrows an earlier
// page it does not touch.
import { describe, it, expect } from "vitest";
import { paginatedHarness } from "../../test-utils/paginated-harness";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { RenderNode } from "@taleweaver/core";
import type { LayoutBox } from "../layout-box";
import type { Style } from "@taleweaver/core";
import type { PageConfig } from "../page-config";

const PAGE: PageConfig = {
  pageInlineSize: 600,
  pageBlockSize: 80, // 5 lines/page @ the mock shaper's 16px line-height
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

interface LineGeom {
  readonly x: number;
  readonly w: number;
}

function collectLines(box: LayoutBox, out: LineGeom[]): void {
  if (box.type === "line") {
    out.push({ x: box.x, w: (box as unknown as { inlineSize?: number }).inlineSize ?? -1 });
    return;
  }
  if ("children" in box) {
    for (const c of box.children as readonly LayoutBox[]) collectLines(c, out);
  }
}

/** Per-page line geometry for a doc. `pageLines[p][i]` = line i on page p. */
function pageLineGeom(children: RenderNode[]): LineGeom[][] {
  const root = createElementBox("root", { display: "block" } as Style, children);
  const { pages } = paginatedHarness(root, PAGE);
  return pages.map((p) => {
    const out: LineGeom[] = [];
    collectLines(p, out);
    return out;
  });
}

function para(id: string, n: number): RenderNode {
  return createElementBox(id, { display: "block", whiteSpace: "pre" } as Style, [
    createTextBox(`${id}-t`, { whiteSpace: "pre" }, Array.from({ length: n }, (_, i) => `${id}${i}`).join("\n")),
  ]);
}
function leftFloat(id: string, w: number, h: number): RenderNode {
  return createElementBox(
    id,
    { display: "block", float: "inline-start", inlineSize: w, blockSize: h } as Style,
    [],
  );
}

// A left float of inline-size 200 narrows the lines beside it to x=200, w=400;
// unaffected lines are x=0, w=600. We assert the FIRST line of the page where
// narrowing appears, which is the discriminating signal for the displacement bug.
const NARROW = { x: 200, w: 400 };
const FULL = { x: 0, w: 600 };

describe("legacy float + pagination — characterization (coherent cumulative frame)", () => {
  it("CORRECT: float wholly on page 0 narrows page-0 lines beside it", () => {
    const g = pageLineGeom([leftFloat("f", 200, 40), para("p", 12)]);
    // float [0,40] → page-0 lines 0,1,2 narrowed; later pages full. This case is
    // correct (float on page 0, where page-relative == cumulative).
    expect(g[0]?.[0]).toEqual(NARROW);
    expect(g[0]?.[3]).toEqual(FULL);
    expect(g[1]?.[0]).toEqual(FULL);
    expect(g[2]?.[0]).toEqual(FULL);
  });

  it("FIXED: float whose flow position is page 1 narrows page 1 beside it", () => {
    const g = pageLineGeom([para("a", 5), leftFloat("f", 200, 40), para("b", 10)]);
    expect(g[0]?.[0]).toEqual(FULL);   // page 0 = para a
    // float at cumulative [80,120]; para-b lines 0,1 (cumul 80,96) beside it on page 1.
    expect(g[1]?.[0]).toEqual(NARROW);
    expect(g[1]?.[1]).toEqual(NARROW);
    expect(g[1]?.[3]).toEqual(FULL);   // below the float
    expect(g[2]?.[0]).toEqual(FULL);   // page 2 untouched
  });

  it("FIXED: float on page 2 narrows page 2 (not page 3)", () => {
    const g = pageLineGeom([para("a", 10), leftFloat("f", 200, 40), para("b", 10)]);
    expect(g[0]?.[0]).toEqual(FULL);
    expect(g[1]?.[0]).toEqual(FULL);
    expect(g[2]?.[0]).toEqual(NARROW);   // float sits here now
    expect(g[2]?.[1]).toEqual(NARROW);
  });

  it("FIXED: float crossing the page-0/1 boundary narrows around it (not displaced)", () => {
    const g = pageLineGeom([para("a", 4), leftFloat("f", 200, 40), para("b", 10)]);
    // float flow [64,104]. para a fills page 0 (4 lines, cumul 0–64); the float box
    // is placed at page-relative 64 and OVERFLOWS page 0 (it spans to 104 > the 80
    // page) — too-tall-float overflow (#2, separate from this fix), so para b starts
    // on page 1. Crucially the float-env QUERY is cumulative, so para b's lines on
    // page 1 narrow AROUND the float's TRUE cumulative position: line 0 (cumul 64),
    // line 1 (80), line 2 (96) ∈ [64,104] → narrowed; line 3 (112) onward full. The
    // narrowing tracks the float's real flow position (NOT displaced ~1 page).
    expect(g[0]?.[0]).toEqual(FULL); // page 0 = para a (4 lines), all full
    expect(g[1]?.[0]).toEqual(NARROW);
    expect(g[1]?.[1]).toEqual(NARROW);
    expect(g[1]?.[2]).toEqual(NARROW);
    expect(g[1]?.[3]).toEqual(FULL);
    expect(g[2]?.[0]).toEqual(FULL); // page 2 untouched
  });
});
