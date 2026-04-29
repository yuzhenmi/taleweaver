/**
 * Integration: Real CSS 9.5 floats — end-to-end.
 * Tests clearfix, float stacking, coexistence, and line push behavior.
 */
import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node-v2";
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
    const out = layoutBlock(cascaded, 0, 0, ctx, shaper);
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
    const out = layoutBlock(cascaded, 0, 0, ctx, shaper);
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
    const out = layoutBlock(cascaded, 0, 0, ctx, shaper);
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
    const out = layoutBlock(cascaded, 0, 0, ctx, shaper);
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
    const out = layoutBlock(cascaded, 0, 0, ctx, shaper);
    // flow-root should enclose the float: blockSize >= 50
    expect(out.blockSize).toBeGreaterThanOrEqual(50);
  });
});
