import { describe, it, expect } from "vitest";
import { normalizeSpan, iterateSpan } from "./span-iteration";
import { buildBlock, buildState, text } from "../test-utils/state-builders";
import { createPosition, createSpan } from "./block-position";
import { createInlineContent } from "./inline-content";
import type { BlockId } from "./block-id";

describe("normalizeSpan", () => {
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: createInlineContent([]) }),
      ],
    });

  it("returns the span unchanged when anchor is already before focus (same block)", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 0);
    const b = createPosition("p1" as BlockId, 5);
    const span = createSpan(a, b);
    const result = normalizeSpan(state, span);
    expect(result.anchor).toBe(a);
    expect(result.focus).toBe(b);
  });

  it("swaps anchor and focus when focus is before anchor (same block)", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 5);
    const b = createPosition("p1" as BlockId, 0);
    const span = createSpan(a, b);
    const result = normalizeSpan(state, span);
    expect(result.anchor).toBe(b);
    expect(result.focus).toBe(a);
  });

  it("returns the span unchanged when anchor is in an earlier block than focus", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 0);
    const b = createPosition("p2" as BlockId, 0);
    const span = createSpan(a, b);
    const result = normalizeSpan(state, span);
    expect(result.anchor).toBe(a);
    expect(result.focus).toBe(b);
  });

  it("swaps when focus is in an earlier block than anchor", () => {
    const state = fixture();
    const a = createPosition("p2" as BlockId, 0);
    const b = createPosition("p1" as BlockId, 0);
    const span = createSpan(a, b);
    const result = normalizeSpan(state, span);
    expect(result.anchor).toBe(b);
    expect(result.focus).toBe(a);
  });

  it("returns the span unchanged when collapsed (anchor === focus)", () => {
    const state = fixture();
    const a = createPosition("p1" as BlockId, 5);
    const span = createSpan(a, a);
    const result = normalizeSpan(state, span);
    expect(result.anchor).toBe(a);
    expect(result.focus).toBe(a);
  });
});

describe("iterateSpan", () => {
  // doc > [p1("hello"), p2("world"), p3("!")]
  const fixture = () =>
    buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: createInlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: createInlineContent([text("world")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: createInlineContent([text("!")]) }),
      ],
    });

  it("yields a single range when span is within one block", () => {
    const state = fixture();
    const span = createSpan(createPosition("p1" as BlockId, 1), createPosition("p1" as BlockId, 4));
    const ranges = [...iterateSpan(state, span)];
    expect(ranges).toHaveLength(1);
    expect(ranges[0].block.id).toBe("p1");
    expect(ranges[0].rangeStart).toBe(1);
    expect(ranges[0].rangeEnd).toBe(4);
  });

  it("yields anchor block from anchor.offset to end, then focus block from 0 to focus.offset (two-block span)", () => {
    const state = fixture();
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const ranges = [...iterateSpan(state, span)];
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual(expect.objectContaining({
      rangeStart: 2,
      rangeEnd: 5,  // p1's "hello" length is 5
    }));
    expect(ranges[0].block.id).toBe("p1");
    expect(ranges[1]).toEqual(expect.objectContaining({
      rangeStart: 0,
      rangeEnd: 3,
    }));
    expect(ranges[1].block.id).toBe("p2");
  });

  it("yields anchor, all middle full ranges, then focus (three-block span)", () => {
    const state = fixture();
    const span = createSpan(createPosition("p1" as BlockId, 1), createPosition("p3" as BlockId, 1));
    const ranges = [...iterateSpan(state, span)];
    expect(ranges).toHaveLength(3);
    expect(ranges[0].block.id).toBe("p1");
    expect(ranges[0].rangeStart).toBe(1);
    expect(ranges[0].rangeEnd).toBe(5); // p1 full content length

    expect(ranges[1].block.id).toBe("p2");
    expect(ranges[1].rangeStart).toBe(0);
    expect(ranges[1].rangeEnd).toBe(5); // p2 full content length

    expect(ranges[2].block.id).toBe("p3");
    expect(ranges[2].rangeStart).toBe(0);
    expect(ranges[2].rangeEnd).toBe(1);
  });

  it("normalizes the span before iterating (anchor after focus)", () => {
    const state = fixture();
    const span = createSpan(createPosition("p2" as BlockId, 3), createPosition("p1" as BlockId, 2));
    const ranges = [...iterateSpan(state, span)];
    // After normalization: anchor=p1@2, focus=p2@3. Same as the two-block test above.
    expect(ranges).toHaveLength(2);
    expect(ranges[0].block.id).toBe("p1");
    expect(ranges[1].block.id).toBe("p2");
  });

  it("yields a single zero-width range for a collapsed span (anchor === focus)", () => {
    const state = fixture();
    const pos = createPosition("p1" as BlockId, 3);
    const span = createSpan(pos, pos);
    const ranges = [...iterateSpan(state, span)];
    expect(ranges).toHaveLength(1);
    expect(ranges[0].rangeStart).toBe(3);
    expect(ranges[0].rangeEnd).toBe(3);
  });

  it("throws when anchor or focus is on a container block (not a leaf)", () => {
    // doc > section > p1 — section is a container with no inlineContent.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s", inlineContent: createInlineContent([text("hi")]) }),
      ],
    });
    const onContainer = createSpan(createPosition("s" as BlockId, 0), createPosition("p1" as BlockId, 1));
    expect(() => [...iterateSpan(state, onContainer)]).toThrow(/container/);
  });

  it("throws when anchor and focus are in different selection contexts", () => {
    // Two roots — anchor in main doc, focus in a separate sub-tree.
    const state = buildState({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: createInlineContent([text("hi")]) }),
        // Footnote-body sub-tree with its own root (parentId = null).
        buildBlock({ id: "fn", type: "footnote-body", inlineContent: createInlineContent([text("footnote")]) }),
      ],
    });
    const cross = createSpan(createPosition("p1" as BlockId, 0), createPosition("fn" as BlockId, 1));
    expect(() => [...iterateSpan(state, cross)]).toThrow(/different selection contexts/);
  });
});
