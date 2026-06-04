import { describe, it, expect } from "vitest";
import { moveToLine, moveToLineBoundary } from "./line-navigation";
import { render } from "../render/render";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { layoutTree } from "../layout/dispatch";
import { resolvePositionedTree } from "../layout/positioned-tree";
import { createMockShaper } from "../layout/mock-shaper";
import type { TextShaper } from "../layout/text-shaper";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../test-utils/state-builders";
import { createPosition } from "../state";
import type { BlockId, State } from "../state";
import type { LayoutBox } from "../layout/layout-node";

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
  const layout = resolvePositionedTree(layoutTree(root, containerInlineSize, shaper, undefined));
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
