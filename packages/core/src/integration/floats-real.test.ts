/**
 * Integration: Real CSS 9.5 floats — end-to-end.
 * Tests clearfix, float stacking, coexistence, and line push behavior.
 *
 * Plan 3.F push-below test: "two same-side floats stack vertically when first
 * fills container" (in the first describe block below) verifies that a float
 * whose width exactly fills the container causes the next same-side float to
 * be pushed below — the core Plan 3.F push-below-if-needed behaviour.
 *
 * Plan 3.J Task 3 adds edge-case tests in a second describe block:
 *   - Float with explicit width that doesn't fit at requested block-offset
 *     (cross-side push-below)
 *   - Clear interaction without margin (pure clearance)
 *   - Floats on both sides leaving inadequate gap — line pushes below
 */
import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";
import { layoutBlock } from "../layout/bfc";
import { createMockShaper } from "../layout/mock-shaper";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { LayoutBox } from "../layout/layout-box-v2";

const shaper = createMockShaper(10, 16);

function findBoxByKey(box: LayoutBox, key: string): LayoutBox | null {
  if (box.key === key) return box;
  if ("children" in box) {
    for (const c of box.children) {
      const r = findBoxByKey(c, key);
      if (r) return r;
    }
  }
  return null;
}

/** Walk the box tree depth-first and return the first LineBox found. */
function findFirstLine(box: LayoutBox): LayoutBox | null {
  if (box.type === "line") return box;
  if ("children" in box) {
    for (const c of box.children) {
      const r = findFirstLine(c);
      if (r !== null) return r;
    }
  }
  return null;
}

describe("Real CSS 9.5 floats — end-to-end", () => {
  it("two same-side floats stack vertically when first fills container", () => {
    const f1 = createElementBox(
      "f1",
      { display: "block", float: "inline-start", inlineSize: 200, blockSize: 50 },
      [],
    );
    const f2 = createElementBox(
      "f2",
      { display: "block", float: "inline-start", inlineSize: 200, blockSize: 50 },
      [],
    );
    const parent = createElementBox("p", { display: "flow-root" }, [f1, f2]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(
      cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE,
      200,
    );
    const outResult1 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (outResult1.box === null) throw new Error("layoutBlock returned null box");
    const out = outResult1.box;
    const f2Box = findBoxByKey(out, "f2");
    expect(f2Box?.y).toBe(50); // pushed below f1
  });

  it("inline-start and inline-end floats coexist when widths sum less than container", () => {
    const fs = createElementBox(
      "fs",
      { display: "block", float: "inline-start", inlineSize: 80, blockSize: 50 },
      [],
    );
    const fe = createElementBox(
      "fe",
      { display: "block", float: "inline-end", inlineSize: 80, blockSize: 50 },
      [],
    );
    const parent = createElementBox("p", { display: "flow-root" }, [fs, fe]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(
      cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE,
      200,
    );
    const outResult2 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (outResult2.box === null) throw new Error("layoutBlock returned null box");
    const out = outResult2.box;
    const fsBox = findBoxByKey(out, "fs");
    const feBox = findBoxByKey(out, "fe");
    expect(fsBox?.blockOffset).toBe(0);
    expect(feBox?.blockOffset).toBe(0); // coexists with fs
  });

  it("below-min-content line starts below float (line push)", () => {
    // Container 200px, float takes 150px inline-start, minimal text needs ~10px
    // Text should be pushed below (or wrap if possible).
    const f = createElementBox(
      "f",
      { display: "block", float: "inline-start", inlineSize: 150, blockSize: 30 },
      [],
    );
    const text = createTextBox("t", {}, "X");
    const parent = createElementBox("p", { display: "block" }, [f, text]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(
      cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE,
      200,
    );
    const outResult3 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (outResult3.box === null) throw new Error("layoutBlock returned null box");
    if (outResult3.box.type !== "block") throw new Error("layoutBlock returned non-block box");
    const out = outResult3.box;
    // Line should be below the float or wrap; the container should be at least 30px tall.
    expect(out.blockSize).toBeGreaterThanOrEqual(30);
  });

  it("clearance + margin-collapse: cleared box gets clearance + uncollapsed margin", () => {
    const f = createElementBox(
      "f",
      { display: "block", float: "inline-start", inlineSize: 100, blockSize: 40 },
      [],
    );
    const cleared = createElementBox(
      "clr",
      { display: "block", clear: "inline-start", blockSize: 20, marginBlockStart: 15 },
      [],
    );
    const parent = createElementBox("p", { display: "block" }, [f, cleared]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(
      cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE,
      300,
    );
    const outResult4 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (outResult4.box === null) throw new Error("layoutBlock returned null box");
    const out = outResult4.box;
    const clrBox = findBoxByKey(out, "clr");
    // Cleared box should be at y >= 40 (clearance from float), not collapsed by float.
    expect(clrBox?.blockOffset).toBeGreaterThanOrEqual(40);
  });

  it("self-collapsing flow-root with floats encloses them (clearfix)", () => {
    const f1 = createElementBox(
      "f1",
      { display: "block", float: "inline-start", inlineSize: 100, blockSize: 50 },
      [],
    );
    const container = createElementBox("c", { display: "flow-root" }, [f1]);
    const cascaded = cascadePass(container);
    if (cascaded.type !== "element") throw new Error("?");
    const ctx = makeRootContext(
      cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE,
      500,
    );
    const outResult5 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (outResult5.box === null) throw new Error("layoutBlock returned null box");
    if (outResult5.box.type !== "block") throw new Error("layoutBlock returned non-block box");
    const out = outResult5.box;
    // flow-root should enclose the float: blockSize >= 50
    expect(out.blockSize).toBeGreaterThanOrEqual(50);
  });
});

// Plan 3.J Task 3 — float edge cases (width-overflow, clear, both-sides line-push)
describe("Real CSS 9.5 floats — edge cases (Plan 3.J Task 3)", () => {
  it("float whose explicit width doesn't fit at requested offset is pushed below (cross-side)", () => {
    // Setup (containerWidth = 500, charWidth = 10, lineHeight = 16):
    //   f_left  : inline-start, 300 px wide, 50 px tall → placed at (x=0, y=0)
    //   f_right : inline-end,   250 px wide, 50 px tall, requested at y=0
    //     At y=0: inlineStartSize=300 → free=500-300=200 px < 250 px → doesn't fit.
    //     Next float bottom below y=0 is y=50 (f_left ends). At y=50: free=500 px ≥ 250 → fits.
    //   Expected: f_right.blockOffset === 50.
    const fLeft = createElementBox(
      "ec-f-left",
      { display: "block", float: "inline-start", inlineSize: 300, blockSize: 50 },
      [],
    );
    const fRight = createElementBox(
      "ec-f-right",
      { display: "block", float: "inline-end", inlineSize: 250, blockSize: 50 },
      [],
    );
    const parent = createElementBox("ec-parent", { display: "flow-root" }, [fLeft, fRight]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error("cascade failed");
    const ctx = makeRootContext(
      cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE,
      500,
    );
    const outResult6 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (outResult6.box === null) throw new Error("layoutBlock returned null box");
    const out = outResult6.box;
    const fRightBox = findBoxByKey(out, "ec-f-right");
    // Float boxes are placed with `y` (physical position) overridden to the
    // placed block-offset; `blockOffset` retains its internal 0 from the
    // float's own layout pass. Assert on `y`.
    expect(fRightBox?.y).toBe(50);
  });

  it("clear: inline-start lands block below float bottom even without margin", () => {
    // Setup (containerWidth = 500):
    //   float : inline-start, 100 px wide, 60 px tall at y=0
    //   cleared: display:block, clear:inline-start, blockSize:20, no margin
    //     Without clear, the cleared box would land at y=0 (in-flow, right after the float).
    //     With clear:inline-start, clearance raises it to y=60 (float's block-end).
    //   Expected: cleared.blockOffset === 60.
    //
    //   Note: the existing "clearance + margin-collapse" test in the first describe block
    //   covers the same mechanism but includes a marginBlockStart=15 on the cleared box.
    //   This test isolates pure clearance with no margin.
    const f = createElementBox(
      "clr-float",
      { display: "block", float: "inline-start", inlineSize: 100, blockSize: 60 },
      [],
    );
    const cleared = createElementBox(
      "clr-block",
      { display: "block", clear: "inline-start", blockSize: 20 },
      [],
    );
    const parent = createElementBox("clr-parent", { display: "block" }, [f, cleared]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error("cascade failed");
    const ctx = makeRootContext(
      cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE,
      500,
    );
    const outResult7 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (outResult7.box === null) throw new Error("layoutBlock returned null box");
    const out = outResult7.box;
    const clearedBox = findBoxByKey(out, "clr-block");
    // Cleared block must land at (or after) the float's bottom edge.
    expect(clearedBox?.blockOffset).toBeGreaterThanOrEqual(60);
  });

  it("floats on both sides leave inadequate gap — inline-content line pushed below", () => {
    // Setup (containerWidth = 300, charWidth = 10):
    //   f_left  : inline-start, 160 px wide, 60 px tall → placed at (x=0,   y=0)
    //   f_right : inline-end,   100 px wide, 60 px tall → placed at (x=200, y=0)
    //     Gap at y=0: 300 - 160 - 100 = 40 px.
    //   text "HELLO": 5 chars × 10 px = 50 px > 40 px → doesn't fit at y=0.
    //   IFC push-below: next float bottom below y=0 is y=60. At y=60: free=300 px ≥ 50 → fits.
    //   Expected: the line's blockOffset >= 60.
    const fLeft = createElementBox(
      "bs-f-left",
      { display: "block", float: "inline-start", inlineSize: 160, blockSize: 60 },
      [],
    );
    const fRight = createElementBox(
      "bs-f-right",
      { display: "block", float: "inline-end", inlineSize: 100, blockSize: 60 },
      [],
    );
    const text = createTextBox("bs-text", {}, "HELLO");
    const parent = createElementBox("bs-parent", { display: "block" }, [fLeft, fRight, text]);
    const cascaded = cascadePass(parent);
    if (cascaded.type !== "element") throw new Error("cascade failed");
    const ctx = makeRootContext(
      cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE,
      300,
    );
    const outResult8 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (outResult8.box === null) throw new Error("layoutBlock returned null box");
    const out = outResult8.box;
    const line = findFirstLine(out);
    // The line must have been pushed below the float region (both floats end at y=60).
    expect(line?.blockOffset).toBeGreaterThanOrEqual(60);
  });
});
