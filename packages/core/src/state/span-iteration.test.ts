import { describe, it, expect } from "vitest";
import { normalizeSpan } from "./span-iteration";
import { buildBlock, buildState } from "../test-utils/state-builders";
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
