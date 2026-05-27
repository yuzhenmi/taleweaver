import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "../render/render-node";
import { cascadePass } from "../cascade";
import { createMockShaper } from "./mock-shaper";
import { layoutInlineContent } from "./ifc";
import type { Style } from "../styles";
import { INITIAL_COMPUTED_STYLE } from "../styles";
import type { Direction } from "../styles/writing-mode";
import { makeRootContext } from "./layout-context";
import type { LineBox } from "./layout-box-v2";
import { computeAlignmentOffset } from "./ifc-align";

const CHAR_W = 8;
const LINE_H = 16;
const shaper = createMockShaper(CHAR_W, LINE_H);

/**
 * Lay out a single paragraph with the given block style + text in a container
 * of `width`, return the emitted LineBoxes. Geometry is deterministic via the
 * fixed-width mock shaper (CHAR_W px/char).
 */
function layoutPara(
  text: string,
  width: number,
  style: Style,
  direction: Direction = "ltr",
): LineBox[] {
  const tree = cascadePass(
    createElementBox("p", { display: "block", ...style }, [
      createTextBox("t", {}, text),
    ]),
  );
  if (tree.type !== "element") throw new Error("expected element");
  const baseCtx = makeRootContext(INITIAL_COMPUTED_STYLE, width);
  // The IFC reads the inline base direction from `ctx.direction`; override for
  // the RTL cases (makeRootContext derives it from the root computed style).
  const ctx = direction === baseCtx.direction ? baseCtx : { ...baseCtx, direction };
  const result = layoutInlineContent(tree, 0, 0, ctx, shaper);
  if (result.box === null) throw new Error("layoutInlineContent returned null box");
  return result.box.children.filter((c): c is LineBox => c.type === "line");
}

describe("computeAlignmentOffset (pure helper)", () => {
  // The helper returns a LOGICAL inline-start delta (physical left/right is
  // resolved downstream by logicalToPhysical), so the offset is the same for
  // ltr and rtl: start → 0, end → gap, center → gap/2, justify → 0.
  it("start → 0 (both directions)", () => {
    expect(computeAlignmentOffset(200, 40, "start", "ltr")).toBe(0);
    expect(computeAlignmentOffset(200, 40, "start", "rtl")).toBe(0);
  });
  it("end → full gap (both directions)", () => {
    expect(computeAlignmentOffset(200, 40, "end", "ltr")).toBe(160);
    expect(computeAlignmentOffset(200, 40, "end", "rtl")).toBe(160);
  });
  it("center → half gap (both directions)", () => {
    expect(computeAlignmentOffset(200, 40, "center", "ltr")).toBe(80);
    expect(computeAlignmentOffset(200, 40, "center", "rtl")).toBe(80);
  });
  it("justify → 0 in P2 (start-equivalent)", () => {
    expect(computeAlignmentOffset(200, 40, "justify", "ltr")).toBe(0);
    expect(computeAlignmentOffset(200, 40, "justify", "rtl")).toBe(0);
  });
  it("clamps to 0 when content >= available", () => {
    expect(computeAlignmentOffset(40, 40, "center", "ltr")).toBe(0);
    expect(computeAlignmentOffset(40, 100, "center", "ltr")).toBe(0);
    expect(computeAlignmentOffset(40, 100, "end", "ltr")).toBe(0);
  });
});

describe("IFC alignment — single-line geometry", () => {
  // "hello" = 5 chars × 8px = 40px content; container 200px.
  const W = 200;
  const CONTENT = "hello".length * CHAR_W; // 40

  it("center: line.x === (available − content) / 2", () => {
    const lines = layoutPara("hello", W, { textAlign: "center" });
    expect(lines).toHaveLength(1);
    expect(lines[0].x).toBe((W - CONTENT) / 2); // 80
  });

  it("end (ltr): line.x === available − content", () => {
    const lines = layoutPara("hello", W, { textAlign: "end" });
    expect(lines).toHaveLength(1);
    expect(lines[0].x).toBe(W - CONTENT); // 160
  });

  it("start (ltr): line.x === 0 (no regression)", () => {
    const lines = layoutPara("hello", W, { textAlign: "start" });
    expect(lines).toHaveLength(1);
    expect(lines[0].x).toBe(0);
  });

  it("default (no textAlign attr → initial 'start'): line.x === 0", () => {
    const lines = layoutPara("hello", W, {});
    expect(lines).toHaveLength(1);
    expect(lines[0].x).toBe(0);
  });

  it("justify in P2 behaves as start: line.x === 0", () => {
    const lines = layoutPara("hello", W, { textAlign: "justify" });
    expect(lines).toHaveLength(1);
    expect(lines[0].x).toBe(0);
  });
});

describe("IFC alignment — trailing-space exclusion", () => {
  // Centering must use the VISIBLE (non-trailing-space) width. With
  // white-space: pre-wrap the trailing spaces are preserved tokens but must
  // NOT count toward the centered content width.
  const W = 200;

  it("center excludes trailing spaces from the centered content width", () => {
    // "hi   " — 2 visible chars + 3 trailing spaces.
    const visible = "hi".length * CHAR_W; // 16
    const lines = layoutPara("hi   ", W, { textAlign: "center", whiteSpace: "pre-wrap" });
    expect(lines).toHaveLength(1);
    // Centered by visible width only.
    expect(lines[0].x).toBe((W - visible) / 2); // 92
  });

  it("center of a no-trailing-space line uses full content width", () => {
    const content = "hi".length * CHAR_W; // 16
    const lines = layoutPara("hi", W, { textAlign: "center", whiteSpace: "pre-wrap" });
    expect(lines).toHaveLength(1);
    expect(lines[0].x).toBe((W - content) / 2); // 92
  });
});

describe("IFC alignment — strut (empty paragraph)", () => {
  const W = 200;

  it("center strut: line.x === available / 2 (caret centered)", () => {
    const lines = layoutPara("", W, { textAlign: "center" });
    expect(lines).toHaveLength(1);
    expect(lines[0].children).toHaveLength(0); // strut has no content
    expect(lines[0].x).toBe(W / 2); // 100
  });

  it("end strut: line.x === available (caret at right edge)", () => {
    const lines = layoutPara("", W, { textAlign: "end" });
    expect(lines).toHaveLength(1);
    expect(lines[0].x).toBe(W); // 200
  });

  it("start strut: line.x === 0 (no regression)", () => {
    const lines = layoutPara("", W, { textAlign: "start" });
    expect(lines).toHaveLength(1);
    expect(lines[0].x).toBe(0);
  });
});

describe("IFC alignment — multi-line wrap", () => {
  const W = 80; // 10 chars per line max

  it("each line independently centered by its own content width", () => {
    // "aaaa bbbb cccc" — mock shaper soft-breaks at spaces. 4-char words ×8px =
    // 32px each. "aaaa bbbb" + trailing space (72px content + 8px space) fits in
    // 80; adding "cccc" overflows. So: line 0 = "aaaa bbbb " (9 visible chars +
    // a trailing space), line 1 = "cccc" (4 chars, no trailing space).
    const lines = layoutPara("aaaa bbbb cccc", W, { textAlign: "center", whiteSpace: "normal" });
    expect(lines).toHaveLength(2);

    // Line 0: trailing space EXCLUDED → centered by visible 9 chars = 72px:
    // (80 − 72)/2 = 4.
    expect(lines[0].x).toBe((W - 9 * CHAR_W) / 2); // 4

    // Line 1 ("cccc"): no trailing space → centered by full 32px: (80 − 32)/2 = 24.
    expect(lines[1].x).toBe((W - 4 * CHAR_W) / 2); // 24

    // Independent per-line centering: a GLOBAL block shift would give both lines
    // the same x. They differ because each is centered by its own width.
    expect(lines[0].x).not.toBe(lines[1].x);
  });
});

describe("IFC alignment — RTL", () => {
  // P2 aligns by shifting the line's LOGICAL inline start (`lineInlineCursor`)
  // by a LOGICAL delta; `logicalToPhysical` resolves the physical edge.
  //
  // start (the default) → logical offset 0 → no line-box shift → byte-identical
  // to today's RTL output. This is the load-bearing NO-REGRESSION case: applying
  // the alignment pass must NOT move start-aligned RTL content (content is placed
  // at the inline-end / right edge via the bidi child reorder, inside a
  // full-width line box at x=0).
  it("start under rtl is unchanged (no regression): line.x === 0", () => {
    const W = 200;
    const lines = layoutPara("hello", W, { textAlign: "start" }, "rtl");
    expect(lines).toHaveLength(1);
    expect(lines[0].x).toBe(0);
  });

  // end/center under RTL: the line BOX spans the full available inline size, so
  // its physical `x` is mirrored as `containingInlineSize − inlineOffset −
  // inlineSize`; a non-zero logical-cursor shift on a full-width box does NOT
  // compose into a correct physical position (it lands off-canvas). Correct RTL
  // end/center needs the line box sized/positioned to its content (or the offset
  // applied to child positions after the bidi reorder) — a larger change than
  // P2's line-shift, so it is DEFERRED to a follow-up (prompt allows this).
  it.skip("end under rtl → left edge [DEFERRED: full-width RTL line-box geometry]", () => {
    const W = 200;
    const lines = layoutPara("hello", W, { textAlign: "end" }, "rtl");
    expect(lines[0].x).toBe(0);
  });
});

describe("IFC alignment — wrap-cache invalidation on textAlign change (I-4)", () => {
  // Re-lay the SAME paragraph (same tokens, same width) with a changed
  // textAlign through the SAME LayoutContext. The first layout populates the
  // IFC wrap-cache; the second must NOT return the stale (start-aligned) lines
  // but re-align them. This exercises the cache-hit gate directly.
  it("re-aligns the line when only textAlign changes (cache must reject stale lines)", () => {
    const W = 200;
    const CONTENT = "hello".length * CHAR_W; // 40
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, W);

    // Pass 1: start-aligned → x === 0. Populates the cache keyed by "p".
    const startTree = cascadePass(
      createElementBox("p", { display: "block", textAlign: "start" }, [
        createTextBox("t", {}, "hello"),
      ]),
    );
    if (startTree.type !== "element") throw new Error("expected element");
    const r1 = layoutInlineContent(startTree, 0, 0, ctx, shaper);
    if (r1.box === null) throw new Error("null box");
    const l1 = r1.box.children.filter((c): c is LineBox => c.type === "line");
    expect(l1[0].x).toBe(0);

    // Pass 2: SAME key, SAME tokens, SAME width — only textAlign flips to
    // center. The cache entry for "p" exists; the fix must reject it because
    // textAlign differs and re-align the line.
    const centerTree = cascadePass(
      createElementBox("p", { display: "block", textAlign: "center" }, [
        createTextBox("t", {}, "hello"),
      ]),
    );
    if (centerTree.type !== "element") throw new Error("expected element");
    const r2 = layoutInlineContent(centerTree, 0, 0, ctx, shaper);
    if (r2.box === null) throw new Error("null box");
    const l2 = r2.box.children.filter((c): c is LineBox => c.type === "line");
    // RE-ALIGNED, not stale: center → (200 − 40)/2 = 80.
    expect(l2[0].x).toBe((W - CONTENT) / 2);
  });
});
