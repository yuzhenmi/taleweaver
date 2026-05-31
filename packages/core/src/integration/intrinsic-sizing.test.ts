/**
 * Integration: end-to-end intrinsic sizing scenarios.
 *
 * Verifies that inline-block, float, min-content, max-content sizing keywords,
 * and auto-table column distribution all produce correct inline sizes.
 */
import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";
import { layoutBlock } from "../layout/bfc";
import { layoutTable } from "../layout/table-fc";
import { createMockShaper } from "../layout/mock-shaper";
import { makeRootContext } from "../layout/layout-context";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { LayoutBox } from "../layout/layout-box";

/**
 * Recursively search the output layout tree for a box whose key contains `keyFragment`.
 * Useful because IFC-generated inline-block keys embed the source key as a suffix.
 */
function findBoxByKeyFragment(box: LayoutBox, keyFragment: string): LayoutBox | null {
  if (box.key === keyFragment || box.key.endsWith(`-${keyFragment}`)) return box;
  if ("children" in box) {
    for (const c of box.children) {
      const r = findBoxByKeyFragment(c, keyFragment);
      if (r) return r;
    }
  }
  return null;
}

/**
 * Search for a box whose key exactly matches `key`.
 */
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

// charWidth=10 → each character contributes 10px; minClusterInlineSize=10; lineHeight=16.
const shaper = createMockShaper(10, 16);

describe("Intrinsic sizing — end-to-end", () => {
  it("inline-block with auto inline-size shrinks to content max-content", () => {
    // "abc" → 3 chars × 10px = 30px maxContent
    const ib = createElementBox(
      "ib",
      { display: "inline-block", inlineSize: "auto" },
      [createTextBox("t", {}, "abc")],
    );
    const para = createElementBox("p", { display: "block" }, [ib]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const r1 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r1.box === null) throw new Error("layoutBlock returned null box");
    const out = r1.box;
    // The inline-block key is composite: "<para-key>-l<n>-ib<n>-ib"
    const ibBox = findBoxByKeyFragment(out, "ib");
    expect(ibBox).not.toBeNull();
    expect(ibBox?.inlineSize).toBe(30);
  });

  it("float with auto inline-size shrinks to content (clamped to available)", () => {
    // "hello world!" — 12 chars × 10 = 120px maxContent;
    // space after "hello" gives a soft break → minContent = 10 (one char cluster).
    // Shrink-to-fit: Math.min(maxContent=120, available=200) = 120.
    const text = createTextBox("t", {}, "hello world!");
    const fl = createElementBox(
      "fl",
      { display: "block", float: "inline-start", inlineSize: "auto" },
      [text],
    );
    const para = createElementBox("p", { display: "block" }, [fl]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 200);
    const r2 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r2.box === null) throw new Error("layoutBlock returned null box");
    const out = r2.box;
    const flBox = findBoxByKey(out, "fl");
    expect(flBox).not.toBeNull();
    // shrink-to-fit: maxContent=120, available=200 → clamp to 120.
    expect(flBox?.inlineSize).toBe(120);
  });

  it("block with inline-size: max-content sizes to maxContent", () => {
    // "hello" → 5 chars × 10px = 50px maxContent
    const block = createElementBox(
      "b",
      { display: "block", inlineSize: "max-content" },
      [createTextBox("t", {}, "hello")],
    );
    const para = createElementBox("p", { display: "block" }, [block]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const r3 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r3.box === null) throw new Error("layoutBlock returned null box");
    const out = r3.box;
    const innerBox = findBoxByKey(out, "b");
    expect(innerBox).not.toBeNull();
    expect(innerBox?.inlineSize).toBe(50); // 5 chars × 10px
  });

  it("block with inline-size: min-content sizes to minContent (widest cluster)", () => {
    // "abc" — each cluster is 10px; minContent = minClusterInlineSize = 10px
    const block = createElementBox(
      "b",
      { display: "block", inlineSize: "min-content" },
      [createTextBox("t", {}, "abc")],
    );
    const para = createElementBox("p", { display: "block" }, [block]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const r4 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r4.box === null) throw new Error("layoutBlock returned null box");
    const out = r4.box;
    const innerBox = findBoxByKey(out, "b");
    expect(innerBox).not.toBeNull();
    expect(innerBox?.inlineSize).toBe(10); // minClusterInlineSize = charWidth = 10
  });

  it("auto-table: column widths from per-cell intrinsics (sumMax fits)", () => {
    // cell1: "abc" → maxContent=30; cell2: "abcde" → maxContent=50
    // sumMax=80 ≤ available=200, so each column = its colMax.
    const cell1 = createElementBox(
      "c1",
      { display: "table-cell" },
      [createTextBox("t1", {}, "abc")],   // maxContent = 30
    );
    const cell2 = createElementBox(
      "c2",
      { display: "table-cell" },
      [createTextBox("t2", {}, "abcde")], // maxContent = 50
    );
    const row = createElementBox("r", { display: "table-row" }, [cell1, cell2]);
    const table = createElementBox("tbl", { display: "table" }, [row]);
    const cascaded = cascadePass(table);
    if (cascaded.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 200);
    const tableResult = layoutTable(cascaded, 0, 0, ctx, shaper);
    if (tableResult.box === null) throw new Error("layoutTable returned null box; should be unreachable in B.3 (fragmentation not yet wired)");
    const out = tableResult.box;
    expect(out.columnPxWidths).toEqual([30, 50]); // sumMax=80 ≤ available=200
  });

  it("float clamped to available when content max-content exceeds container", () => {
    // "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" — 40 chars × 10 = 400px maxContent,
    // no soft breaks → minContent = 10; available = 200.
    // Shrink-to-fit formula: Math.min(maxContent=400, available=200, Math.max(minContent=10, available=200))
    //   = Math.min(400, 200, 200) = 200.
    const text = createTextBox("t", {}, "a".repeat(40));
    const fl = createElementBox(
      "fl",
      { display: "block", float: "inline-start", inlineSize: "auto" },
      [text],
    );
    const para = createElementBox("p", { display: "block" }, [fl]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 200);
    const r5 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r5.box === null) throw new Error("layoutBlock returned null box");
    const out = r5.box;
    const flBox = findBoxByKey(out, "fl");
    expect(flBox).not.toBeNull();
    // Float is clamped to available (200) since maxContent=400 > available=200.
    expect(flBox?.inlineSize).toBe(200);
  });
});

describe("Inline-block intrinsic sizing — edge cases", () => {
  // charWidth=10 per character; lineHeight=16.
  const shaper = createMockShaper(10, 16);

  it("inline-block with explicit inlineSize (not auto) uses that value, not shrink-to-fit", () => {
    // Content "abc" has maxContent=30px, but inlineSize is explicitly 200.
    // The IFC picks up the numeric inlineSize directly — no intrinsic sizing.
    const ib = createElementBox(
      "ib",
      { display: "inline-block", inlineSize: 200 },
      [createTextBox("t", {}, "abc")],
    );
    const para = createElementBox("p", { display: "block" }, [ib]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const r6 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r6.box === null) throw new Error("layoutBlock returned null box");
    const out = r6.box;
    const ibBox = findBoxByKeyFragment(out, "ib");
    expect(ibBox).not.toBeNull();
    // Must be exactly 200, NOT 30 (shrink-to-fit) and NOT 500 (fill).
    expect(ibBox?.inlineSize).toBe(200);
  });

  it("inline-block with auto inlineSize shrinks-to-fit: clamps to available when below maxContent (CSS Sizing 3 §10.3.5)", () => {
    // 80 chars × 10px = 800px maxContent. Container is only 500px wide.
    // The mock shaper reports a single-char min-cluster (10px), so min-content
    // is 10px (well below the 500px available).
    // Shrink-to-fit = min(maxContent, max(minContent, available))
    //               = min(800, max(10, 500)) = min(800, 500) = 500.
    // The inline-block clamps DOWN to the available 500px container width.
    const ib = createElementBox(
      "ib",
      { display: "inline-block", inlineSize: "auto" },
      [createTextBox("t", {}, "a".repeat(80))],
    );
    const para = createElementBox("p", { display: "block" }, [ib]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const r7 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r7.box === null) throw new Error("layoutBlock returned null box");
    const out = r7.box;
    const ibBox = findBoxByKeyFragment(out, "ib");
    expect(ibBox).not.toBeNull();
    // 500px — clamped to the available container width (shrink-to-fit).
    expect(ibBox?.inlineSize).toBe(500);
  });

  it("nested inline-block: outer and inner both shrink to their content maxContent", () => {
    // Inner: "xyz" → 3 chars × 10 = 30px maxContent.
    // Outer wraps the inner inline-block; outer's maxContent = inner's maxContent = 30px.
    const inner = createElementBox(
      "inner",
      { display: "inline-block", inlineSize: "auto" },
      [createTextBox("t", {}, "xyz")],
    );
    const outer = createElementBox(
      "outer",
      { display: "inline-block", inlineSize: "auto" },
      [inner],
    );
    const para = createElementBox("p", { display: "block" }, [outer]);
    const cascaded = cascadePass(para);
    if (cascaded.type !== "element") throw new Error("expected element");
    const ctx = makeRootContext(cascaded.computedStyle ?? INITIAL_COMPUTED_STYLE, 500);
    const r8 = layoutBlock(cascaded, 0, 0, ctx, shaper);
    if (r8.box === null) throw new Error("layoutBlock returned null box");
    const out = r8.box;

    const outerBox = findBoxByKeyFragment(out, "outer");
    expect(outerBox).not.toBeNull();
    expect(outerBox?.inlineSize).toBe(30);

    const innerBox = findBoxByKeyFragment(out, "inner");
    expect(innerBox).not.toBeNull();
    expect(innerBox?.inlineSize).toBe(30);
  });
});
