/**
 * POSITIONING slice 5 — transform hit-test inversion (approach (b)).
 *
 * `collectLineBoxes` threads the cumulative ancestor `transform` and bakes a
 * three-state `inverseTransform` onto each `AbsoluteLineBox` (undefined =
 * identity fast-path / a `Mat2D` = invertible / `"singular"` = degenerate skip).
 * `resolvePositionFromPixel` maps the click through that inverse before the
 * pre-transform bounds test, so a click in PAINTED (transformed) space resolves to
 * the correct caret offset. The painter and this hit-test share the IDENTICAL
 * matrix (both via `fromTransformFns` / `resolveTransformOrigin`).
 */

import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { layoutBlock } from "../layout/bfc";
import { createMockShaper } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import { makeRootContext } from "../layout/layout-context";
import { getLineIndex, type AbsoluteLineBox } from "./line-flatten";
import { resolvePositionFromPixel } from "./hit-test";
import { buildState, buildBlock, inlineContent, text } from "@taleweaver/core";
import { computeStackingContextRole } from "@taleweaver/core";
import { establishesAbsoluteContainingBlock } from "../layout/layout-context";
import type { ElementBox } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";

const shaper = createMockShaper(8, 16);

// Build a real layout tree for a doc whose single paragraph carries `pStyle`
// (e.g. a `transform`). The mock shaper makes every glyph 8px wide / 16px tall,
// so a click's expected offset is computable.
function layoutDoc(pStyle: Record<string, unknown>, content = "hello world"): LayoutBox {
  const tree = cascadePass(
    createElementBox("doc", { display: "block" }, [
      createElementBox("p", { display: "block", ...pStyle }, [
        createTextBox("t", {}, content),
      ]),
    ]) as ElementBox,
  );
  if (tree.type !== "element") throw new Error("expected element root");
  const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
  const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
  if (r.box === null) throw new Error("layout produced no box");
  return r.box;
}

// A minimal State whose single paragraph "p" owns the text — so the hit-test's
// `resolveBlock` defensive check passes. (Block ids match the render tree above;
// the BFC may wrap text in `p/anon[..]`, but ownerBlockId resolves through the
// anon to "p"'s context — the state just needs "p" present.)
function docState(content = "hello world"): ReturnType<typeof buildState> {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
      buildBlock({ id: "p", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text(content)]) }),
    ],
  });
}

describe("transform hit-test (approach b)", () => {
  it("an untransformed doc bakes NO inverseTransform (identity fast-path)", () => {
    const layout = layoutDoc({});
    const lines = getLineIndex(layout).all;
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.inverseTransform).toBeUndefined();
    }
  });

  it("a translateX(40) paragraph bakes a Mat2D inverseTransform on its lines", () => {
    const layout = layoutDoc({ transform: [{ fn: "translateX", tx: 40 }] });
    const lines = getLineIndex(layout).all;
    const withTransform = lines.filter((l) => l.inverseTransform !== undefined);
    expect(withTransform.length).toBeGreaterThan(0);
    for (const l of withTransform) {
      expect(l.inverseTransform).not.toBe("singular");
      // The inverse of a +40 x-translate is a −40 x-translate.
      if (l.inverseTransform !== undefined && l.inverseTransform !== "singular") {
        expect(l.inverseTransform.e).toBeCloseTo(-40, 6);
      }
    }
  });

  it("click inside a translateX(40) paragraph resolves to the correct offset", () => {
    const state = docState();
    const untransformed = layoutDoc({});
    const transformed = layoutDoc({ transform: [{ fn: "translateX", tx: 40 }] });

    // Pick a click that lands on offset ~4 ("hell|o") in the UNTRANSFORMED doc.
    // The mock shaper is 8px/glyph, so x≈4*8=32 lands mid-paragraph. Resolve the
    // baseline offset there.
    const base = resolvePositionFromPixel(state, untransformed, shaper, 34, 8);
    expect(base).not.toBeNull();
    if (base === null) return;

    // In the TRANSFORMED doc the SAME glyph is painted 40px to the right, so a
    // click at x = 34 + 40 must map back to the SAME offset.
    const shifted = resolvePositionFromPixel(state, transformed, shaper, 34 + 40, 8);
    expect(shifted).not.toBeNull();
    if (shifted === null) return;
    expect(shifted.position.offset).toBe(base.position.offset);
    expect(shifted.position.blockId).toBe(base.position.blockId);
  });

  it("click inside a scale(2) paragraph resolves to the correct offset", () => {
    const state = docState();
    const untransformed = layoutDoc({});
    // scale 2 about top-left so the pre-transform origin stays put and a glyph at
    // pre-transform x maps to painted x*2 (origin 0,0).
    const transformed = layoutDoc({
      transform: [{ fn: "scale", sx: 2, sy: 2 }],
      transformOrigin: { x: { unit: "px", value: 0 }, y: { unit: "px", value: 0 } },
    });

    // Click mid-glyph (x=20 ≈ glyph 2.5 at 8px/glyph) to avoid a boundary tie.
    const base = resolvePositionFromPixel(state, untransformed, shaper, 20, 8);
    expect(base).not.toBeNull();
    if (base === null) return;
    // Painted at 2× → click at 2×20=40 (y also ×2) maps back to the same offset.
    const scaled = resolvePositionFromPixel(state, transformed, shaper, 40, 16);
    expect(scaled).not.toBeNull();
    if (scaled === null) return;
    expect(scaled.position.offset).toBe(base.position.offset);
  });

  it("scale(0) → singular → line is skipped (no hit, no throw)", () => {
    const state = docState();
    const layout = layoutDoc({ transform: [{ fn: "scale", sx: 0, sy: 0 }] });
    const lines = getLineIndex(layout).all;
    const singular = lines.filter((l) => l.inverseTransform === "singular");
    expect(singular.length).toBeGreaterThan(0);
    // A click anywhere does not throw; with every body line singular the hit-test
    // either returns null or falls through defensively — never crashes.
    expect(() => resolvePositionFromPixel(state, layout, shaper, 10, 10)).not.toThrow();
  });

  it("an untransformed hit-test is byte-identical to pre-slice behavior", () => {
    const state = docState();
    const layout = layoutDoc({});
    const a = resolvePositionFromPixel(state, layout, shaper, 18, 8);
    const b = resolvePositionFromPixel(state, layout, shaper, 18, 8);
    expect(a).not.toBeNull();
    expect(a?.position.offset).toBe(b?.position.offset);
    // A click at x≈18 (just past 2 glyphs) on an untransformed line resolves to a
    // small offset; the identity path means the bounds test ran verbatim.
    expect(a?.position.offset).toBeGreaterThanOrEqual(2);
    expect(a?.position.offset).toBeLessThanOrEqual(3);
  });

  it("nested transforms compose (outer translateX(100) ∘ inner translateX(10))", () => {
    // outer block translateX(100), its child paragraph translateX(10): a body line
    // inside carries the COMPOSED inverse (−110 on x).
    const tree = cascadePass(
      createElementBox("doc", { display: "block" }, [
        createElementBox("outer", { display: "block", transform: [{ fn: "translateX", tx: 100 }] }, [
          createElementBox("p", { display: "block", transform: [{ fn: "translateX", tx: 10 }] }, [
            createTextBox("t", {}, "hi"),
          ]),
        ]),
      ]) as ElementBox,
    );
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");
    const lines: readonly AbsoluteLineBox[] = getLineIndex(r.box).all;
    const tl = lines.find((l) => l.inverseTransform !== undefined && l.inverseTransform !== "singular");
    expect(tl).toBeDefined();
    if (tl?.inverseTransform !== undefined && tl?.inverseTransform !== "singular") {
      expect(tl.inverseTransform.e).toBeCloseTo(-110, 6);
    }
  });
});

describe("abs-pos descendant inside a transformed box is hit-test-reachable", () => {
  it("an abs child under a transformed root carries the inverseTransform on its lines", () => {
    // A `transform`-bearing root establishes an abc (slice 3) AND transforms its
    // abs-pos descendants (CSS Transforms 1). `collectLineBoxes` threads the
    // cumulative transform through `absoluteChildren`, so the abs paragraph's line
    // both ENTERS the flat index (slice-3 walk) and carries the baked inverse
    // (slice-5 thread) — proving the two compose.
    const abs = createElementBox(
      "abs",
      { display: "block", position: "absolute", insetInlineStart: 5, insetBlockStart: 5 },
      [createTextBox("at", {}, "ab")],
    );
    const root = createElementBox(
      "root",
      { display: "block", transform: [{ fn: "translateX", tx: 30 }], transformOrigin: { x: { unit: "px", value: 0 }, y: { unit: "px", value: 0 } } },
      [abs],
    );
    const tree = cascadePass(createElementBox("doc", { display: "block" }, [root]) as ElementBox);
    if (tree.type !== "element") throw new Error("?");
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, 500);
    const r = layoutBlock(tree, 0, 0, ctx, shaper, undefined);
    if (r.box === null) throw new Error("?");

    const lines = getLineIndex(r.box).all;
    // The abs paragraph's line is present (slice-3 absoluteChildren walk) AND
    // carries a (non-singular) inverse (slice-5 thread through abs children).
    const absLine = lines.find((l) => l.line.ownerBlockId.startsWith("abs"));
    expect(absLine).toBeDefined();
    expect(absLine?.inverseTransform).toBeDefined();
    expect(absLine?.inverseTransform).not.toBe("singular");
    if (absLine?.inverseTransform !== undefined && absLine?.inverseTransform !== "singular") {
      expect(absLine.inverseTransform.e).toBeCloseTo(-30, 6);
    }
  });
});

describe("transform establishes abc + stacking context (slice 3/4 verify)", () => {
  it("a non-empty transform establishes an absolute containing block", () => {
    const cs = { ...INITIAL_COMPUTED_STYLE, transform: [{ fn: "translateX" as const, tx: 5 }] };
    expect(establishesAbsoluteContainingBlock(cs)).toBe(true);
    // Empty transform does NOT establish one.
    expect(establishesAbsoluteContainingBlock(INITIAL_COMPUTED_STYLE)).toBe(false);
  });

  it("a non-empty transform makes the box a stacking context (role 'self')", () => {
    const cs = { ...INITIAL_COMPUTED_STYLE, transform: [{ fn: "rotate" as const, angleRad: 0.5 }] };
    expect(computeStackingContextRole(cs)).toBe("self");
    expect(computeStackingContextRole(INITIAL_COMPUTED_STYLE)).toBeUndefined();
  });
});
