import { describe, it, expect } from "vitest";
import { createBlock, type Block } from "./block";
import { createInlineContent, createTextItem } from "./inline-content";
import type { BlockId } from "./block-id";

describe("createBlock", () => {
  it("constructs a frozen container block (no inlineContent)", () => {
    const b: Block = createBlock({
      id: "doc-0" as BlockId,
      type: "document",
      attrs: {},
    });
    expect(b.id).toBe("doc-0");
    expect(b.type).toBe("document");
    expect(b.attrs).toEqual({});
    expect(b.parentId).toBeNull();
    expect(b.prevSiblingId).toBeNull();
    expect(b.nextSiblingId).toBeNull();
    expect(b.firstChildId).toBeNull();
    expect(b.lastChildId).toBeNull();
    expect(b.inlineContent).toBeNull();
    expect(Object.isFrozen(b)).toBe(true);
    expect(Object.isFrozen(b.attrs)).toBe(true);
  });

  it("constructs a frozen leaf block with inline content", () => {
    const content = createInlineContent([createTextItem("hello")]);
    const b: Block = createBlock({
      id: "para-0" as BlockId,
      type: "paragraph",
      attrs: { textAlign: "left" },
      inlineContent: content,
    });
    expect(b.inlineContent).toBe(content);
    expect(b.attrs).toEqual({ textAlign: "left" });
    expect(Object.isFrozen(b)).toBe(true);
  });

  it("accepts and stores link pointers", () => {
    const b = createBlock({
      id: "para-1" as BlockId,
      type: "paragraph",
      attrs: {},
      parentId: "doc-0" as BlockId,
      prevSiblingId: "para-0" as BlockId,
      nextSiblingId: "para-2" as BlockId,
    });
    expect(b.parentId).toBe("doc-0");
    expect(b.prevSiblingId).toBe("para-0");
    expect(b.nextSiblingId).toBe("para-2");
  });
});
