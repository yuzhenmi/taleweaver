/**
 * P3.7 — bidi reorder × vertical writing-mode (the P4↔P3 coupling).
 *
 * VERIFY-AND-LOCK slice. The UAX #9 reorder (`reorderLineLeaves` / `renestLeaves`
 * / `withPhysicalInlineOffset`) is believed ALREADY axis-correct for vertical
 * modes because it packs the visual-order boxes into the LOGICAL `inlineOffset`
 * (never a physical-X literal), and `logicalToPhysical(inlineOffset, …,
 * writingMode, "ltr")` then maps that inline offset to the ACTIVE physical inline
 * axis: physical X for `horizontal-tb`, physical Y for both vertical modes. So the
 * character-level (writing-mode-agnostic) UAX #9 visual sequence lands on the
 * correct physical axis automatically — no reorder code change should be needed.
 *
 * These tests assert that hypothesis by COMPUTING the UAX #9 visual order by hand
 * and checking the reordered boxes' PHYSICAL coords:
 *   - h-tb: visual sequence runs along physical X (control; locked elsewhere too).
 *   - vertical-lr / vertical-rl: the SAME visual sequence runs along physical Y
 *     (the inline axis), with the block-axis line placement (physical X) handled
 *     by P3.1 — flat within a single line.
 *
 * If any assertion FAILS, a hidden physical-X assumption survived in the reorder
 * and must be generalized to the logical inline offset.
 */
import { describe, it, expect } from "vitest";
import { INITIAL_COMPUTED_STYLE } from "@taleweaver/core";
import type { WritingMode } from "@taleweaver/core";
import { computeUsedStyle } from "./used-style";
import { createTextRunBox, type LayoutBox, type TextRunBox } from "./layout-box";
import { resolveParagraphBidi } from "./ifc-bidi";
import { applyL1 } from "@taleweaver/core";
import { reorderLineLeaves } from "./ifc-bidi-reorder";
import { buildBlock, buildState, inlineContent, text } from "@taleweaver/core";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "./dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import { getLineIndex, collectLineLeaves } from "../cursor/line-flatten";
import type { State, BlockId } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "./page-config";

// ---------------------------------------------------------------------------
// Full-pipeline fixtures (render → cascade → layout → physicalize). The
// `direction` block attr is NOT wired to the cascade, so the paragraph base
// stays LTR; RTL is supplied by Hebrew CONTENT, which UAX #9 resolves to level-1
// runs — exactly the leaf level the reorder keys off. A wide page keeps each
// fixture on one line so the visual sequence is a single inline run.
// ---------------------------------------------------------------------------

const CHAR_W = 8;
const LINE_CROSS = 16;

const widePage: PageConfig = {
  pageInlineSize: 800,
  pageBlockSize: 1000,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

function bidiDoc(wm: WritingMode, content: string): State {
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        attrs: { writingMode: wm },
        firstChildId: "p",
        lastChildId: "p",
      }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        attrs: { writingMode: wm },
        inlineContent: inlineContent([text(content)]),
      }),
    ],
  });
}

function pipeline(state: State): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry()).root;
  const shaper = createMockShaper(CHAR_W, LINE_CROSS);
  const layout = positionTreeForTest(layoutTree(root, widePage.pageInlineSize, shaper, widePage));
  return { layout, shaper };
}

/** A text-run leaf flattened to the fields the assertions read (physical coords,
 *  the run's text/source/level). */
interface VisualLeaf {
  readonly text: string;
  readonly sourceStart: number | undefined;
  readonly bidiLevel: number | undefined;
  readonly absoluteX: number;
  readonly absoluteY: number;
}

/** The TEXT-RUN leaves of block "p"'s SINGLE line, in VISUAL (collection) order,
 *  with absolute physical coords. Asserts the fixture stayed on one line and that
 *  every leaf is a text-run (these fixtures carry no atomic inlines). */
function singleLineLeaves(layout: LayoutBox): VisualLeaf[] {
  const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
  expect(lines.length).toBe(1);
  const line0 = lines[0];
  if (line0 === undefined) throw new Error("expected exactly one line");
  const leaves = collectLineLeaves(line0.line, line0.absoluteX, line0.absoluteY);
  return leaves.map((l) => {
    if (l.kind !== "text-run") {
      throw new Error(`expected text-run leaf, got ${l.kind}`);
    }
    return {
      text: l.box.text,
      sourceStart: l.box.sourceStart,
      bidiLevel: l.box.bidiLevel,
      absoluteX: l.absoluteX,
      absoluteY: l.absoluteY,
    };
  });
}

describe("P3.7 vertical bidi — single embedded RTL run (Latin · Hebrew · Latin)", () => {
  // Logical "abcאבגdef": Latin "abc" (lvl0, src0), Hebrew "אבג" (lvl1, src3),
  // Latin "def" (lvl0, src6). One embedded level-1 run: UAX #9 L2 reverses it
  // INTERNALLY (paint right-to-left) but the three SEGMENTS stay in logical order
  // visually — so the by-hand VISUAL sequence by src is [0, 3, 6], the runs
  // 8px/char × 3 chars = 24px each. The DISCRIMINATING fact: that visual
  // sequence advances along physical X for h-tb but along physical Y (the inline
  // axis) for the vertical modes — with the OTHER physical axis flat within the
  // line. The bidiLevels stamp 0/1/0 in every mode (writing-mode-agnostic).
  const content = "abcאבגdef";

  it("horizontal-tb (control): visual order advances along physical X, Y flat", () => {
    const { layout } = pipeline(bidiDoc("horizontal-tb", content));
    const leaves = singleLineLeaves(layout);
    expect(leaves.map((l) => l.text)).toEqual(["abc", "אבג", "def"]);
    expect(leaves.map((l) => l.sourceStart)).toEqual([0, 3, 6]);
    expect(leaves.map((l) => l.bidiLevel)).toEqual([0, 1, 0]);
    // Visual sequence along physical X: 0, 24, 48 (each run 24px).
    expect(leaves.map((l) => l.absoluteX)).toEqual([0, 24, 48]);
    // Block axis (physical Y) flat across the single line.
    expect(leaves.map((l) => l.absoluteY)).toEqual([0, 0, 0]);
  });

  for (const wm of ["vertical-lr", "vertical-rl"] as const) {
    it(`${wm}: the SAME visual order advances along physical Y (inline axis), X flat`, () => {
      const { layout } = pipeline(bidiDoc(wm, content));
      const leaves = singleLineLeaves(layout);
      // Same logical→visual mapping, same per-leaf level (UAX #9 is
      // writing-mode-agnostic): segment order [abc, אבג, def], levels [0,1,0].
      expect(leaves.map((l) => l.text)).toEqual(["abc", "אבג", "def"]);
      expect(leaves.map((l) => l.sourceStart)).toEqual([0, 3, 6]);
      expect(leaves.map((l) => l.bidiLevel)).toEqual([0, 1, 0]);
      // The DISCRIMINATING assertion: the visual sequence now runs down physical
      // Y (the vertical inline axis) at 0, 24, 48 — IDENTICAL numbers to h-tb's X.
      // A surviving physical-X assumption would put the progression on X (and
      // collapse Y to flat 0), failing this.
      expect(leaves.map((l) => l.absoluteY)).toEqual([0, 24, 48]);
      // Block axis is physical X; flat within the single line (its concrete value
      // is the P3.1 line placement: 0 for v-lr, the block-mirror for v-rl).
      const xs = leaves.map((l) => l.absoluteX);
      expect(new Set(xs).size).toBe(1);
      if (wm === "vertical-lr") {
        expect(xs[0]).toBe(0);
      } else {
        // v-rl block-axis mirror: lines hang at the far/right physical x (> 0).
        expect(xs[0]).toBeGreaterThan(0);
      }
    });
  }
});

describe("P3.7 vertical bidi — genuine SEGMENT swap under LTR base (Latin + two Hebrew words)", () => {
  // Logical "ab אב גד": Latin "ab"(lvl0,src0), " "(lvl0,src2), then the RTL
  // stretch "אב גד" — "אב"(src3) " "(src5) "גד"(src6) — all level 1. UAX #9 L2
  // reverses that maximal level-1 run as a UNIT, so the by-hand VISUAL order
  // (ascending along the inline axis) is by src: [0, 2, 6, 5, 3]:
  //     ab · space · גד · space · אב
  // This is a TRUE reorder (the two Hebrew words swap), not a within-run flip —
  // so it discriminates a real axis-correct permutation from logical pass-through.
  // Each run is 8px/char: "ab"=16, " "=8, "גד"=16, " "=8, "אב"=16. Cumulative
  // inline starts: 0, 16, 24, 40, 48.
  const content = "ab אב גד";
  const expectedTexts = ["ab", " ", "גד", " ", "אב"];
  const expectedSrc = [0, 2, 6, 5, 3];
  const expectedLevels = [0, 0, 1, 1, 1];
  const expectedInlineStarts = [0, 16, 24, 40, 48];

  it("horizontal-tb (control): swapped visual order along physical X", () => {
    const { layout } = pipeline(bidiDoc("horizontal-tb", content));
    const leaves = singleLineLeaves(layout);
    expect(leaves.map((l) => l.text)).toEqual(expectedTexts);
    expect(leaves.map((l) => l.sourceStart)).toEqual(expectedSrc);
    expect(leaves.map((l) => l.bidiLevel)).toEqual(expectedLevels);
    expect(leaves.map((l) => l.absoluteX)).toEqual(expectedInlineStarts);
    expect(leaves.map((l) => l.absoluteY)).toEqual([0, 0, 0, 0, 0]);
  });

  for (const wm of ["vertical-lr", "vertical-rl"] as const) {
    it(`${wm}: the swapped visual order runs down physical Y (inline axis)`, () => {
      const { layout } = pipeline(bidiDoc(wm, content));
      const leaves = singleLineLeaves(layout);
      // The reorder permutation is writing-mode-agnostic: identical text/src/level
      // sequence to h-tb.
      expect(leaves.map((l) => l.text)).toEqual(expectedTexts);
      expect(leaves.map((l) => l.sourceStart)).toEqual(expectedSrc);
      expect(leaves.map((l) => l.bidiLevel)).toEqual(expectedLevels);
      // Discriminating: the swapped sequence advances down physical Y (the inline
      // axis) with the SAME cumulative starts h-tb put on X.
      expect(leaves.map((l) => l.absoluteY)).toEqual(expectedInlineStarts);
      // Block axis (physical X) flat within the single line.
      expect(new Set(leaves.map((l) => l.absoluteX)).size).toBe(1);
    });
  }
});

// ---------------------------------------------------------------------------
// Pure-reorder unit with VERTICAL boxes. The full-pipeline tests above keep the
// paragraph base LTR (no `direction` cascade attr). To exercise an RTL-BASE
// paragraph — where a level-2 Latin run genuinely MOVES relative to logical
// order AND the line content sits at the FAR inline-axis end — we call
// `reorderLineLeaves` directly with vertical-mode boxes and an RTL base. This is
// the inline-axis-generalization proof at the unit level: the packed visual
// boxes preserve `box.writingMode` (vertical) and `logicalToPhysical` maps their
// packed `inlineOffset` to physical Y.
// ---------------------------------------------------------------------------

const cs = INITIAL_COMPUTED_STYLE;
const us = computeUsedStyle(cs, 1000, "indefinite");
const REORDER_INLINE_SIZE = 1000;

function vBox(args: { text: string; offsetLength: number; inlineSize: number; sourceStart: number }): TextRunBox {
  return createTextRunBox(
    "k",
    /* inlineOffset */ 0,
    /* blockOffset */ 0,
    args.inlineSize,
    /* blockSize */ 16,
    /* writingMode */ "vertical-rl",
    /* direction */ "ltr",
    cs,
    us,
    args.text,
    args.offsetLength,
    /* containingInlineSize */ REORDER_INLINE_SIZE,
    /* sourceDisplayLengths */ undefined,
    /* clusterWidths */ new Array(args.text.length).fill(CHAR_W),
    args.sourceStart,
  );
}

function postL1Of(source: string, base: "ltr" | "rtl"): { pb: ReturnType<typeof resolveParagraphBidi>; postL1: Uint8Array } {
  const pb = resolveParagraphBidi(source, base);
  const endCp = [...source].length;
  const postL1 = applyL1(pb.levels, pb.types, pb.paragraphLevel, 0, endCp);
  return { pb, postL1 };
}

function asTextRun(box: LayoutBox): TextRunBox {
  if (box.type !== "text-run") throw new Error(`expected text-run, got ${box.type}`);
  return box;
}

describe("P3.7 vertical bidi — RTL base, genuine swap, packed onto the inline axis (pure reorder)", () => {
  it("vertical-rl RTL base 'abcאבג': Latin (lvl2) swaps after Hebrew (lvl1), packed inline-offsets map to physical Y", () => {
    // RTL paragraph: Latin "abc" embeds at level 2, Hebrew "אבג" at level 1.
    // reorderRunsByLevel([2,1]) = [1,0] — the runs SWAP. By-hand VISUAL order:
    // Hebrew first (lvl1), Latin second (lvl2). Each run is 24px.
    const source = "abcאבג";
    const { pb, postL1 } = postL1Of(source, "rtl");
    const box = vBox({ text: source, offsetLength: source.length, inlineSize: source.length * CHAR_W, sourceStart: 0 });

    const out = reorderLineLeaves([box], pb, 0, postL1, REORDER_INLINE_SIZE).map(asTextRun);

    // Visual order: Hebrew then Latin (the genuine swap).
    expect(out.map((r) => r.text)).toEqual(["אבג", "abc"]);
    expect(out.map((r) => r.bidiLevel)).toEqual([1, 2]);
    // Every reordered box PRESERVES the vertical writing-mode and is positioned
    // `direction:"ltr"` (the reorder convention — offsets are already visual).
    for (const r of out) {
      expect(r.writingMode).toBe("vertical-rl");
      expect(r.direction).toBe("ltr");
    }
    // The packing is into the LOGICAL inlineOffset, contiguous from 0.
    expect(out.map((r) => r.inlineOffset)).toEqual([0, 24]);
    // The DISCRIMINATING fact: for a vertical mode `logicalToPhysical` maps that
    // inlineOffset to physical Y (NOT X). So the visual sequence runs down Y at
    // 0, 24 — and physical X stays flat (the block axis; un-mirrored pending
    // value here, corrected by the P3.1 physicalize pass once the containing
    // block-size is known). A surviving physical-X assumption would land the
    // progression on X instead.
    expect(out.map((r) => r.y)).toEqual([0, 24]);
    expect(new Set(out.map((r) => r.x)).size).toBe(1);
  });
});
