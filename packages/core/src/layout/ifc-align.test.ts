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
import { computeAlignmentOffset, computeJustifyExpansions } from "./ifc-align";
import type { TextRunBox } from "./layout-box-v2";

const CHAR_W = 8;
const LINE_H = 16;
const shaper = createMockShaper(CHAR_W, LINE_H);

/** Text-run children of a line (the visible glyph runs), in inline order. */
function textRuns(line: LineBox): TextRunBox[] {
  return line.children.filter((c): c is TextRunBox => c.type === "text-run");
}

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

describe("computeJustifyExpansions (pure helper)", () => {
  it("returns [] for zero interior spaces", () => {
    expect(computeJustifyExpansions(40, 0)).toEqual([]);
  });

  it("distributes gap equally when it divides evenly", () => {
    // gap 12 across 3 spaces → 4 each.
    expect(computeJustifyExpansions(12, 3)).toEqual([4, 4, 4]);
  });

  it("distributes a non-divisible remainder so the sum is exact", () => {
    // gap 10 across 3 spaces → base 3 (=floor(10/3)), remainder 1 → first
    // space gets the extra: [4, 3, 3]. Sum === 10 exactly (no drift).
    const exp = computeJustifyExpansions(10, 3);
    expect(exp).toHaveLength(3);
    expect(exp.reduce((s, e) => s + e, 0)).toBe(10);
    // Remainder lands on the leading spaces.
    expect(exp[0]).toBeGreaterThanOrEqual(exp[2]);
  });

  it("clamps a negative gap to zero expansion", () => {
    expect(computeJustifyExpansions(-5, 2)).toEqual([0, 0]);
  });

  it("fractional near-integer-multiple gap sums EXACTLY (no epsilon over-count)", () => {
    // A gap that is a hair under an exact integer multiple of spaceCount. The
    // old `floor(residual + 1e-9)` remainder count rounded the residual UP to a
    // whole 2, handing +1 to BOTH spaces ([8, 8] = 16) — over-counting past the
    // 15.999... input. The reconciliation step folds the exact residual into the
    // first space so the sum is the input gap to the last bit.
    const gap = 16.0 - 0.0000000000000018; // 15.999999999999998
    const exp = computeJustifyExpansions(gap, 2);
    expect(exp).toHaveLength(2);
    // EXACT: residual after reconciliation is zero (toBe / no toBeCloseTo).
    expect(exp.reduce((s, e) => s + e, 0)).toBe(gap);
    expect(gap - exp.reduce((s, e) => s + e, 0)).toBe(0);
    // Remainder still lands on the leading space: out[0] >= out[last].
    expect(exp[0]).toBeGreaterThanOrEqual(exp[1]);
  });

  it("normal fractional gap sums EXACTLY with leading-spaces-get-more ordering", () => {
    // gap 10.5 across 3 spaces → base 3, the 1.5 residual folds into the first
    // space: [4.5, 3, 3]. Sum === 10.5 exactly.
    const exp = computeJustifyExpansions(10.5, 3);
    expect(exp).toHaveLength(3);
    expect(exp.reduce((s, e) => s + e, 0)).toBe(10.5);
    // Leading space absorbs the residual → out[0] >= the trailing ones.
    expect(exp[0]).toBeGreaterThanOrEqual(exp[1]);
    expect(exp[1]).toBeGreaterThanOrEqual(exp[2]);
  });
});

describe("IFC alignment — justify (P3)", () => {
  // Mock shaper: CHAR_W=8. Width 88 → 11 chars/line max.
  // "aaaa bbbb cccc dddd" with whiteSpace:"normal":
  //   units = [aaaa·][bbbb·][cccc·][dddd]  (· = slurped trailing space)
  //   line 0: "aaaa·" (40) + "bbbb·" (40) = 80 ≤ 88 → fits; +"cccc·" overflows.
  //           ⇒ line 0 = "aaaa bbbb " (NON-LAST line).
  //   line 1: "cccc·" (40) + "dddd" (32) = 72 ≤ 88 → LAST line.
  //
  // W=88 (not 80) is deliberate: under START the merged "bbbb " run (incl. its
  // trailing space) ends at 80, SHORT of 88 — so Case 1 is genuinely RED before
  // justify. (At W=80 the trailing space would coincidentally land at the edge.)
  const W = 88;
  const TEXT = "aaaa bbbb cccc dddd";

  /** The last text-run that is NOT a pure-whitespace (trailing) run. */
  function lastGlyphRun(line: LineBox): TextRunBox {
    const runs = textRuns(line);
    for (let i = runs.length - 1; i >= 0; i--) {
      if (runs[i].text.trim().length > 0) return runs[i];
    }
    return runs[runs.length - 1];
  }

  it("Case 1: justified NON-LAST line fills the width (last glyph right edge === lineInlineSize)", () => {
    const lines = layoutPara(TEXT, W, { textAlign: "justify", whiteSpace: "normal" });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line0 = lines[0];
    const lastRun = lastGlyphRun(line0);
    // RED before impl: justify==start → last glyph run ("bbbb ", merged) ends
    // at 80, short of 88.
    expect(line0.x + lastRun.x + lastRun.width).toBe(W);
  });

  it("Case 2: interior spaces widened equally (each = natural + gap/N), runs shift", () => {
    const lines = layoutPara(TEXT, W, { textAlign: "justify", whiteSpace: "normal" });
    const line0 = lines[0];
    const runs = textRuns(line0);
    // Expected layout on line 0 (after the trailing space is split into its
    // own run): ["aaaa"][" "(interior)]["bbbb"][" "(trailing)].
    // content = 9 glyphs × 8 = 72; gap = 88 − 72 = 16; N(interior)=1 → +16.
    const interiorSpaces = runs.filter(r => r.text === " ");
    expect(interiorSpaces.length).toBeGreaterThanOrEqual(2); // 1 interior + 1 trailing
    const interior = interiorSpaces[0]; // first space = interior
    const trailing = interiorSpaces[interiorSpaces.length - 1]; // last = trailing
    const natural = CHAR_W; // 8
    const N = 1;
    const gap = W - 9 * CHAR_W; // 16
    expect(interior.width).toBe(natural + gap / N); // 24
    // Trailing space NOT stretched.
    expect(trailing.width).toBe(natural); // 8
    // The "bbbb" run shifted right by the widening (its x reflects the wider
    // interior space): "aaaa"(0..32) + interior(32..56) → "bbbb" at x=56.
    const bbbb = runs.find(r => r.text === "bbbb");
    if (!bbbb) throw new Error("expected a 'bbbb' run");
    expect(bbbb.x).toBe(4 * CHAR_W + (natural + gap / N)); // 32 + 24 = 56
  });

  it("Case 3: LAST line is NOT justified (start-aligned, ends short)", () => {
    const lines = layoutPara(TEXT, W, { textAlign: "justify", whiteSpace: "normal" });
    const last = lines[lines.length - 1];
    // Last line = "cccc dddd": 9 visible glyphs × 8 = 72, no widening.
    const lastRun = lastGlyphRun(last);
    // RED-guard: a wrongly-justified last line would push "dddd" to x=88.
    expect(last.x + lastRun.x + lastRun.width).toBe(72);
    expect(last.x + lastRun.x + lastRun.width).toBeLessThan(W);
    // The last line is NOT justified → no split: the word+space stays merged
    // ("cccc " = 40px), there is no standalone widened single-space run.
    const runs = textRuns(last);
    expect(runs.map(r => r.text)).toEqual(["cccc ", "dddd"]);
    expect(runs[0].width).toBe(5 * CHAR_W); // "cccc " = 40, space natural
  });

  it("Case 4: single-token line (no interior space) is NOT stretched", () => {
    // Width 40, text "wxyz uv": units [wxyz·][uv]. line0 "wxyz·"(40)≤40 fits,
    // +"uv"(16)=56 >40 → wrap. line0 = "wxyz " — ONE word + a TRAILING space,
    // NO interior space. A justify line with no interior space must NOT stretch
    // (start-aligned), and must NOT split the trailing space out.
    const lines = layoutPara("wxyz uv", 40, { textAlign: "justify", whiteSpace: "normal" });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line0 = lines[0];
    // No interior space → no split, no widening: the run stays merged "wxyz "
    // at start (x=0, width 40 incl. the natural trailing space).
    expect(line0.x).toBe(0);
    const runs = textRuns(line0);
    expect(runs.map(r => r.text)).toEqual(["wxyz "]);
    expect(runs[0].width).toBe(5 * CHAR_W); // 40 — unchanged
  });

  it("Case 5: trailing spaces are NOT stretched (only interior widen; trailing hangs)", () => {
    // Same as Case 2's line 0: trailing space after "bbbb" keeps natural width
    // and hangs past the filled content edge.
    const lines = layoutPara(TEXT, W, { textAlign: "justify", whiteSpace: "normal" });
    const line0 = lines[0];
    const runs = textRuns(line0);
    const trailing = runs[runs.length - 1];
    expect(trailing.text).toBe(" ");
    expect(trailing.width).toBe(CHAR_W); // natural — not stretched
    // It hangs at the filled edge (x === W), past the last glyph.
    expect(line0.x + trailing.x).toBe(W);
  });

  it("Case 6 (behavior): widened spacing flows to box.x (what caret/hit-test read)", () => {
    // cursor-position resolves an in-run caret as `leaf.absoluteX +
    // measureWidth(prefix)`, and an at-boundary caret as the NEXT leaf's
    // absoluteX. hit-test picks a leaf by `x ∈ [leaf.absoluteX, +width)`.
    // Both consume `box.x`. Assert the widened geometry lives in box.x:
    //   - the interior space box spans [32, 56) (widened by gap/N = 24),
    //   - the next word ("bbbb") box.x === 56 (so a caret BEFORE "bbbb" lands
    //     at the widened x, and a hit-test at x∈[32,56) lands inside the space).
    const lines = layoutPara(TEXT, W, { textAlign: "justify", whiteSpace: "normal" });
    const line0 = lines[0];
    const runs = textRuns(line0);
    const interior = runs.find(r => r.text === " ");
    const bbbb = runs.find(r => r.text === "bbbb");
    if (!interior || !bbbb) throw new Error("expected interior space + 'bbbb' run");
    // Interior space occupies the widened span; "bbbb" begins at its right edge.
    expect(interior.x).toBe(4 * CHAR_W);              // 32
    expect(interior.x + interior.width).toBe(bbbb.x); // 56 — contiguous
    expect(bbbb.x).toBe(56);                          // shifted by the widening
  });

  it("no-regression: non-justify content is byte-identical (start: merged word+space runs, no split)", () => {
    const start = layoutPara(TEXT, W, { textAlign: "start", whiteSpace: "normal" });
    expect(start[0].x).toBe(0);
    // Under start alignment the trailing space stays MERGED into the word run
    // (no justify split): line 0 = ["aaaa "]["bbbb "], each 40px wide, no
    // standalone single-space run.
    const runs = textRuns(start[0]);
    expect(runs.map(r => r.text)).toEqual(["aaaa ", "bbbb "]);
    expect(runs[0].x).toBe(0);
    expect(runs[0].width).toBe(5 * CHAR_W); // "aaaa " = 40
    expect(runs[1].x).toBe(5 * CHAR_W);     // 40
    expect(runs[1].width).toBe(5 * CHAR_W); // 40
  });
});
