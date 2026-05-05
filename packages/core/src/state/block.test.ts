import { describe, it, expect } from "vitest";
import { createBlock, updateBlock, type Block } from "./block";
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

describe("updateBlock", () => {
  it("returns a new block with the given field overridden, all others preserved", () => {
    const original = createBlock({
      id: "p1" as BlockId,
      type: "paragraph",
      attrs: { bold: true },
      parentId: "doc" as BlockId,
      prevSiblingId: "p0" as BlockId,
      nextSiblingId: "p2" as BlockId,
      inlineContent: createInlineContent([createTextItem("hello")]),
    });
    const updated = updateBlock(original, { nextSiblingId: "p9" as BlockId });

    // The single overridden field is updated.
    expect(updated.nextSiblingId).toBe("p9");
    // Every other field is preserved.
    expect(updated.id).toBe("p1");
    expect(updated.type).toBe("paragraph");
    expect(updated.attrs).toEqual({ bold: true });
    expect(updated.parentId).toBe("doc");
    expect(updated.prevSiblingId).toBe("p0");
    expect(updated.firstChildId).toBeNull();
    expect(updated.lastChildId).toBeNull();
    expect(updated.inlineContent).toBe(original.inlineContent);
  });

  it("can override multiple fields at once", () => {
    const original = createBlock({
      id: "doc" as BlockId,
      type: "document",
      firstChildId: "p1" as BlockId,
      lastChildId: "p2" as BlockId,
    });
    const updated = updateBlock(original, {
      firstChildId: "p3" as BlockId,
      lastChildId: "p4" as BlockId,
    });
    expect(updated.firstChildId).toBe("p3");
    expect(updated.lastChildId).toBe("p4");
    expect(updated.id).toBe("doc"); // id preserved
  });

  it("can set a field to null (e.g., removing a sibling pointer)", () => {
    const original = createBlock({
      id: "p" as BlockId,
      type: "paragraph",
      nextSiblingId: "p2" as BlockId,
    });
    const updated = updateBlock(original, { nextSiblingId: null });
    expect(updated.nextSiblingId).toBeNull();
  });

  it("returns a frozen block (preserves the freeze invariant from createBlock)", () => {
    const original = createBlock({ id: "p" as BlockId, type: "paragraph" });
    const updated = updateBlock(original, { type: "heading" });
    expect(Object.isFrozen(updated)).toBe(true);
    expect(Object.isFrozen(updated.attrs)).toBe(true);
  });

  it("does not mutate the original block", () => {
    const original = createBlock({
      id: "p" as BlockId,
      type: "paragraph",
      nextSiblingId: "p2" as BlockId,
    });
    updateBlock(original, { nextSiblingId: "p9" as BlockId });
    expect(original.nextSiblingId).toBe("p2"); // unchanged
  });
});
