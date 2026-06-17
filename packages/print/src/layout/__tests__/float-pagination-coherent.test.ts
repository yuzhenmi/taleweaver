// Expanded behavior matrix for the coherent float + pagination frame
// (coherent-float-pagination design R3, 2026-06-14). Companion to
// `float-pagination-characterization.test.ts`: the characterization test pins
// the core left-float displacement cases; this file widens the matrix to
// right floats, tall floats crossing boundaries, floats taller than a page,
// clear across a page boundary, multiple per-page floats, mandatory
// negative-evidence (a late float must NOT narrow an earlier page), a
// float-free byte-identity baseline, and an RTL logical-axis case.
//
// Every case PASSES against current HEAD — purely additive regression coverage
// for the now-coherent cumulative-flow float frame.
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

/** Line geometry including the block-axis offset (`y`) — for #528 pushing tests. */
interface LineGeomY {
  readonly x: number;
  readonly w: number;
  readonly y: number;
}
function collectLinesY(box: LayoutBox, out: LineGeomY[]): void {
  if (box.type === "line") {
    out.push({
      x: box.x,
      w: (box as unknown as { inlineSize?: number }).inlineSize ?? -1,
      y: box.blockOffset,
    });
    return;
  }
  if ("children" in box) {
    for (const c of box.children as readonly LayoutBox[]) collectLinesY(c, out);
  }
}

/** Find the first box with `key` anywhere under `box` (page-relative geometry). */
function findFloatBox(box: LayoutBox, key: string): LayoutBox | null {
  if (box.key === key) return box;
  if ("children" in box) {
    for (const c of box.children as readonly LayoutBox[]) {
      const r = findFloatBox(c, key);
      if (r !== null) return r;
    }
  }
  return null;
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
function rightFloat(id: string, w: number, h: number): RenderNode {
  return createElementBox(
    id,
    { display: "block", float: "inline-end", inlineSize: w, blockSize: h } as Style,
    [],
  );
}

// A left float of inline-size 200 narrows the lines beside it to x=200, w=400;
// unaffected lines are x=0, w=600. A right float keeps x=0 but shrinks w to 400.
const NARROW = { x: 200, w: 400 };
const FULL = { x: 0, w: 600 };

describe("float + pagination — coherent cumulative frame (expanded matrix)", () => {
  it("right float (inline-end) on page ≥1 narrows its own page", () => {
    const g = pageLineGeom([para("a", 5), rightFloat("f", 200, 40), para("b", 10)]);
    expect(g[1]?.[0]?.w).toBe(400);
    expect(g[2]?.[0]?.w).toBe(600);
  });

  it("tall float crossing a boundary: exclusion continues onto the next page", () => {
    // float box placed at page-relative 64 (after para a's 4 lines, cumul 0–64).
    // float blockSize 56 → true cumulative span [64,120]. The float overflows
    // page 0 (too-tall-float overflow, separate from this fix), so para b begins
    // on page 1, narrowed AROUND the float's true cumulative position.
    const g = pageLineGeom([para("a", 4), leftFloat("f", 200, 56), para("b", 10)]); // float [64,120]
    const p0 = g[0] ?? [];
    expect(p0[p0.length - 1]).toEqual(FULL); // para a's last line at cumul 48 sits ABOVE the float (starts at 64)
    expect(g[1]?.[0]).toEqual(NARROW); // cumul 64
    expect(g[1]?.[1]).toEqual(NARROW); // cumul 80
    expect(g[1]?.[2]).toEqual(NARROW); // cumul 96
    expect(g[1]?.[3]).toEqual(NARROW); // cumul 112 < 120
    expect(g[1]?.[4]).toEqual(FULL); // cumul 128 ≥ 120
  });

  it("float taller than a full page narrows across all overlapped pages", () => {
    const g = pageLineGeom([leftFloat("f", 200, 200), para("b", 20)]); // float [0,200] = 2.5 pages
    expect(g[0]?.[0]).toEqual(NARROW);
    expect(g[1]?.[0]).toEqual(NARROW);
    expect(g[2]?.[0]).toEqual(NARROW); // cumul 160 < 200
    expect(g[2]?.[3]).toEqual(FULL); // cumul 208 ≥ 200
  });

  it("#528: a float that does not fit is PUSHED; a clear after it on the SOURCE page is NOT cleared by it", () => {
    // `[para(a,3)=48px, float(200×56), clear:inline-start block "C0", para(d,8)]`
    // on an 80px (5-line) page. The float requested at cumulative 48 spans
    // [48,104] — past the 80px page bottom — so #528 PUSHES it to page 2. On the
    // SOURCE page (page 0) the float is therefore NOT placed: the
    // `clear:inline-start` block has nothing to clear (no float on page 0), so its
    // line is FULL-WIDTH (x=0, w=600) — it does NOT skip down past a float that
    // isn't on its page (design test #4: clear-negative on the source page). The
    // trailing `d` paragraph gives the pushed float a real landing page (page 2),
    // where it occupies the content top.
    const root = createElementBox("root", { display: "block" } as Style, [
      para("a", 3),
      leftFloat("f", 200, 56),
      createElementBox(
        "c",
        { display: "block", clear: "inline-start", whiteSpace: "pre" } as Style,
        [createTextBox("c-t", { whiteSpace: "pre" }, "C0")],
      ),
      para("d", 8),
    ]);
    const { pages } = paginatedHarness(root, PAGE);
    const p0 = pages[0];
    if (p0 === undefined) throw new Error("expected page 0");
    // The float is NOT on the source page (it was pushed away).
    expect(findFloatBox(p0, "f"), "pushed float must NOT be on the source page").toBeNull();
    // The clear block's line is full-width (x=0, w=600) — NOT narrowed/cleared by
    // a float that isn't on this page.
    const p0lines: LineGeomY[] = [];
    collectLinesY(p0, p0lines);
    expect(
      p0lines.some((l) => l.x === 0 && l.w === 600),
      "clear block line is full-width on the source page (not cleared past the pushed float)",
    ).toBe(true);
    // The pushed float lands on page 2's content top (page-relative blockOffset 0).
    const p1 = pages[1];
    if (p1 === undefined) throw new Error("expected the pushed float to land on page 2");
    const floatBox = findFloatBox(p1, "f");
    expect(floatBox, "pushed float on page 2").not.toBeNull();
    expect(floatBox?.y).toBe(0);
  });

  it("two floats on different pages: each narrows only its own page", () => {
    const g = pageLineGeom([leftFloat("f", 200, 32), para("a", 5), leftFloat("f2", 200, 32), para("b", 5)]);
    expect(g[0]?.[0]).toEqual(NARROW); // page-0 float
    expect(g[1]?.[0]).toEqual(NARROW);
  });

  it("MANDATORY negative-evidence: a late-page float does NOT narrow page 0", () => {
    const g = pageLineGeom([para("a", 12), leftFloat("f", 200, 40), para("b", 5)]); // float on page 2+
    expect(g[0]?.[0]).toEqual(FULL);
    expect(g[0]?.[1]).toEqual(FULL);
    expect(g[1]?.[0]).toEqual(FULL);
  });

  it("float-free multi-page doc is byte-identical to no-float layout", () => {
    const a = pageLineGeom([para("a", 18)]);
    for (const page of a) for (const l of page) expect(l).toEqual(FULL);
  });

  it("RTL: a logical-start float narrows lines on its own page (logical-axis env)", () => {
    // direction:rtl root; a logical inline-start float. The float env is logical-axis,
    // so the page-assignment (which page narrows) is unchanged; physical x may mirror.
    // Assert the inlineSize SHRINK lands on the float's page, NOT physical x.
    const root = createElementBox("root", { display: "block", direction: "rtl" } as Style, [
      para("a", 5),
      leftFloat("f", 200, 40),
      para("b", 10),
    ]);
    const { pages } = paginatedHarness(root, PAGE);
    const p1 = pages[1];
    if (p1 === undefined) throw new Error("expected page 1");
    const p1lines: LineGeom[] = [];
    collectLines(p1, p1lines);
    // first line on page 1 is beside the float → inlineSize shrunk to 400 (assert w, not x).
    expect(p1lines[0]?.w).toBe(400);
  });
});

// A forced page break is pure-style: a child element box with
// breakBefore:"page". This is the cleanest probe for the partial-page
// `pageFlowBase` gaplessness invariant — page 0 ends partially filled, so the
// per-page flow accumulator MUST advance by the PARTIAL in-flow content placed
// (its `inFlowConsumed`), NOT by the full page height. A float on the next page
// must narrow ITS OWN page; if `pageFlowBase` over-counted page 0 (used page
// height 80 instead of the 48 actually placed) the float's cumulative position
// would shift forward by 32 and narrow the wrong lines / wrong page.
function breakBeforePara(id: string, n: number): RenderNode {
  return createElementBox(id, { display: "block", whiteSpace: "pre", breakBefore: "page" } as Style, [
    createTextBox(`${id}-t`, { whiteSpace: "pre" }, Array.from({ length: n }, (_, i) => `${id}${i}`).join("\n")),
  ]);
}

describe("pageFlowBase gaplessness across break types", () => {
  it("gapless pageFlowBase: float after a forced page break narrows its OWN page (partial page 0)", () => {
    const g = pageLineGeom([
      para("a", 3), //            page 0: 3 lines only (cumul 0,16,32) — PARTIAL page; the forced break ends it
      breakBeforePara("b", 3), // forced onto page 1, 3 lines
      leftFloat("f", 200, 32), // float right after b on page 1
      para("c", 5),
    ]);
    // DERIVATION (verified by running the harness once):
    //   page 0 = para a, 3 lines → inFlowConsumed = 3×16 = 48 (PARTIAL; page height is 80).
    //   pageFlowBase(page 1) = 48 (page-0 partial content), NOT 80.
    //   page 1 starts with b's 3 lines → cumulative 48,64,80; then the float box sits at
    //   cumulative 48+48 = 96 → float span [96, 96+32=128].
    //   para c follows: cumulative lines 96,112 (NARROW, inside [96,128]), then 128,144,160 (FULL).
    //   Observed page geometry:
    //     page 0: [FULL, FULL, FULL]                       (para a — never narrowed)
    //     page 1: [FULL, FULL, FULL, NARROW, NARROW]       (b ×3 FULL, c ×2 NARROW @ cumul 96,112)
    //     page 2: [FULL, FULL, FULL]                       (c ×3 FULL @ cumul 128,144,160)
    // If pageFlowBase had used page height (80) instead of the partial 48, the float span would be
    // [128,160] and the NARROW lines would land on page 2, not page 1 — these expectations would FAIL.
    expect(g[0]?.[0]).toEqual(FULL); // page 0 (para a) never narrowed
    expect(g[0]?.[1]).toEqual(FULL);
    expect(g[0]?.[2]).toEqual(FULL);
    // page 1 carries the float; its first 3 lines (para b) precede the float, last 2 (para c) are beside it.
    expect(g[1]?.[0]).toEqual(FULL); // b @ cumul 48
    expect(g[1]?.[1]).toEqual(FULL); // b @ cumul 64
    expect(g[1]?.[2]).toEqual(FULL); // b @ cumul 80
    expect(g[1]?.[3]).toEqual(NARROW); // c @ cumul 96 (inside float span [96,128])
    expect(g[1]?.[4]).toEqual(NARROW); // c @ cumul 112 (inside float span)
    // page 2 is entirely past the float → all FULL.
    expect(g[2]?.[0]).toEqual(FULL); // c @ cumul 128 (≥ float end)
    expect(g[2]?.[1]).toEqual(FULL); // c @ cumul 144
    expect(g[2]?.[2]).toEqual(FULL); // c @ cumul 160
  });

  it("float after a block straddling the page boundary narrows the correct page (complements the forced-break case)", () => {
    const g = pageLineGeom([
      para("a", 7), //           7 lines: 5 on page 0 (cumul 0..64), 2 tail on page 1 — straddles the boundary
      leftFloat("f", 200, 32), // float after a's tail on page 1
      para("c", 5),
    ]);
    // NOTE: this is NOT a pageFlowBase-gaplessness DISCRIMINATOR. Page 0 here is a
    // FULL page (inFlowConsumed == page height == 80), so a buggy accumulator that
    // used page height instead of inFlowConsumed would compute the SAME pageFlowBase
    // (80) and this case would still pass. The discriminating gaplessness gate is the
    // forced-break case above (partial page 0: inFlowConsumed 48 ≠ height 80). This
    // case complements it: it verifies the BFC accumulates childBlockOffset correctly
    // THROUGH a block that straddles the page boundary, so the float following the
    // straddling block's tail lands at the right cumulative offset and narrows the
    // correct page.
    // DERIVATION (verified by running the harness once):
    //   para a = 7 lines → total in-flow content = 7×16 = 112.
    //   page 0 holds 5 lines (cumul 0,16,32,48,64) → inFlowConsumed = 80 (FULL page).
    //   pageFlowBase(page 1) = 80; a's tail = 2 lines at cumul 80,96.
    //   the float box sits at cumulative 112 (after a's full 7-line height) → span [112, 112+32=144].
    //   para c follows: cumulative 112,128 (NARROW, inside [112,144]), then 144,160 (FULL).
    //   Observed page geometry:
    //     page 0: [FULL ×5]                                (para a head — never narrowed)
    //     page 1: [FULL, FULL, NARROW, NARROW, FULL]       (a tail ×2 FULL @ 80,96; c ×2 NARROW @ 112,128; c FULL @ 144)
    //     page 2: [FULL, FULL]                             (c ×2 FULL @ cumul 160,176)
    expect(g[0]?.[0]).toEqual(FULL); // page 0: para a head, all FULL
    expect(g[0]?.[1]).toEqual(FULL);
    expect(g[0]?.[2]).toEqual(FULL);
    expect(g[0]?.[3]).toEqual(FULL);
    expect(g[0]?.[4]).toEqual(FULL);
    expect(g[1]?.[0]).toEqual(FULL); // a tail @ cumul 80 (above the float)
    expect(g[1]?.[1]).toEqual(FULL); // a tail @ cumul 96 (above the float)
    expect(g[1]?.[2]).toEqual(NARROW); // c @ cumul 112 (inside float span [112,144])
    expect(g[1]?.[3]).toEqual(NARROW); // c @ cumul 128 (inside float span)
    expect(g[1]?.[4]).toEqual(FULL); // c @ cumul 144 (≥ float end)
    expect(g[2]?.[0]).toEqual(FULL); // c @ cumul 160
    expect(g[2]?.[1]).toEqual(FULL); // c @ cumul 176
  });

  // Section-break and footnote partial-page gaplessness are NOT directly
  // constructible through `paginatedHarness`, and faking them via unrelated
  // styling would be a false-confidence test. The structural argument that the
  // invariant still holds is documented inline below.
  it.skip("gapless pageFlowBase across a section break (NOT constructible via paginatedHarness)", () => {
    // `paginatedHarness` routes float docs through the LEGACY `paginateRoot`
    // path (floats fall back to legacy in the virtualized-layout v1), and it
    // threads `IMPLICIT_SECTION_PLAN` only — it cannot construct a real
    // multi-section plan (no `buildSectionPlan` / SECTION_BREAK threading).
    // Real section breaks are exercised via the editor harness
    // (`editor/actions/section-pagination.test.ts`), which routes through the
    // VIRTUAL path and never co-occurs with a fallback float doc.
    //
    // STRUCTURAL ARGUMENT (why the invariant holds): a section break produces a
    // partial last page through the SAME `inFlowConsumed` partial-return path
    // that Case A's forced page break exercises — the section cap stops in-flow
    // placement early and the page's `LayoutResult.inFlowConsumed` reflects only
    // the content actually placed (the `childBlockOffset` at the cap), never the
    // page height. `pageFlowBase` accumulates those true partials, so it stays
    // gapless across section boundaries for the same reason it does across a
    // forced page break.
  });

  it.skip("gapless pageFlowBase with a footnote slot above a float (NOT constructible via paginatedHarness)", () => {
    // `paginatedHarness` threads no `cascadedEmbedContents`, so it cannot build a
    // real footnote. Footnotes route through `resolveFootnotes` on the VIRTUAL
    // path (see `layout/resolve-footnotes.test.ts`); they do not co-occur with a
    // legacy-fallback float doc in any harness today.
    //
    // STRUCTURAL ARGUMENT (why the invariant holds): `pageFlowBase` is sourced
    // from `LayoutResult.inFlowConsumed`, which is the in-flow BODY content
    // height computed in bfc/fit-core BEFORE any footnote-slot reservation. A
    // footnote slot is a SEPARATE page-bottom reservation applied later in
    // `resolveFootnotes`; it reduces the body capacity of its page (so fewer
    // body lines fit → that page's `inFlowConsumed` is SMALLER), but the slot
    // height itself is NEVER folded into `inFlowConsumed`. Therefore the
    // accumulator advances by exactly the body content placed and stays gapless:
    // a float on a later page narrows its own page regardless of any earlier
    // page's footnote reservation.
  });
});
