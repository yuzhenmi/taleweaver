import { describe, it, expect } from "vitest";
import { createElementBox, createTextBox } from "@taleweaver/core";
import { cascadePass } from "@taleweaver/core";
import { createMockShaper } from "@taleweaver/core";
import { layoutInlineContent } from "./ifc";
import type { Style } from "@taleweaver/core";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { Direction } from "@taleweaver/core";
import { makeRootContext } from "./layout-context";
import type { LineBox } from "./layout-box";
import { computeAlignmentOffset, computeJustifyExpansions } from "./ifc-align";
import type { TextRunBox } from "./layout-box";

const CHAR_W = 8;
const LINE_H = 16;
const shaper = createMockShaper(CHAR_W, LINE_H);

/**
 * Bounds-checked array access for test assertions: returns `arr[i]` or throws
 * loudly if it is out of range. Under `noUncheckedIndexedAccess` this narrows
 * `T | undefined` → `T` while preserving each assertion's intent — a short or
 * empty result fails with a clear message instead of a vague TypeError.
 */
function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

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
  const result = layoutInlineContent(tree, 0, 0, ctx, shaper, undefined, 0);
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
  // Under the #333 full-width line-box model: `line.x === 0` always (the line
  // spans the full available inline size so logicalToPhysical mirrors correctly
  // under RTL). The alignment offset is carried on the CHILDREN's inlineOffset
  // (text-run.x within the line). PHYSICAL content x = line.x + textRun.x.
  const W = 200;
  const CONTENT = "hello".length * CHAR_W; // 40

  it("center (ltr): line spans full width; text-run x === (available − content) / 2", () => {
    const lines = layoutPara("hello", W, { textAlign: "center" });
    expect(lines).toHaveLength(1);
    const line0 = nth(lines, 0, "line");
    expect(line0.x).toBe(0);
    expect(line0.width).toBe(W);
    expect(nth(textRuns(line0), 0, "text-run").x).toBe((W - CONTENT) / 2); // 80
  });

  it("end (ltr): line spans full width; text-run x === available − content", () => {
    const lines = layoutPara("hello", W, { textAlign: "end" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(W - CONTENT); // 160
  });

  it("start (ltr): line.x === 0, text-run x === 0 (no regression)", () => {
    const lines = layoutPara("hello", W, { textAlign: "start" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(0);
  });

  it("default (no textAlign attr → initial 'start'): line.x === 0", () => {
    const lines = layoutPara("hello", W, {});
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(0);
  });

  it("justify in P2 behaves as start: line.x === 0, text-run x === 0", () => {
    const lines = layoutPara("hello", W, { textAlign: "justify" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(0);
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
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe((W - visible) / 2); // 92
  });

  it("center of a no-trailing-space line uses full content width", () => {
    const content = "hi".length * CHAR_W; // 16
    const lines = layoutPara("hi", W, { textAlign: "center", whiteSpace: "pre-wrap" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe((W - content) / 2); // 92
  });
});

describe("IFC alignment — break-spaces multi-trailing-space exclusion (#339)", () => {
  // Under `break-spaces` (the editor default) each trailing space is its OWN
  // wrap unit, so a line ending in N trailing spaces has N standalone space
  // units after the word unit. `trailingSpaceWidthOf` must sum the trailing RUN
  // of space units, not just the last unit. Before the fix it excluded only the
  // LAST unit's trailing space (1 of N) → centered/right/justified lines shifted
  // off by (N−1) spaces of content over-count.
  const W = 200;
  const WORD_W = "word".length * CHAR_W; // 32 (visible content)

  it("center: 3 trailing spaces fully excluded (RED before — only 1 was excluded)", () => {
    // "word   " — 4 visible chars + 3 trailing spaces. Centered by the visible
    // 32px only. Correct text-run x = (200 − 32)/2 = 84. Before #339 only 1
    // trailing space was excluded → contentWidth 56 → x = (200 − 56)/2 = 72.
    const lines = layoutPara("word   ", W, { textAlign: "center", whiteSpace: "break-spaces" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe((W - WORD_W) / 2); // 84
  });

  it("end (ltr): 3 trailing spaces fully excluded", () => {
    // Right-aligned: text-run x = available − visibleContentWidth = 200 − 32 = 168.
    const lines = layoutPara("word   ", W, { textAlign: "end", whiteSpace: "break-spaces" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(W - WORD_W); // 168
  });

  it("justify NON-LAST line: interior space widened by the FULL-trailing-exclusion gap", () => {
    // break-spaces "aa bb   cc" at W=72.
    //   tokens: aa(16) ·(8) bb(16) ·(8) ·(8) ·(8) cc(16)
    //   units (each its own under break-spaces):
    //     [aa][·][bb][·][·][·][cc]
    //   Spaces never trigger a wrap (#338 hang); only words do. After pushing
    //   aa·bb·· · (currentWidth = 64 ≤ 72) the word "cc" overflows (64+16=80>72)
    //   → wrap. So line 0 = "aa bb   " (NON-LAST → justified), line 1 = "cc".
    //
    //   contentWidth = currentWidth − trailingSpaceWidthOf
    //     correct: 64 − 24 (all 3 trailing spaces) = 40 → gap = 72 − 40 = 32.
    //     buggy:   64 − 8  (only the last space)   = 56 → gap = 72 − 56 = 16.
    //   1 interior space (between aa and bb) absorbs the whole gap:
    //     correct interior width = 8 + 32 = 40; buggy = 8 + 16 = 24.
    const Wj = 72;
    const lines = layoutPara("aa bb   cc", Wj, { textAlign: "justify", whiteSpace: "break-spaces" });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line0 = nth(lines, 0, "line");
    const runs = textRuns(line0);
    // The interior space is the FIRST single-space run (between aa and bb); the
    // trailing spaces clamp to 0 at the content edge (#338 P2), so the first " "
    // run with non-zero width is the widened interior one.
    const spaceRuns = runs.filter(r => r.text === " ");
    const interior = nth(spaceRuns, 0, "space run");
    expect(interior.width).toBe(CHAR_W + (Wj - 40)); // 8 + 32 = 40
    // "bb" reaches the filled content edge: aa(16) + interior(40) + bb(16) = 72.
    const bb = runs.find(r => r.text === "bb");
    if (!bb) throw new Error("expected a 'bb' run");
    expect(line0.x + bb.x + bb.width).toBe(Wj); // 72 — last glyph at the edge
  });

  it("no-regression: break-spaces ONE trailing space centered (unchanged)", () => {
    // "word " — 1 trailing space. Both old and new exclude exactly that one
    // space → text-run x = (200 − 32)/2 = 84, unchanged.
    const lines = layoutPara("word ", W, { textAlign: "center", whiteSpace: "break-spaces" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe((W - WORD_W) / 2); // 84
  });

  it("no-regression: break-spaces NO trailing space centered uses full width", () => {
    const lines = layoutPara("word", W, { textAlign: "center", whiteSpace: "break-spaces" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe((W - WORD_W) / 2); // 84
  });

  it("no-regression: normal-mode single slurped trailing space centered (unchanged)", () => {
    // Under `normal` the trailing space is SLURPED into the word's unit
    // ([word, space]); the new walk sums that one space then stops at the word —
    // identical to before. "word " centered by visible 32px → text-run x = 84.
    const lines = layoutPara("word ", W, { textAlign: "center", whiteSpace: "normal" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe((W - WORD_W) / 2); // 84
  });
});

describe("IFC alignment — strut (empty paragraph)", () => {
  const W = 200;

  // #333: an empty paragraph emits a LineBox spanning the full available
  // inline size at the natural inline-start, plus a single zero-width STRUT
  // child whose `inlineOffset` carries the alignment delta. Caret/selection
  // consumers walk `line.children` (post-#172/#208 LineBox-canonical), so the
  // strut leaf provides the empty-line caret anchor at the correct physical x.

  it("center strut: line spans full width; strut child x === available / 2 (caret centered)", () => {
    const lines = layoutPara("", W, { textAlign: "center" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(lines, 0, "line").children).toHaveLength(1); // one zero-width strut child
    const strut = nth(nth(lines, 0, "line").children, 0, "strut");
    expect(strut.type).toBe("text-run");
    expect(strut.width).toBe(0);
    expect(strut.x).toBe(W / 2); // 100 — caret anchor
  });

  it("end strut: line spans full width; strut child x === available (caret at right edge)", () => {
    const lines = layoutPara("", W, { textAlign: "end" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(lines, 0, "line").children).toHaveLength(1);
    expect(nth(nth(lines, 0, "line").children, 0, "strut").x).toBe(W); // 200
  });

  it("start strut: line.x === 0; strut child x === 0 (no regression)", () => {
    const lines = layoutPara("", W, { textAlign: "start" });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(lines, 0, "line").children).toHaveLength(1);
    expect(nth(nth(lines, 0, "line").children, 0, "strut").x).toBe(0);
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

    // Both lines span the full inline size at the natural inline-start; their
    // CONTENT is centered via the first text-run's x within each line.
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(lines, 1, "line").x).toBe(0);

    // Line 0: trailing space EXCLUDED → centered by visible 9 chars = 72px:
    // text-run x = (80 − 72)/2 = 4.
    const l0Run = nth(textRuns(nth(lines, 0, "line")), 0, "text-run");
    expect(l0Run.x).toBe((W - 9 * CHAR_W) / 2); // 4

    // Line 1 ("cccc"): no trailing space → centered by full 32px:
    // text-run x = (80 − 32)/2 = 24.
    const l1Run = nth(textRuns(nth(lines, 1, "line")), 0, "text-run");
    expect(l1Run.x).toBe((W - 4 * CHAR_W) / 2); // 24

    // Independent per-line centering: a GLOBAL block shift would give both lines
    // the same content x. They differ because each is centered by its own width.
    expect(l0Run.x).not.toBe(l1Run.x);
  });
});

describe("IFC alignment — RTL (#333)", () => {
  // Under the #333 full-width model the alignment offset rides on the
  // CHILDREN's `inlineOffset` (not on the line itself). The line spans the full
  // available inline size and `logicalToPhysical` mirrors the inline axis under
  // RTL, so the physical position of content correctly inverts: RTL end →
  // visual LEFT, RTL center → centered, RTL start → visual RIGHT.
  const W = 200;
  const CONTENT = "hello".length * CHAR_W; // 40
  const GAP = W - CONTENT; // 160

  it("start under rtl: content at visual right edge (no regression)", () => {
    const lines = layoutPara("hello", W, { textAlign: "start" }, "rtl");
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    // RTL start: alignmentOffset = 0; child's logical inlineOffset = 0,
    // inlineSize = CONTENT. Physical x = lineInlineSize − 0 − CONTENT = GAP.
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(GAP); // 160 — visual right
  });

  it("end under rtl: content at visual LEFT edge", () => {
    const lines = layoutPara("hello", W, { textAlign: "end" }, "rtl");
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    // RTL end: alignmentOffset = GAP (logical end of the line). Child's logical
    // inlineOffset = GAP, inlineSize = CONTENT. Physical x =
    // lineInlineSize − GAP − CONTENT = W − GAP − CONTENT = 0 (visual LEFT).
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(0);
  });

  it("center under rtl: content centered", () => {
    const lines = layoutPara("hello", W, { textAlign: "center" }, "rtl");
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    // RTL center: alignmentOffset = GAP/2 = 80. Child's logical inlineOffset =
    // GAP/2 = 80, inlineSize = CONTENT = 40. Physical x = W − 80 − 40 = 80
    // (= GAP/2, the centered left edge).
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(GAP / 2); // 80
  });

  it("strut (empty rtl paragraph) end: strut child at visual LEFT (caret left)", () => {
    const lines = layoutPara("", W, { textAlign: "end" }, "rtl");
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(0);
    expect(nth(lines, 0, "line").children).toHaveLength(1);
    // RTL end strut: alignmentOffset = W. Strut.inlineOffset = W,
    // inlineSize = 0. Physical x = W − W − 0 = 0 (visual left).
    expect(nth(nth(lines, 0, "line").children, 0, "strut").x).toBe(0);
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
    const r1 = layoutInlineContent(startTree, 0, 0, ctx, shaper, undefined, 0);
    if (r1.box === null) throw new Error("null box");
    const l1 = r1.box.children.filter((c): c is LineBox => c.type === "line");
    expect(nth(l1, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(l1, 0, "line")), 0, "text-run").x).toBe(0); // start-aligned text-run at line origin

    // Pass 2: SAME key, SAME tokens, SAME width — only textAlign flips to
    // center. The cache entry for "p" exists; the fix must reject it because
    // textAlign differs and re-align the line.
    const centerTree = cascadePass(
      createElementBox("p", { display: "block", textAlign: "center" }, [
        createTextBox("t", {}, "hello"),
      ]),
    );
    if (centerTree.type !== "element") throw new Error("expected element");
    const r2 = layoutInlineContent(centerTree, 0, 0, ctx, shaper, undefined, 0);
    if (r2.box === null) throw new Error("null box");
    const l2 = r2.box.children.filter((c): c is LineBox => c.type === "line");
    // RE-ALIGNED, not stale: under the #333 full-width model the line still
    // spans the full width (x=0), but the text-run carries the centered offset.
    expect(nth(l2, 0, "line").x).toBe(0);
    expect(nth(textRuns(nth(l2, 0, "line")), 0, "text-run").x).toBe((W - CONTENT) / 2); // 80
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
    expect(nth(exp, 0)).toBeGreaterThanOrEqual(nth(exp, 2));
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
    expect(nth(exp, 0)).toBeGreaterThanOrEqual(nth(exp, 1));
  });

  it("normal fractional gap sums EXACTLY with leading-spaces-get-more ordering", () => {
    // gap 10.5 across 3 spaces → base 3, the 1.5 residual folds into the first
    // space: [4.5, 3, 3]. Sum === 10.5 exactly.
    const exp = computeJustifyExpansions(10.5, 3);
    expect(exp).toHaveLength(3);
    expect(exp.reduce((s, e) => s + e, 0)).toBe(10.5);
    // Leading space absorbs the residual → out[0] >= the trailing ones.
    expect(nth(exp, 0)).toBeGreaterThanOrEqual(nth(exp, 1));
    expect(nth(exp, 1)).toBeGreaterThanOrEqual(nth(exp, 2));
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
      const run = nth(runs, i, "text-run");
      if (run.text.trim().length > 0) return run;
    }
    return nth(runs, runs.length - 1, "text-run");
  }

  it("Case 1: justified NON-LAST line fills the width (last glyph right edge === lineInlineSize)", () => {
    const lines = layoutPara(TEXT, W, { textAlign: "justify", whiteSpace: "normal" });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line0 = nth(lines, 0, "line");
    const lastRun = lastGlyphRun(line0);
    // RED before impl: justify==start → last glyph run ("bbbb ", merged) ends
    // at 80, short of 88.
    expect(line0.x + lastRun.x + lastRun.width).toBe(W);
  });

  it("Case 2: interior spaces widened equally (each = natural + gap/N), runs shift", () => {
    const lines = layoutPara(TEXT, W, { textAlign: "justify", whiteSpace: "normal" });
    const line0 = nth(lines, 0, "line");
    const runs = textRuns(line0);
    // Expected layout on line 0 (after the trailing space is split into its
    // own run): ["aaaa"][" "(interior)]["bbbb"][" "(trailing)].
    // content = 9 glyphs × 8 = 72; gap = 88 − 72 = 16; N(interior)=1 → +16.
    const interiorSpaces = runs.filter(r => r.text === " ");
    expect(interiorSpaces.length).toBeGreaterThanOrEqual(2); // 1 interior + 1 trailing
    const interior = nth(interiorSpaces, 0, "interior space"); // first space = interior
    const trailing = nth(interiorSpaces, interiorSpaces.length - 1, "trailing space"); // last = trailing
    const natural = CHAR_W; // 8
    const N = 1;
    const gap = W - 9 * CHAR_W; // 16
    expect(interior.width).toBe(natural + gap / N); // 24
    // Trailing space NOT stretched, AND #338 P2 clamps it to width 0 at the
    // filled content edge (it sits exactly at lineInlineSize → clampedWidth =
    // max(0, min(8, W − W)) = 0). It stays on-page (no glyph past the edge); its
    // 1 state offset is unchanged.
    expect(trailing.width).toBe(0);
    // The "bbbb" run shifted right by the widening (its x reflects the wider
    // interior space): "aaaa"(0..32) + interior(32..56) → "bbbb" at x=56.
    const bbbb = runs.find(r => r.text === "bbbb");
    if (!bbbb) throw new Error("expected a 'bbbb' run");
    expect(bbbb.x).toBe(4 * CHAR_W + (natural + gap / N)); // 32 + 24 = 56
  });

  it("Case 3: LAST line is NOT justified (start-aligned, ends short)", () => {
    const lines = layoutPara(TEXT, W, { textAlign: "justify", whiteSpace: "normal" });
    const last = nth(lines, lines.length - 1, "line");
    // Last line = "cccc dddd": 9 visible glyphs × 8 = 72, no widening.
    const lastRun = lastGlyphRun(last);
    // RED-guard: a wrongly-justified last line would push "dddd" to x=88.
    expect(last.x + lastRun.x + lastRun.width).toBe(72);
    expect(last.x + lastRun.x + lastRun.width).toBeLessThan(W);
    // The last line is NOT justified → no split: the word+space stays merged
    // ("cccc " = 40px), there is no standalone widened single-space run.
    const runs = textRuns(last);
    expect(runs.map(r => r.text)).toEqual(["cccc ", "dddd"]);
    expect(nth(runs, 0, "text-run").width).toBe(5 * CHAR_W); // "cccc " = 40, space natural
  });

  it("Case 4: single-token line (no interior space) is NOT stretched", () => {
    // Width 40, text "wxyz uv": units [wxyz·][uv]. line0 "wxyz·"(40)≤40 fits,
    // +"uv"(16)=56 >40 → wrap. line0 = "wxyz " — ONE word + a TRAILING space,
    // NO interior space. A justify line with no interior space must NOT stretch
    // (start-aligned), and must NOT split the trailing space out.
    const lines = layoutPara("wxyz uv", 40, { textAlign: "justify", whiteSpace: "normal" });
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line0 = nth(lines, 0, "line");
    // No interior space → no split, no widening: the run stays merged "wxyz "
    // at start (x=0, width 40 incl. the natural trailing space).
    expect(line0.x).toBe(0);
    const runs = textRuns(line0);
    expect(runs.map(r => r.text)).toEqual(["wxyz "]);
    expect(nth(runs, 0, "text-run").width).toBe(5 * CHAR_W); // 40 — unchanged
  });

  it("Case 5: trailing spaces are NOT stretched, and clamp to the filled content edge (#338 P2 on-page)", () => {
    // Same as Case 2's line 0: the trailing space after "bbbb" is NOT stretched
    // by justify (only interior spaces widen). It hangs at the filled content
    // edge — and #338 P2 clamps its physical width to 0 at the edge so nothing
    // draws past it (the on-page guarantee). Its box start sits exactly at the
    // edge (x === W).
    const lines = layoutPara(TEXT, W, { textAlign: "justify", whiteSpace: "normal" });
    const line0 = nth(lines, 0, "line");
    const runs = textRuns(line0);
    const trailing = nth(runs, runs.length - 1, "trailing run");
    expect(trailing.text).toBe(" ");
    // Clamped: width 0 at the edge (not the natural 8 → no glyph past the edge).
    expect(trailing.width).toBe(0);
    // It hangs at the filled edge (x === W), past the last glyph; with width 0
    // the box's right edge is exactly W (on-page).
    expect(line0.x + trailing.x).toBe(W);
    expect(line0.x + trailing.x + trailing.width).toBe(W);
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
    const line0 = nth(lines, 0, "line");
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
    expect(nth(start, 0, "line").x).toBe(0);
    // Under start alignment the trailing space stays MERGED into the word run
    // (no justify split): line 0 = ["aaaa "]["bbbb "], each 40px wide, no
    // standalone single-space run.
    const runs = textRuns(nth(start, 0, "line"));
    expect(runs.map(r => r.text)).toEqual(["aaaa ", "bbbb "]);
    expect(nth(runs, 0, "text-run").x).toBe(0);
    expect(nth(runs, 0, "text-run").width).toBe(5 * CHAR_W); // "aaaa " = 40
    expect(nth(runs, 1, "text-run").x).toBe(5 * CHAR_W);     // 40
    expect(nth(runs, 1, "text-run").width).toBe(5 * CHAR_W); // 40
  });
});

describe("IFC text-indent (CSS Text §8 first-line indent)", () => {
  // `text-indent` indents the FIRST line of the block only (logical inline-start),
  // and consumes that line's available width (so wrapping accounts for it).
  // Subsequent lines are unchanged. The first line's LineBox carries the indent
  // on its inline-start: under the #333 full-width model `line.x` (LTR physical)
  // == inlineOffset + textIndent and `line.width` shrinks by textIndent. The
  // start-aligned text-run sits at the line origin (run.x === 0), so the visible
  // content begins at `line.x` (= the indent).

  it("positive: first line content starts at inlineStart + textIndent; wrapped 2nd line at inlineStart", () => {
    // "aaaa bbbb" = 9 glyphs (72px). W=80 fits it on ONE line WITHOUT indent.
    // With textIndent=40 the first line's available width = 80 − 40 = 40:
    //   "aaaa " (40) fits; "bbbb" (32) overflows (40+32 > 40) → wraps.
    // ⇒ line 0 = "aaaa " indented by 40; line 1 = "bbbb" at the natural start.
    const lines = layoutPara("aaaa bbbb", 80, { textIndent: { value: 40, unit: "px" } });
    expect(lines).toHaveLength(2);

    // First line: shifted inline-start by the indent, width reduced by it.
    expect(nth(lines, 0, "line").x).toBe(40);
    expect(nth(lines, 0, "line").width).toBe(80 - 40);
    // start-aligned text-run at the line origin → visible content at x = 40.
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(0);
    expect(nth(lines, 0, "line").x + nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(40);

    // Second (wrapped) line: NO indent — natural inline-start, full width.
    expect(nth(lines, 1, "line").x).toBe(0);
    expect(nth(lines, 1, "line").width).toBe(80);
    expect(nth(textRuns(nth(lines, 1, "line")), 0, "text-run").x).toBe(0);
  });

  it("reduces first-line available width: a word that fits WITHOUT the indent wraps WITH it", () => {
    // "aaaa bbbb" (72px) fits W=80 on ONE line at textIndent 0.
    const noIndent = layoutPara("aaaa bbbb", 80, {});
    expect(noIndent).toHaveLength(1);

    // The SAME text, same width, with a 16px indent: first-line available = 64.
    // "aaaa " (40) fits; "bbbb" (32) overflows (40+32 > 64? no — 72 > 64 yes) →
    // wraps. The indent alone forces the second line.
    const withIndent = layoutPara("aaaa bbbb", 80, { textIndent: { value: 16, unit: "px" } });
    expect(withIndent).toHaveLength(2);
    expect(nth(withIndent, 0, "line").x).toBe(16);
    expect(nth(withIndent, 0, "line").width).toBe(80 - 16);
  });

  it("negative (hanging indent): first line starts BEFORE the content edge (no clamping)", () => {
    // textIndent −16 → first line's inline-start at −16 (CSS permits negative).
    const lines = layoutPara("hello", 200, { textIndent: { value: -16, unit: "px" } });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(-16);
    // Available width GROWS by the (negative) indent: 200 − (−16) = 216.
    expect(nth(lines, 0, "line").width).toBe(216);
    expect(nth(lines, 0, "line").x + nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(-16);
  });

  it("textIndent 0 (default): byte-identical to baseline (no regression)", () => {
    const lines = layoutPara("hello", 200, { textIndent: { value: 0, unit: "px" } });
    const baseline = layoutPara("hello", 200, {});
    expect(lines).toHaveLength(1);
    expect(baseline).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(nth(baseline, 0, "line").x); // 0
    expect(nth(lines, 0, "line").width).toBe(nth(baseline, 0, "line").width); // 200
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(nth(textRuns(nth(baseline, 0, "line")), 0, "text-run").x); // 0
  });

  it("single-line / empty block: the ONLY line is the first line ⇒ indented", () => {
    // Single short line.
    const single = layoutPara("hi", 200, { textIndent: { value: 24, unit: "px" } });
    expect(single).toHaveLength(1);
    expect(nth(single, 0, "line").x).toBe(24);
    expect(nth(single, 0, "line").width).toBe(200 - 24);

    // Empty paragraph (strut): the strut line is the first line ⇒ indented; the
    // empty-line caret anchor sits at the indented start (start-aligned).
    const empty = layoutPara("", 200, { textIndent: { value: 24, unit: "px" } });
    expect(empty).toHaveLength(1);
    const emptyLine = nth(empty, 0, "line");
    expect(emptyLine.x).toBe(24);
    expect(emptyLine.width).toBe(200 - 24);
    expect(emptyLine.children).toHaveLength(1);
    expect(emptyLine.x + nth(emptyLine.children, 0, "strut").x).toBe(24); // caret at indented start
  });

  it("composes with text-align (center): alignment distributes the POST-indent remaining space (no double-count)", () => {
    // "hello" = 40px content, W=200, indent=40. The indent is applied BEFORE
    // alignment: first line is shifted by the indent (line.x = 40) and its width
    // reduced by it (160); centering then offsets the run WITHIN that reduced
    // line (run.x = (160 − 40)/2 = 60). Physical content x = 40 + 60 = 100 =
    // indent + (W − indent − content)/2 — the indent is counted exactly once.
    const W = 200;
    const CONTENT = "hello".length * CHAR_W; // 40
    const INDENT = 40;
    const lines = layoutPara("hello", W, {
      textAlign: "center",
      textIndent: { value: INDENT, unit: "px" },
    });
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").x).toBe(INDENT); // line shifted by the indent
    expect(nth(lines, 0, "line").width).toBe(W - INDENT); // width reduced by the indent
    // Centering within the reduced-width line, NOT the full width:
    expect(nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe((W - INDENT - CONTENT) / 2); // 60
    // Physical content position = indent applied once, then centered:
    expect(nth(lines, 0, "line").x + nth(textRuns(nth(lines, 0, "line")), 0, "text-run").x).toBe(
      INDENT + (W - INDENT - CONTENT) / 2,
    ); // 100
  });

  it("wrap-cache rejects stale lines when ONLY textIndent changes (re-lays the first line)", () => {
    // Re-lay the SAME paragraph (same tokens, width, align, direction) through
    // the SAME LayoutContext, changing ONLY textIndent. The first layout
    // populates the IFC wrap-cache; the second must NOT return the stale
    // (un-indented) first line but re-lay it with the indent. Parallels the
    // textAlign cache-invalidation gate.
    const W = 200;
    const ctx = makeRootContext(INITIAL_COMPUTED_STYLE, W);

    const noIndentTree = cascadePass(
      createElementBox("p", { display: "block" }, [createTextBox("t", {}, "hello")]),
    );
    if (noIndentTree.type !== "element") throw new Error("expected element");
    const r1 = layoutInlineContent(noIndentTree, 0, 0, ctx, shaper, undefined, 0);
    if (r1.box === null) throw new Error("null box");
    const l1 = r1.box.children.filter((c): c is LineBox => c.type === "line");
    expect(nth(l1, 0, "line").x).toBe(0); // un-indented, populates cache for "p"

    // SAME key/tokens/width — only textIndent flips to 32. The cache entry for
    // "p" exists; the gate must reject it (textIndent differs) and re-lay.
    const indentTree = cascadePass(
      createElementBox("p", { display: "block", textIndent: { value: 32, unit: "px" } }, [
        createTextBox("t", {}, "hello"),
      ]),
    );
    if (indentTree.type !== "element") throw new Error("expected element");
    const r2 = layoutInlineContent(indentTree, 0, 0, ctx, shaper, undefined, 0);
    if (r2.box === null) throw new Error("null box");
    const l2 = r2.box.children.filter((c): c is LineBox => c.type === "line");
    expect(nth(l2, 0, "line").x).toBe(32); // RE-LAID with the indent, not the stale x=0
    expect(nth(l2, 0, "line").width).toBe(W - 32);
  });

  it("RTL: indent rides the LOGICAL inline-start (first line's logical inlineOffset shifts)", () => {
    // The indent is logical (inline-start), so under RTL it composes with the
    // logical axis with no physical-left/right special-casing. The first line's
    // LOGICAL inlineOffset == textIndent and its inline size shrinks by it.
    const lines = layoutPara("hello", 200, { textIndent: { value: 40, unit: "px" } }, "rtl");
    expect(lines).toHaveLength(1);
    expect(nth(lines, 0, "line").inlineOffset).toBe(40); // logical inline-start shift
    expect(nth(lines, 0, "line").inlineSize).toBe(200 - 40);
  });
});
