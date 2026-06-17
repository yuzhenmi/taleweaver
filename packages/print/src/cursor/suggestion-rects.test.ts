/**
 * Change-tracking slice 6 — `getSuggestionRangeRects` host query.
 *
 * Geometry-level tests: tag inline runs with a suggestion-id attr in a real
 * laid-out fixture, then assert the returned `SelectionRect`s. Load-bearing
 * properties: (1) the rects cover EXACTLY the tagged glyphs — and, because a
 * suggestion tags a run in place (no offset-shifting markers, unlike comments),
 * are byte-identical to `computeSelectionRects` over the same plain span;
 * (2) a range crossing a soft-wrap / page boundary emits one rect per line /
 * per page; (3) a suggestion id with NO tagged content (absent) returns `[]`.
 */
import { describe, it, expect } from "vitest";
import { getSuggestionRangeRects } from "./suggestion-rects";
import { computeSelectionRects } from "./selection-geometry";
import { render } from "@taleweaver/core";
import { createDefaultComponentRegistry } from "@taleweaver/core";
import { createDefaultAttrRegistry } from "@taleweaver/core";
import { layoutTree } from "../layout/dispatch";
import { positionTreeForTest } from "../test-utils/position-tree";
import { createMockShaper } from "@taleweaver/core";
import type { TextShaper } from "@taleweaver/core";
import type { PageConfig } from "../layout/page-config";
import {
  buildState,
  buildBlock,
  inlineContent,
  text,
} from "@taleweaver/core";
import {
  createPosition,
  createSpan,
  DELETION_SUGGESTION_ATTR,
  type BlockId,
  type State,
  type SuggestionId,
} from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const SID = "s1" as SuggestionId;

function pipeline(
  state: State,
  containerInlineSize: number = 800,
  pageConfig?: PageConfig,
): { layout: LayoutBox; shaper: TextShaper } {
  const root = render(
    state,
    createDefaultComponentRegistry(),
    createDefaultAttrRegistry(),
  ).root;
  const shaper = createMockShaper(8, 16);
  const layout = positionTreeForTest(layoutTree(root, containerInlineSize, shaper, pageConfig));
  return { layout, shaper };
}

describe("getSuggestionRangeRects", () => {
  it("returns rects covering exactly the tagged glyphs (single line)", () => {
    // "hello " (plain) + "world" (deletion-tagged with SID). The suggestion range
    // is offsets 6..11 — "world" at display x [48, 88).
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([
            text("hello "),
            text("world", { [DELETION_SUGGESTION_ATTR]: SID }),
          ]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state, 800);

    const rects = getSuggestionRangeRects(state, layout, shaper, SID);
    expect(rects.length).toBe(1);
    const rect = nth(rects, 0, "suggestion rect");
    expect(rect.x).toBe(48);
    expect(rect.width).toBe(40);
    expect(rect.pageIndex).toBe(0);

    // Exact equivalence: a suggestion tags the run in place (no marker shift), so
    // the highlight === selecting offsets 6..11 directly.
    const plainSpan = createSpan(
      createPosition("p" as BlockId, 6),
      createPosition("p" as BlockId, 11),
    );
    expect(rects).toEqual(computeSelectionRects(state, plainSpan, layout, shaper));
  });

  it("returns one rect per line for a range crossing a soft-wrap boundary", () => {
    let s = "";
    for (let i = 0; i < 20; i++) s += "abcdefghi "; // 200 chars, the whole run tagged
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text(s, { [DELETION_SUGGESTION_ATTR]: SID })]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state, 800);

    const rects = getSuggestionRangeRects(state, layout, shaper, SID);
    expect(rects.length).toBeGreaterThanOrEqual(2);
    const ys = new Set(rects.map((r) => r.y));
    expect(ys.size).toBeGreaterThanOrEqual(2);
  });

  it("returns rects on each page for a range crossing a page boundary", () => {
    // Five single-line paragraphs, tiny pages → each on its own page. The same
    // suggestion id tags the run in p1 AND p5 → its range spans p1..p5.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p5" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("line1", { [DELETION_SUGGESTION_ATTR]: SID })]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("line2")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", nextSiblingId: "p4", inlineContent: inlineContent([text("line3")]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "doc", prevSiblingId: "p3", nextSiblingId: "p5", inlineContent: inlineContent([text("line4")]) }),
        buildBlock({ id: "p5", type: "paragraph", parentId: "doc", prevSiblingId: "p4", inlineContent: inlineContent([text("line5", { [DELETION_SUGGESTION_ATTR]: SID })]) }),
      ],
    });
    const pageConfig: PageConfig = {
      pageInlineSize: 800,
      pageBlockSize: 60,
      pageMargins: { blockStart: 10, blockEnd: 10, inlineStart: 0, inlineEnd: 0 },
      pageGap: 0,
    };
    const { layout, shaper } = pipeline(state, 800, pageConfig);

    const rects = getSuggestionRangeRects(state, layout, shaper, SID);
    const pages = new Set(rects.map((r) => r.pageIndex));
    expect(pages.size).toBeGreaterThanOrEqual(2);
  });

  it("returns [] for a suggestion id with no tagged content (absent)", () => {
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p", lastChildId: "p" }),
        buildBlock({
          id: "p",
          type: "paragraph",
          parentId: "doc",
          inlineContent: inlineContent([text("hello world", { [DELETION_SUGGESTION_ATTR]: SID })]),
        }),
      ],
    });
    const { layout, shaper } = pipeline(state, 800);

    expect(getSuggestionRangeRects(state, layout, shaper, "nope" as SuggestionId)).toEqual([]);
  });
});
