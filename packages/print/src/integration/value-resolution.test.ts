/**
 * Integration: value-resolution pipeline end-to-end.
 *
 * Validates each value form (em, %, auto, intrinsic keyword, inheritance) across
 * the full Style → ComputedStyle → UsedStyle pipeline.
 *
 * Pipeline stages tested:
 *   1. cascadePass  — composes specified + inherited + initial → ComputedStyle
 *                     (resolves `em` against own fontSize; keeps `%` and `auto` symbolic)
 *   2. layoutTree   — resolves `%` and `auto` against the containing-block size → UsedStyle
 *
 * For intrinsic-keyword sizing (auto inline-block / min-content), see the
 * canonical tests in intrinsic-sizing.test.ts — they are not duplicated here.
 */
import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-box";

const shaper = createMockShaper(10, 16);

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/** Walk the LayoutBox tree to find a node by its key. */
function findByKey(box: LayoutBox, key: string): LayoutBox | null {
  if (box.key === key) return box;
  if ("children" in box) {
    for (const child of box.children) {
      const found = findByKey(child, key);
      if (found !== null) return found;
    }
  }
  return null;
}

describe("Value resolution — end-to-end (cascade + layout)", () => {
  // -------------------------------------------------------------------------
  // 1. em on margin — resolved at cascade time (flattenLengths).
  // -------------------------------------------------------------------------
  it("em on margin resolves against own font-size (0.5em × 20px = 10px)", () => {
    // Parent doc has fontSize: 20.  Child paragraph inherits fontSize=20 and
    // specifies marginBlockStart: 0.5em.  The cascade should flatten 0.5em → 10.
    const doc = createElementBox("doc", { display: "block", fontSize: 20 }, [
      createElementBox(
        "p",
        { display: "block", marginBlockStart: { unit: "em", value: 0.5 } },
        [],
      ),
    ]);

    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("expected element");
    const p = nth(cascaded.children, 0, "p element");
    if (p.type !== "element") throw new Error("expected element");

    // computedStyle: em resolved to px — 0.5 * 20 = 10
    expect(p.computedStyle?.marginBlockStart).toBe(10);

    // usedStyle via layout: still 10 (no containing-block dependency for px)
    const root = layoutTree(cascaded, 500, shaper);
    if (root.type !== "block") throw new Error("expected block");
    const pBox = findByKey(root, "p");
    expect(pBox).not.toBeNull();
    if (pBox === null) throw new Error("no pBox");
    expect(pBox.usedStyle.marginBlockStart).toBe(10);
  });

  // -------------------------------------------------------------------------
  // 2. rem — deferred (Plan 3.B does not ship rem support).
  // -------------------------------------------------------------------------
  it.skip("rem (root em) resolves against root document font-size", () => {
    // Plan 3.B/D does not support the `rem` unit in the Length type.
    // The Length union is: px | percent | em (see styles/length.ts).
    // When rem support lands, a root fontSize:16 should make 1.5rem → 24px.
    // Tracking: deferred to a future plan — document the gap here for visibility.
    expect.fail("rem unit not implemented — update this test when rem is added to Length");
  });

  // -------------------------------------------------------------------------
  // 3. % on block-axis margin — resolves against containing-block INLINE-size.
  //    CSS spec: all margins/paddings in horizontal-tb resolve against inline-size.
  // -------------------------------------------------------------------------
  it("percent block-axis margin resolves against containing-block inline-size (10% × 500 = 50)", () => {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox(
          "p",
          { display: "block", marginBlockStart: { unit: "percent", value: 10 } },
          [],
        ),
      ]),
    );

    const root = layoutTree(tree, 500, shaper);
    if (root.type !== "block") throw new Error("expected block");
    const child = nth(root.children, 0, "block child");
    expect(child.type).toBe("block");
    if (child.type !== "block") throw new Error("expected block child");
    // 10% of inline-size=500 → 50px
    expect(child.usedStyle.marginBlockStart).toBe(50);
  });

  // -------------------------------------------------------------------------
  // 4. % on padding — resolves against containing-block inline-size.
  // -------------------------------------------------------------------------
  it("percent inline padding resolves against containing-block inline-size (5% × 800 = 40)", () => {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox(
          "p",
          { display: "block", paddingInlineStart: { unit: "percent", value: 5 } },
          [],
        ),
      ]),
    );

    const root = layoutTree(tree, 800, shaper);
    if (root.type !== "block") throw new Error("expected block");
    const child = nth(root.children, 0, "block child");
    expect(child.type).toBe("block");
    if (child.type !== "block") throw new Error("expected block child");
    // 5% of inline-size=800 → 40px
    expect(child.usedStyle.paddingInlineStart).toBe(40);
  });

  // -------------------------------------------------------------------------
  // 5. auto inline-axis margin — v1 behavior: resolves to 0 (fallbackForAutoMargin=0).
  //    CSS would center the block with margin: auto; Plan 3.B does not yet implement
  //    auto-margin centering.  This test documents the current v1 behavior.
  // -------------------------------------------------------------------------
  it("auto inline margin resolves to 0 in v1 (centering not yet implemented)", () => {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox(
          "p",
          {
            display: "block",
            inlineSize: 200,
            marginInlineStart: "auto",
            marginInlineEnd:   "auto",
          },
          [],
        ),
      ]),
    );

    const root = layoutTree(tree, 600, shaper);
    if (root.type !== "block") throw new Error("expected block");
    const child = nth(root.children, 0, "block child");
    expect(child.type).toBe("block");
    if (child.type !== "block") throw new Error("expected block child");
    // v1: fallbackForAutoMargin = 0 — centering is deferred.
    expect(child.usedStyle.marginInlineStart).toBe(0);
    expect(child.usedStyle.marginInlineEnd).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 6. auto inline-size on inline-block → shrink-to-fit.
  //    See the canonical test: intrinsic-sizing.test.ts
  //    "inline-block with auto inline-size shrinks to content max-content"
  // -------------------------------------------------------------------------
  it.skip("auto inline-size on inline-block resolves to shrink-to-fit — see intrinsic-sizing.test.ts", () => {
    // Reference: packages/core/src/integration/intrinsic-sizing.test.ts
    // "inline-block with auto inline-size shrinks to content max-content"
    // Not duplicated here.
  });

  // -------------------------------------------------------------------------
  // 7. min-content keyword on inlineSize.
  //    See the canonical test: intrinsic-sizing.test.ts
  //    "block with inline-size: min-content sizes to minContent (widest cluster)"
  // -------------------------------------------------------------------------
  it.skip("min-content keyword on inlineSize — see intrinsic-sizing.test.ts", () => {
    // Reference: packages/core/src/integration/intrinsic-sizing.test.ts
    // "block with inline-size: min-content sizes to minContent (widest cluster)"
    // Not duplicated here.
  });

  // -------------------------------------------------------------------------
  // 8. Inheritance: child inherits fontSize when not overridden.
  // -------------------------------------------------------------------------
  it("child inherits fontSize from ancestor when not overridden", () => {
    const doc = createElementBox("doc", { display: "block", fontSize: 24 }, [
      createElementBox("p", { display: "block" }, []),
    ]);

    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("expected element");
    const p = nth(cascaded.children, 0, "p element");
    if (p.type !== "element") throw new Error("expected element");

    // fontSize is an inheritable property — child should inherit 24
    expect(p.computedStyle?.fontSize).toBe(24);
  });

  // -------------------------------------------------------------------------
  // 9. Non-inheriting property: child does NOT inherit parent margin.
  // -------------------------------------------------------------------------
  it("child does not inherit non-inheritable property (marginBlockStart)", () => {
    const doc = createElementBox("doc", { display: "block", marginBlockStart: 10 }, [
      createElementBox("p", { display: "block" }, []),
    ]);

    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("expected element");
    const p = nth(cascaded.children, 0, "p element");
    if (p.type !== "element") throw new Error("expected element");

    // marginBlockStart has inherits:false in PROPERTY_META → initial value = 0
    expect(p.computedStyle?.marginBlockStart).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 10. Nested em — grandchild resolves em against its own (inherited) fontSize.
  //     Doc: fontSize=16 → para: fontSize={unit:"em",value:2} (→ 32) →
  //     span: marginBlockStart={unit:"em",value:0.5} (→ 0.5*32=16)
  // -------------------------------------------------------------------------
  it("nested em: grandchild em resolves against nearest ancestor font-size in chain", () => {
    const doc = createElementBox("doc", { display: "block", fontSize: 16 }, [
      createElementBox(
        "p",
        { display: "block", fontSize: { unit: "em", value: 2 } }, // 2em × 16 = 32
        [
          createElementBox(
            "span",
            {
              display: "inline-block",
              marginBlockStart: { unit: "em", value: 0.5 }, // 0.5em × 32 = 16
            },
            [],
          ),
        ],
      ),
    ]);

    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("expected element");
    const p = nth(cascaded.children, 0, "p element");
    if (p.type !== "element") throw new Error("expected element");
    const span = nth(p.children, 0, "span element");
    if (span.type !== "element") throw new Error("expected element");

    expect(p.computedStyle?.fontSize).toBe(32);       // 2em × 16
    expect(span.computedStyle?.fontSize).toBe(32);     // inherited
    expect(span.computedStyle?.marginBlockStart).toBe(16); // 0.5em × 32
  });

  // -------------------------------------------------------------------------
  // 11. Percent on inline-size — block child constrained to 50% of container.
  //     A non-empty child (has text content) is required; the BFC empty-block
  //     fast-path would otherwise recreate the box with the parent's contentInlineSize.
  // -------------------------------------------------------------------------
  it("percent inlineSize: non-empty block child constrained to 50% of 600px container → 300px", () => {
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox(
          "p",
          { display: "block", inlineSize: { unit: "percent", value: 50 } },
          [createTextBox("t", {}, "hi")],
        ),
      ]),
    );

    const root = layoutTree(tree, 600, shaper);
    if (root.type !== "block") throw new Error("expected block");
    const child = nth(root.children, 0, "block child");
    expect(child.type).toBe("block");
    if (child.type !== "block") throw new Error("expected block child");
    // 50% of 600 = 300
    expect(child.inlineSize).toBe(300);
  });

  // -------------------------------------------------------------------------
  // 12. Border-width as plain number (px shorthand) — passes through pipeline unchanged.
  // -------------------------------------------------------------------------
  it("border-width as number passes through cascade and layout as exact px value", () => {
    const doc = createElementBox("doc", { display: "block" }, [
      createElementBox(
        "p",
        { display: "block", borderBlockStartWidth: 2 },
        [],
      ),
    ]);

    const cascaded = cascadePass(doc);
    if (cascaded.type !== "element") throw new Error("expected element");
    const p = nth(cascaded.children, 0, "p element");
    if (p.type !== "element") throw new Error("expected element");

    // borderBlockStartWidth is a plain number in Style — passes through unchanged
    expect(p.computedStyle?.borderBlockStartWidth).toBe(2);

    const root = layoutTree(cascaded, 500, shaper);
    if (root.type !== "block") throw new Error("expected block");
    const pBox = nth(root.children, 0, "block child");
    expect(pBox.type).toBe("block");
    if (pBox.type !== "block") throw new Error("expected block child");
    expect(pBox.usedStyle.borderBlockStartWidth).toBe(2);
  });
});
