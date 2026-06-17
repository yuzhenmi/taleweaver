import { describe, it, expect } from "vitest";
import { moveToLine, moveToLineBoundary } from "./line-navigation";
import { resolvePixelPosition } from "./cursor-position";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import { createPosition } from "@taleweaver/core";
import type { BlockId, State } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import type { PageConfig } from "../layout/page-config";
import type { WritingMode } from "@taleweaver/core";
import { getLineIndex } from "./line-flatten";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

function pipeline(
  state: State,
  containerInlineSize: number = 800,
): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper = createMockShaper(8, 16);
  const layout = positionTreeForTest(layoutTree(root, containerInlineSize, shaper, undefined));
  return { layout, shaper };
}

/** Build a single-paragraph doc that soft-wraps to multiple lines. */
function softWrappingState(): State {
  // 800px container, 8px/char → ~100 chars/line. Use 25-char prefix.
  let s = "";
  for (let i = 0; i < 20; i++) s += "abcdefghi "; // 200 chars
  return buildState({
    rootId: "doc",
    blocks: [
      buildBlock({
        id: "doc",
        type: "document",
        firstChildId: "p",
        lastChildId: "p",
      }),
      buildBlock({
        id: "p",
        type: "paragraph",
        parentId: "doc",
        inlineContent: inlineContent([text(s)]),
      }),
    ],
  });
}

describe("moveToLine (new)", () => {
  it("moves down from line 0 to line 1, preserving x", () => {
    const state = softWrappingState();
    const { layout, shaper } = pipeline(state, 800);
    const pos = createPosition("p" as BlockId, 5); // line 0, x=40
    const result = moveToLine(state, pos, layout, shaper, "down", null);
    expect(result).not.toBeNull();
    if (result === null) return;
    // New position should be in p (same block) on a later line.
    expect(result.position.blockId).toBe("p");
    expect(result.position.offset).toBeGreaterThan(5);
    expect(result.targetX).toBe(40);
  });

  it("moves up from line 1 to line 0", () => {
    const state = softWrappingState();
    const { layout, shaper } = pipeline(state, 800);
    const pos = createPosition("p" as BlockId, 105); // line 1
    const result = moveToLine(state, pos, layout, shaper, "up", null);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.position.blockId).toBe("p");
    expect(result.position.offset).toBeLessThan(105);
  });

  it("ArrowUp landing on a soft-wrap line-END offset threads 'before' affinity so the caret renders on the PRIOR line (#500)", () => {
    // Single-column generalization of #500. The line-0↔line-1 soft-wrap boundary
    // offset is SHARED (line0.end === line1.start). When an ArrowUp lands ON that
    // offset (goal-x at line 0's right edge), only the affinity disambiguates which
    // visual line the caret renders on: the move must thread `caretAffinity:
    // "before"` so `resolvePixelPosition` resolves it onto LINE 0 (the line stepped
    // onto), not line 1. Without the threading the default ("after") prefers line
    // 1's start (`resolvePositionInOwnLines` soft-wrap rule) — the boundary caret
    // would render a row too low, the single-column face of the multicol no-op bug.
    const state = softWrappingState();
    const { layout, shaper } = pipeline(state, 800);
    const lines = getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line0 = nth(lines, 0, "line0");
    const line1 = nth(lines, 1, "line1");
    expect(line1.line.inlineOffsetStart).toBe(line0.line.inlineOffsetEnd);
    // ArrowUp from a MIDDLE line-1 offset, goal-x past line 0's right edge so it
    // clamps to line 0's END — the shared boundary offset.
    const pos = createPosition("p" as BlockId, line1.line.inlineOffsetStart + 3);
    const farRightGoalX = 100_000;
    const result = moveToLine(state, pos, layout, shaper, "up", farRightGoalX);
    expect(result).not.toBeNull();
    if (result === null) return;
    // Landed on the shared boundary offset (line0.end), threaded affinity "before"
    // → resolves onto LINE 0's y-band, not line 1's. (The bug → affinity unset →
    // "after" → line 1.)
    expect(result.position.offset).toBe(line0.line.inlineOffsetEnd);
    expect(result.caretAffinity).toBe("before");
    const pixel = resolvePixelPosition(state, result.position, layout, shaper, undefined, result.caretAffinity);
    expect(pixel).not.toBeNull();
    if (pixel === null) return;
    expect(pixel.y).toBe(line0.absoluteY);
    expect(pixel.y).toBeLessThan(line1.absoluteY);
  });

  it("moves down across a paragraph break", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p1",
          lastChildId: "p2",
        }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("hello")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "p1",
          inlineContent: inlineContent([text("world")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    const pos = createPosition("p1" as BlockId, 2);
    const result = moveToLine(state, pos, layout, shaper, "down", null);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.position.blockId).toBe("p2");
  });

  it("ArrowDown into an empty paragraph lands at offset 0 of that paragraph", () => {
    // Structure: [A] / [empty] / [B]. Cursor on A; ArrowDown should land at
    // offset 0 of the empty paragraph (not fall through to B). See #170 and
    // the line-nav bug.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "pA",
          lastChildId: "pB",
        }),
        buildBlock({
          id: "pA",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "pEmpty",
          inlineContent: inlineContent([text("A")]),
        }),
        buildBlock({
          id: "pEmpty",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pA",
          nextSiblingId: "pB",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "pB",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pEmpty",
          inlineContent: inlineContent([text("B")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    const pos = createPosition("pA" as BlockId, 1);
    const result = moveToLine(state, pos, layout, shaper, "down", null);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.position.blockId).toBe("pEmpty");
    expect(result.position.offset).toBe(0);
  });

  it("ArrowUp into an empty paragraph lands at offset 0 of that paragraph", () => {
    // Same structure; cursor on B at offset 1; ArrowUp lands on the empty.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "pA",
          lastChildId: "pB",
        }),
        buildBlock({
          id: "pA",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "pEmpty",
          inlineContent: inlineContent([text("A")]),
        }),
        buildBlock({
          id: "pEmpty",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pA",
          nextSiblingId: "pB",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "pB",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pEmpty",
          inlineContent: inlineContent([text("B")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    const pos = createPosition("pB" as BlockId, 1);
    const result = moveToLine(state, pos, layout, shaper, "up", null);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.position.blockId).toBe("pEmpty");
    expect(result.position.offset).toBe(0);
  });

  it("multi-empty: ArrowUp steps through each empty paragraph in turn", () => {
    // Structure: [A] / [empty1] / [empty2] / [B]. Cursor at B:1.
    // ArrowUp 1 → empty2:0; ArrowUp 2 → empty1:0; ArrowUp 3 → in A.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "pA",
          lastChildId: "pB",
        }),
        buildBlock({
          id: "pA",
          type: "paragraph",
          parentId: "doc",
          nextSiblingId: "pE1",
          inlineContent: inlineContent([text("A")]),
        }),
        buildBlock({
          id: "pE1",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pA",
          nextSiblingId: "pE2",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "pE2",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pE1",
          nextSiblingId: "pB",
          inlineContent: inlineContent([]),
        }),
        buildBlock({
          id: "pB",
          type: "paragraph",
          parentId: "doc",
          prevSiblingId: "pE2",
          inlineContent: inlineContent([text("B")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);

    const step1 = moveToLine(
      state,
      createPosition("pB" as BlockId, 1),
      layout,
      shaper,
      "up",
      null,
    );
    expect(step1).not.toBeNull();
    if (step1 === null) return;
    expect(step1.position.blockId).toBe("pE2");
    expect(step1.position.offset).toBe(0);

    const step2 = moveToLine(state, step1.position, layout, shaper, "up", step1.targetX);
    expect(step2).not.toBeNull();
    if (step2 === null) return;
    expect(step2.position.blockId).toBe("pE1");
    expect(step2.position.offset).toBe(0);

    const step3 = moveToLine(state, step2.position, layout, shaper, "up", step2.targetX);
    expect(step3).not.toBeNull();
    if (step3 === null) return;
    expect(step3.position.blockId).toBe("pA");
  });

  it("at last line moving down returns end-of-doc (last block, max offset)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p",
          lastChildId: "p",
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    const pos = createPosition("p" as BlockId, 2);
    const result = moveToLine(state, pos, layout, shaper, "down", null);
    // Legacy fallback: at last line going down → position at end of doc.
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.position.blockId).toBe("p");
    expect(result.position.offset).toBe(5); // end of "hello"
  });
});

describe("moveToLineBoundary (new)", () => {
  it("returns offset at line start (Home)", () => {
    const state = softWrappingState();
    const { layout, shaper } = pipeline(state, 800);
    const pos = createPosition("p" as BlockId, 50); // mid line 0
    const result = moveToLineBoundary(state, pos, layout, shaper, "start");
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("p");
    // Line 0 starts at offset 0.
    expect(result.offset).toBe(0);
  });

  it("Home/End on a wrapped MIDDLE line go to the VISUAL-line boundary, not the block boundary", () => {
    // 300 chars at 8px/char in an 800px container → 3 visual lines
    // (~100 chars/line). The MIDDLE line (line 1) is the discriminating
    // case: a block-boundary implementation would return 0 (Home) / 300
    // (End); a correct visual-line implementation returns the line-1 seam.
    let s = "";
    for (let i = 0; i < 30; i++) s += "abcdefghi "; // 300 chars, 3 lines
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text(s)]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state, 800);
    const at = (o: number) => createPosition("p" as BlockId, o);
    const homeOf = (o: number) => moveToLineBoundary(state, at(o), layout, shaper, "start");
    const endOf = (o: number) => moveToLineBoundary(state, at(o), layout, shaper, "end");

    // Two carets safely inside line 1 (between ~100 and ~200).
    const home150 = homeOf(150);
    const end150 = endOf(150);
    expect(home150).not.toBeNull();
    expect(end150).not.toBeNull();
    if (home150 === null || end150 === null) return;

    // Home does NOT collapse to block start (0); End does NOT run to block end (300).
    expect(home150.offset).toBeGreaterThan(0);
    expect(home150.offset).toBeLessThanOrEqual(150);
    expect(end150.offset).toBeLessThan(300);
    expect(end150.offset).toBeGreaterThanOrEqual(150);

    // Stable across carets on the SAME visual line.
    expect(homeOf(130)?.offset).toBe(home150.offset);
    expect(endOf(130)?.offset).toBe(end150.offset);

    // Distinct from line 0: a caret on line 0 (offset 40) homes to block start
    // 0, while line 1's home (asserted > 0 above) is a DIFFERENT, later seam.
    expect(homeOf(40)?.offset).toBe(0);
  });

  it("returns offset at line end (End)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p",
          lastChildId: "p",
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state);
    const pos = createPosition("p" as BlockId, 2);
    const result = moveToLineBoundary(state, pos, layout, shaper, "end");
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("p");
    // End of "hello" — offset 5.
    expect(result.offset).toBe(5);
  });

  it("'end' returns the line's `inlineOffsetEnd` (a valid state-model boundary, never mid-surrogate)", () => {
    // Build a paragraph where the inline-item boundary lands right after a
    // surrogate-pair grapheme. With charWidth=8 and container=8 the wrap
    // forces item 2 to line 1.
    //
    // Inline items: [text("🌟"), text("b")]
    //   UTF-16 offsets:   hi(0) lo(1) | b(2)
    //   Graphemes:        🌟          | b
    //
    // Historical: an earlier implementation went pixel → resolvePositionFromPixel
    // (which snapped to line 1's start = offset 2) → stepBack(1 raw UTF-16
    // unit) → offset 1 (the LOW surrogate of "🌟"), an invalid Position
    // mid-grapheme. That bug required a grapheme-aware step-back.
    //
    // After E-E.6: moveToLineBoundary returns `line.inlineOffsetEnd`
    // directly. The IFC stamps inlineOffsetEnd at state-model item
    // boundaries (per E-E.1 — each text-item contributes text.length,
    // each embed contributes 1), so the returned offset is always a
    // valid state-model cursor position by construction. No grapheme
    // step needed: item boundaries are coarser than grapheme boundaries
    // and never split a surrogate pair (because surrogate pairs live
    // within a single text-item's text).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          firstChildId: "p",
          lastChildId: "p",
        }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("🌟"), text("b")]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state, 8);
    const pos = createPosition("p" as BlockId, 0);
    const result = moveToLineBoundary(state, pos, layout, shaper, "end");
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.blockId).toBe("p");
    // Pre-fix code returned offset 1 (LOW surrogate — INVALID).
    // Post-E-E.6: returns `line.inlineOffsetEnd`, an item-seam
    // boundary; valid state-model offsets are {0, 2, 3}; offset 1 is
    // mid-surrogate and unreachable.
    expect(result.offset).not.toBe(1);
    expect(new Set([0, 2, 3]).has(result.offset)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P3.6 — vertical-mode line navigation (ArrowUp/Down on the BLOCK axis,
// goal-coord preserved on the INLINE axis)
// ---------------------------------------------------------------------------
//
// Up/Down move the caret along the document's BLOCK axis (the line ordering),
// preserving the INLINE-axis "goal" coordinate (the visual column). For the
// vertical modes the inline axis runs DOWN the page (physical Y) and the block
// axis runs ACROSS (physical X) — so the preserved goal is a physical-Y value
// and the target line's band is its physical-X. `resolveTargetLine` must project
// (inlineGoal, targetBlockCoord) to a physical (clickX, clickY) via the TARGET
// line's axis map; the old hardcoded `(x, target.absoluteY)` fed the inline goal
// as physical-X and the target line's absoluteY (≈0) as physical-Y, landing the
// caret on the wrong line at the wrong column in every vertical mode.
//
// Geometry mirrors `vertical-cursor-position.test.ts` / `hit-test.test.ts`'s
// "aa bb cc" fixture: an 8px-char mock shaper, a 20px-inline narrow page so the
// three short words wrap into three lines, page block-size 1000 so the v-rl
// block-axis mirror lands line 0 at the far/right physical X.
//   vertical-rl: line0 absX=984, line1 absX=968, line2 absX=952 (absY=0 each).
//   vertical-lr: line0 absX=0,  line1 absX=16,  line2 absX=32  (absY=0 each).
//   each line inlineSize=20, blockSize=16; leaves "aa"/"bb"/"cc" w=16 h=16.
// State offsets ("aa bb cc"): line0 "aa" [0,3] (end incl. space), line1 "bb"
// [3,6], line2 "cc" [6,8].
//
// These assertions are RED against the old `(x, target.absoluteY)` code: with
// every line at absY=0 the projected physical-Y would be ~0 (line start) and the
// inline goal would be misrouted onto physical-X (the block band), so the
// down/up move resolved to the wrong line at offset 0.

const V_CHAR_W = 8;
const V_LINE_CROSS = 16;

const vPageConfig: PageConfig = {
  pageInlineSize: 20,
  pageBlockSize: 1000,
  pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
  pageGap: 20,
};

function vDoc(wm: WritingMode): State {
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
        inlineContent: inlineContent([text("aa bb cc")]),
      }),
    ],
  });
}

function vPipeline(state: State): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry()).root;
  const shaper = createMockShaper(V_CHAR_W, V_LINE_CROSS);
  const layout = positionTreeForTest(
    layoutTree(root, vPageConfig.pageInlineSize, shaper, vPageConfig),
  );
  return { layout, shaper };
}

function vLines(layout: LayoutBox): ReturnType<typeof getLineIndex>["all"] {
  return getLineIndex(layout).byBlock.get("p" as BlockId) ?? [];
}

describe("P3.6 vertical line-navigation — vertical-rl", () => {
  const state = vDoc("vertical-rl");
  const { layout, shaper } = vPipeline(state);
  const lines = vLines(layout);

  it("layout sanity: three lines, descending physical X, absY=0", () => {
    expect(lines.length).toBe(3);
    expect(nth(lines, 0, "line").absoluteX).toBeGreaterThan(nth(lines, 1, "line").absoluteX);
    expect(nth(lines, 1, "line").absoluteX).toBeGreaterThan(nth(lines, 2, "line").absoluteX);
    expect(nth(lines, 0, "line").absoluteY).toBe(0);
  });

  it("ArrowDown preserves the inline column (line0 → line1 → line2)", () => {
    // Caret at offset 1 ("a|a") on line0: inline coord (physical Y) = 8.
    const step1 = moveToLine(state, createPosition("p" as BlockId, 1), layout, shaper, "down", null);
    expect(step1).not.toBeNull();
    if (step1 === null) return;
    expect(step1.position.blockId).toBe("p");
    // Goal Y=8 on line1 "bb" → display offset 1 → state 3 + 1 = 4.
    expect(step1.position.offset).toBe(4);
    expect(step1.targetX).toBe(8);

    const step2 = moveToLine(state, step1.position, layout, shaper, "down", step1.targetX);
    expect(step2).not.toBeNull();
    if (step2 === null) return;
    expect(step2.position.blockId).toBe("p");
    // Goal Y=8 on line2 "cc" → display offset 1 → state 6 + 1 = 7.
    expect(step2.position.offset).toBe(7);
    expect(step2.targetX).toBe(8);
  });

  it("ArrowUp preserves the inline column (line2 → line1 → line0)", () => {
    // Caret at offset 7 ("c|c") on line2: inline coord = 8.
    const step1 = moveToLine(state, createPosition("p" as BlockId, 7), layout, shaper, "up", null);
    expect(step1).not.toBeNull();
    if (step1 === null) return;
    expect(step1.position.offset).toBe(4); // line1 "b|b"
    expect(step1.targetX).toBe(8);

    const step2 = moveToLine(state, step1.position, layout, shaper, "up", step1.targetX);
    expect(step2).not.toBeNull();
    if (step2 === null) return;
    expect(step2.position.offset).toBe(1); // line0 "a|a"
    expect(step2.targetX).toBe(8);
  });
});

describe("P3.6 vertical line-navigation — vertical-lr", () => {
  const state = vDoc("vertical-lr");
  const { layout, shaper } = vPipeline(state);
  const lines = vLines(layout);

  it("layout sanity: three lines, ascending physical X, absY=0", () => {
    expect(lines.length).toBe(3);
    expect(nth(lines, 0, "line").absoluteX).toBeLessThan(nth(lines, 1, "line").absoluteX);
    expect(nth(lines, 1, "line").absoluteX).toBeLessThan(nth(lines, 2, "line").absoluteX);
    expect(nth(lines, 0, "line").absoluteY).toBe(0);
  });

  it("ArrowDown preserves the inline column (block axis ascending physical-X)", () => {
    const step1 = moveToLine(state, createPosition("p" as BlockId, 1), layout, shaper, "down", null);
    expect(step1).not.toBeNull();
    if (step1 === null) return;
    expect(step1.position.offset).toBe(4);
    expect(step1.targetX).toBe(8);

    const step2 = moveToLine(state, step1.position, layout, shaper, "down", step1.targetX);
    expect(step2).not.toBeNull();
    if (step2 === null) return;
    expect(step2.position.offset).toBe(7);
  });

  it("ArrowUp preserves the inline column", () => {
    const step1 = moveToLine(state, createPosition("p" as BlockId, 7), layout, shaper, "up", null);
    expect(step1).not.toBeNull();
    if (step1 === null) return;
    expect(step1.position.offset).toBe(4);

    const step2 = moveToLine(state, step1.position, layout, shaper, "up", step1.targetX);
    expect(step2).not.toBeNull();
    if (step2 === null) return;
    expect(step2.position.offset).toBe(1);
  });
});

describe("P3.6 vertical line-navigation — goal-coord memory across a short line", () => {
  // Three single-line paragraphs: long / short / long. The inline axis runs down
  // the page (physical Y), so each paragraph is one line; they stack along the
  // block axis (physical X). Down from a far inline column on the long line
  // clamps to the short line's end, but the goal column is retained, so Down
  // again returns to the original column on the next long line. Mirrors the h-tb
  // goal-memory contract for a vertical layout.
  function goalState(wm: WritingMode): State {
    return buildState({
      rootId: "doc",
      blocks: [
        buildBlock({
          id: "doc",
          type: "document",
          attrs: { writingMode: wm },
          firstChildId: "p1",
          lastChildId: "p3",
        }),
        buildBlock({
          id: "p1",
          type: "paragraph",
          parentId: "doc",
          attrs: { writingMode: wm },
          nextSiblingId: "p2",
          inlineContent: inlineContent([text("aaaa")]),
        }),
        buildBlock({
          id: "p2",
          type: "paragraph",
          parentId: "doc",
          attrs: { writingMode: wm },
          prevSiblingId: "p1",
          nextSiblingId: "p3",
          inlineContent: inlineContent([text("b")]),
        }),
        buildBlock({
          id: "p3",
          type: "paragraph",
          parentId: "doc",
          attrs: { writingMode: wm },
          prevSiblingId: "p2",
          inlineContent: inlineContent([text("cccc")]),
        }),
      ],
    });
  }

  // Wide page so each paragraph is a single line (inline = down the page).
  const goalPageConfig: PageConfig = {
    pageInlineSize: 100,
    pageBlockSize: 1000,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 20,
  };

  function goalPipeline(state: State): { layout: LayoutBox; shaper: TextShaper } {
    const root = render(state, createDefaultComponentRegistry(), createDefaultAttrRegistry()).root;
    const shaper = createMockShaper(V_CHAR_W, V_LINE_CROSS);
    const layout = positionTreeForTest(
      layoutTree(root, goalPageConfig.pageInlineSize, shaper, goalPageConfig),
    );
    return { layout, shaper };
  }

  it("vertical-rl: column C is restored on the second long line after clamping to the short line", () => {
    const state = goalState("vertical-rl");
    const { layout, shaper } = goalPipeline(state);
    // Caret on p1 at offset 3 ("aaa|a"): inline goal = 24 (physical Y).
    const step1 = moveToLine(state, createPosition("p1" as BlockId, 3), layout, shaper, "down", null);
    expect(step1).not.toBeNull();
    if (step1 === null) return;
    expect(step1.position.blockId).toBe("p2");
    // Short line "b" clamps to its end (offset 1).
    expect(step1.position.offset).toBe(1);
    // The goal column is RETAINED across the clamp.
    expect(step1.targetX).toBe(24);

    const step2 = moveToLine(state, step1.position, layout, shaper, "down", step1.targetX);
    expect(step2).not.toBeNull();
    if (step2 === null) return;
    expect(step2.position.blockId).toBe("p3");
    // Column C (goal 24) restored on the long line → offset 3 ("ccc|c").
    expect(step2.position.offset).toBe(3);
    expect(step2.targetX).toBe(24);
  });

  it("vertical-lr: column C is restored symmetrically (ArrowUp through the short line)", () => {
    const state = goalState("vertical-lr");
    const { layout, shaper } = goalPipeline(state);
    // Caret on p3 at offset 3: inline goal = 24.
    const step1 = moveToLine(state, createPosition("p3" as BlockId, 3), layout, shaper, "up", null);
    expect(step1).not.toBeNull();
    if (step1 === null) return;
    expect(step1.position.blockId).toBe("p2");
    expect(step1.position.offset).toBe(1); // short line clamp
    expect(step1.targetX).toBe(24);

    const step2 = moveToLine(state, step1.position, layout, shaper, "up", step1.targetX);
    expect(step2).not.toBeNull();
    if (step2 === null) return;
    expect(step2.position.blockId).toBe("p1");
    expect(step2.position.offset).toBe(3); // column restored
  });
});

describe("P3.6 vertical line-navigation — document edges", () => {
  it("vertical-rl: ArrowUp at the top line returns start-of-document", () => {
    const state = vDoc("vertical-rl");
    const { layout, shaper } = vPipeline(state);
    // Caret on line 0 (top of doc): ArrowUp falls to start-of-document.
    const r = moveToLine(state, createPosition("p" as BlockId, 1), layout, shaper, "up", null);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.position.blockId).toBe("p");
    expect(r.position.offset).toBe(0);
  });

  it("vertical-lr: ArrowDown at the bottom line returns end-of-document", () => {
    const state = vDoc("vertical-lr");
    const { layout, shaper } = vPipeline(state);
    // Caret on line 2 (bottom of doc): ArrowDown falls to end-of-document.
    const r = moveToLine(state, createPosition("p" as BlockId, 7), layout, shaper, "down", null);
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.position.blockId).toBe("p");
    expect(r.position.offset).toBe(8); // end of "aa bb cc"
  });
});
