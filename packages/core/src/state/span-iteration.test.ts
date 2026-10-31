import { describe, it, expect } from "vitest";
import { normalizeSpan, iterateSpan, iterateBlocksInSpan } from "./span-iteration";
import { TEST_RESOLVER, testContainer, buildBlock, buildDocument, text, inlineContent } from "../test-utils/document-builders";
import { createPosition, createSpan } from "./block-position";
import type { BlockId } from "./block-id";

// Host container types the default registry lacks (file-local registry instance).
TEST_RESOLVER.register(testContainer("blockquote"));

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

describe("normalizeSpan", () => {
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", inlineContent: inlineContent([]) }),
      ],
    });

  it("returns the span unchanged when anchor is already before focus (same block)", () => {
    const document = fixture();
    const a = createPosition("p1" as BlockId, 0);
    const b = createPosition("p1" as BlockId, 5);
    const span = createSpan(a, b);
    const result = normalizeSpan(document, span);
    expect(result.anchor).toBe(a);
    expect(result.focus).toBe(b);
  });

  it("swaps anchor and focus when focus is before anchor (same block)", () => {
    const document = fixture();
    const a = createPosition("p1" as BlockId, 5);
    const b = createPosition("p1" as BlockId, 0);
    const span = createSpan(a, b);
    const result = normalizeSpan(document, span);
    expect(result.anchor).toBe(b);
    expect(result.focus).toBe(a);
  });

  it("returns the span unchanged when anchor is in an earlier block than focus", () => {
    const document = fixture();
    const a = createPosition("p1" as BlockId, 0);
    const b = createPosition("p2" as BlockId, 0);
    const span = createSpan(a, b);
    const result = normalizeSpan(document, span);
    expect(result.anchor).toBe(a);
    expect(result.focus).toBe(b);
  });

  it("swaps when focus is in an earlier block than anchor", () => {
    const document = fixture();
    const a = createPosition("p2" as BlockId, 0);
    const b = createPosition("p1" as BlockId, 0);
    const span = createSpan(a, b);
    const result = normalizeSpan(document, span);
    expect(result.anchor).toBe(b);
    expect(result.focus).toBe(a);
  });

  it("returns the span unchanged when collapsed (anchor === focus)", () => {
    const document = fixture();
    const a = createPosition("p1" as BlockId, 5);
    const span = createSpan(a, a);
    const result = normalizeSpan(document, span);
    expect(result.anchor).toBe(a);
    expect(result.focus).toBe(a);
  });
});

describe("iterateSpan", () => {
  // doc > [p1("hello"), p2("world"), p3("!")]
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p3" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("hello")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("world")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", inlineContent: inlineContent([text("!")]) }),
      ],
    });

  it("yields a single range when span is within one block", () => {
    const document = fixture();
    const span = createSpan(createPosition("p1" as BlockId, 1), createPosition("p1" as BlockId, 4));
    const ranges = [...iterateSpan(document, span)];
    expect(ranges).toHaveLength(1);
    expect(nth(ranges, 0, "range").block.id).toBe("p1");
    expect(nth(ranges, 0, "range").rangeStart).toBe(1);
    expect(nth(ranges, 0, "range").rangeEnd).toBe(4);
  });

  it("yields anchor block from anchor.offset to end, then focus block from 0 to focus.offset (two-block span)", () => {
    const document = fixture();
    const span = createSpan(createPosition("p1" as BlockId, 2), createPosition("p2" as BlockId, 3));
    const ranges = [...iterateSpan(document, span)];
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual(expect.objectContaining({
      rangeStart: 2,
      rangeEnd: 5,  // p1's "hello" length is 5
    }));
    expect(nth(ranges, 0, "range").block.id).toBe("p1");
    expect(ranges[1]).toEqual(expect.objectContaining({
      rangeStart: 0,
      rangeEnd: 3,
    }));
    expect(nth(ranges, 1, "range").block.id).toBe("p2");
  });

  it("yields anchor, all middle full ranges, then focus (three-block span)", () => {
    const document = fixture();
    const span = createSpan(createPosition("p1" as BlockId, 1), createPosition("p3" as BlockId, 1));
    const ranges = [...iterateSpan(document, span)];
    expect(ranges).toHaveLength(3);
    expect(nth(ranges, 0, "range").block.id).toBe("p1");
    expect(nth(ranges, 0, "range").rangeStart).toBe(1);
    expect(nth(ranges, 0, "range").rangeEnd).toBe(5); // p1 full content length

    expect(nth(ranges, 1, "range").block.id).toBe("p2");
    expect(nth(ranges, 1, "range").rangeStart).toBe(0);
    expect(nth(ranges, 1, "range").rangeEnd).toBe(5); // p2 full content length

    expect(nth(ranges, 2, "range").block.id).toBe("p3");
    expect(nth(ranges, 2, "range").rangeStart).toBe(0);
    expect(nth(ranges, 2, "range").rangeEnd).toBe(1);
  });

  it("normalizes the span before iterating (anchor after focus)", () => {
    const document = fixture();
    const span = createSpan(createPosition("p2" as BlockId, 3), createPosition("p1" as BlockId, 2));
    const ranges = [...iterateSpan(document, span)];
    // After normalization: anchor=p1@2, focus=p2@3. Same as the two-block test above.
    expect(ranges).toHaveLength(2);
    expect(nth(ranges, 0, "range").block.id).toBe("p1");
    expect(nth(ranges, 1, "range").block.id).toBe("p2");
  });

  it("yields a single zero-width range for a collapsed span (anchor === focus)", () => {
    const document = fixture();
    const pos = createPosition("p1" as BlockId, 3);
    const span = createSpan(pos, pos);
    const ranges = [...iterateSpan(document, span)];
    expect(ranges).toHaveLength(1);
    expect(nth(ranges, 0, "range").rangeStart).toBe(3);
    expect(nth(ranges, 0, "range").rangeEnd).toBe(3);
  });

  it("throws when anchor or focus is on a container block (not a leaf)", () => {
    // doc > section > p1 — section is a container with no inlineContent.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s", lastChildId: "s" }),
        buildBlock({ id: "s", type: "section", parentId: "doc", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s", inlineContent: inlineContent([text("hi")]) }),
      ],
    });
    const onContainer = createSpan(createPosition("s" as BlockId, 0), createPosition("p1" as BlockId, 1));
    expect(() => [...iterateSpan(document, onContainer)]).toThrow(/container/);
  });

  it("throws when anchor and focus are in different selection contexts", () => {
    // Two roots — anchor in main doc, focus in a footnote body's paragraph.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn", type: "footnote-body", firstChildId: "fnp", lastChildId: "fnp" }),
        buildBlock({ id: "fnp", type: "paragraph", parentId: "fn", inlineContent: inlineContent([text("footnote")]) }),
      ],
    });
    const cross = createSpan(createPosition("p1" as BlockId, 0), createPosition("fnp" as BlockId, 1));
    expect(() => [...iterateSpan(document, cross)]).toThrow(/different selection contexts/);
  });
});

describe("iterateBlocksInSpan", () => {
  // doc > [section1 > [p1, p2], section2 > [p3]]
  const fixture = () =>
    buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "s1", lastChildId: "s2" }),
        buildBlock({ id: "s1", type: "section", parentId: "doc", nextSiblingId: "s2", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s1", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s1", prevSiblingId: "p1", inlineContent: inlineContent([text("b")]) }),
        buildBlock({ id: "s2", type: "section", parentId: "doc", prevSiblingId: "s1", firstChildId: "p3", lastChildId: "p3" }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "s2", inlineContent: inlineContent([text("c")]) }),
      ],
    });

  it("yields just the block when span is within a single block", () => {
    const document = fixture();
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p1" as BlockId, 1));
    const blocks = [...iterateBlocksInSpan(document, span)];
    expect(blocks.map((b) => b.id)).toEqual(["p1"]);
  });

  it("yields all blocks (leaves AND containers) overlapped by the span", () => {
    const document = fixture();
    // Span from p1 into p3 — passes through p2, s2 (container), p3.
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p3" as BlockId, 1));
    const blocks = [...iterateBlocksInSpan(document, span)];
    // Expected sequence in doc order: p1, p2, s2, p3.
    expect(blocks.map((b) => b.id)).toEqual(["p1", "p2", "s2", "p3"]);
  });

  it("normalizes the span before iterating", () => {
    const document = fixture();
    const span = createSpan(createPosition("p3" as BlockId, 1), createPosition("p1" as BlockId, 0));
    const blocks = [...iterateBlocksInSpan(document, span)];
    expect(blocks.map((b) => b.id)).toEqual(["p1", "p2", "s2", "p3"]);
  });

  it("yields just the single block for a collapsed span", () => {
    const document = fixture();
    const pos = createPosition("p1" as BlockId, 0);
    const span = createSpan(pos, pos);
    const blocks = [...iterateBlocksInSpan(document, span)];
    expect(blocks.map((b) => b.id)).toEqual(["p1"]);
  });

  it("supports container-block endpoints (anchor on a section, focus on a leaf)", () => {
    const document = fixture();
    // Selecting from s1 to p3 — used by 'wrap in section' / 'set page-break' style ops.
    const span = createSpan(createPosition("s1" as BlockId, 0), createPosition("p3" as BlockId, 0));
    const blocks = [...iterateBlocksInSpan(document, span)];
    // Doc-order from s1: s1, p1, p2, s2, p3.
    expect(blocks.map((b) => b.id)).toEqual(["s1", "p1", "p2", "s2", "p3"]);
  });

  it("yields a deeply-nested cross-subtree range", () => {
    // doc > [outer1 > [s1 > [p1, p2]], outer2 > [s2 > [p3]]] — outer sections, inner
    // generic containers (sections only live in the root flow).
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "o1", lastChildId: "o2" }),
        buildBlock({ id: "o1", type: "section", parentId: "doc", nextSiblingId: "o2", firstChildId: "s1", lastChildId: "s1" }),
        buildBlock({ id: "s1", type: "blockquote", parentId: "o1", firstChildId: "p1", lastChildId: "p2" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "s1", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "s1", prevSiblingId: "p1", inlineContent: inlineContent([text("b")]) }),
        buildBlock({ id: "o2", type: "section", parentId: "doc", prevSiblingId: "o1", firstChildId: "s2", lastChildId: "s2" }),
        buildBlock({ id: "s2", type: "blockquote", parentId: "o2", firstChildId: "p3", lastChildId: "p3" }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "s2", inlineContent: inlineContent([text("c")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p3" as BlockId, 1));
    const blocks = [...iterateBlocksInSpan(document, span)];
    // p1, p2, then the paragraph ending section o1 (a section ending in a container gets
    // its own terminating ¶), o2, s2, p3 — o2 appears before its first child.
    const ids = blocks.map((b) => b.id);
    expect([ids[0], ids[1], ...ids.slice(3)]).toEqual(["p1", "p2", "o2", "s2", "p3"]);
    expect(blocks[2]?.parentId).toBe("o1");
    expect(blocks[2]?.inlineContent).toEqual({ items: [] });
  });

  it("throws when anchor and focus are in different selection contexts", () => {
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p1" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", inlineContent: inlineContent([text("hi")]) }),
      ],
      embedContents: [
        buildBlock({ id: "fn", type: "footnote-body", firstChildId: "fnp", lastChildId: "fnp" }),
        buildBlock({ id: "fnp", type: "paragraph", parentId: "fn", inlineContent: inlineContent([text("footnote")]) }),
      ],
    });
    const cross = createSpan(createPosition("p1" as BlockId, 0), createPosition("fnp" as BlockId, 1));
    expect(() => [...iterateBlocksInSpan(document, cross)]).toThrow(/different selection contexts/);
  });
});

describe("iterateSpan — healthy traversal", () => {
  it("does not fire on healthy traversals (regression: outer guard must not false-positive)", () => {
    // doc > [p1, p2, p3, p4, p5] — 5 leaves, span spans all of them.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p5" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("b")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", nextSiblingId: "p4", inlineContent: inlineContent([text("c")]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "doc", prevSiblingId: "p3", nextSiblingId: "p5", inlineContent: inlineContent([text("d")]) }),
        buildBlock({ id: "p5", type: "paragraph", parentId: "doc", prevSiblingId: "p4", inlineContent: inlineContent([text("e")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p5" as BlockId, 1));
    const ranges = [...iterateSpan(document, span)];
    expect(ranges.map((r) => r.block.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });
});

describe("iterateBlocksInSpan — healthy traversal", () => {
  it("does not fire on healthy traversals (regression: outer guard must not false-positive)", () => {
    // doc > [p1..p5] healthy sibling chain.
    const document = buildDocument({
      rootId: "doc",
      blocks: [
        buildBlock({ id: "doc", type: "document", firstChildId: "p1", lastChildId: "p5" }),
        buildBlock({ id: "p1", type: "paragraph", parentId: "doc", nextSiblingId: "p2", inlineContent: inlineContent([text("a")]) }),
        buildBlock({ id: "p2", type: "paragraph", parentId: "doc", prevSiblingId: "p1", nextSiblingId: "p3", inlineContent: inlineContent([text("b")]) }),
        buildBlock({ id: "p3", type: "paragraph", parentId: "doc", prevSiblingId: "p2", nextSiblingId: "p4", inlineContent: inlineContent([text("c")]) }),
        buildBlock({ id: "p4", type: "paragraph", parentId: "doc", prevSiblingId: "p3", nextSiblingId: "p5", inlineContent: inlineContent([text("d")]) }),
        buildBlock({ id: "p5", type: "paragraph", parentId: "doc", prevSiblingId: "p4", inlineContent: inlineContent([text("e")]) }),
      ],
    });
    const span = createSpan(createPosition("p1" as BlockId, 0), createPosition("p5" as BlockId, 1));
    const blocks = [...iterateBlocksInSpan(document, span)];
    expect(blocks.map((b) => b.id)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
  });
});
