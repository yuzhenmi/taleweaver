import { describe, it, expect } from "vitest";
import { moveToLine, moveToLineBoundary } from "./line-navigation";
import { render } from "../render/render";
import { createDefaultComponentRegistry } from "../components/component-registry";
import { createDefaultAttrRegistry } from "../cascade/attr-registry";
import { layoutTree } from "../layout/dispatch";
import { createMockShaper } from "../layout/mock-shaper";
import type { TextShaper } from "../layout/text-shaper";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "../test-utils/state-builders";
import { createPosition } from "../state/block-position";
import type { BlockId } from "../state/block-id";
import type { State } from "../state/state";
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
  const layout = layoutTree(root, containerInlineSize, shaper, undefined);
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
});
